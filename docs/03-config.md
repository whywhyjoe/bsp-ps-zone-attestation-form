# The configs — `src/ps-zone-attestation.json`, `.resources.json`, `.access.json`

Everything a business owner might ask to change lives in three JSON files:

- `ps-zone-attestation.json`, **the form**: wording in both languages, the
  notices, the five zones and their descriptions, the list names.
- `ps-zone-attestation.resources.json`, **the side panel**: the job aid and
  document links, the information text and the contact (see *The resources
  panel*).
- `ps-zone-attestation.access.json`, **the employee access list page** (see
  *The employee access list* at the end).

All are fetched uncached (`cache: 'no-cache'`), so an edit to the
**deployed** copy is live on the next page load, with no `?v=` bump.

**Keep the hand formatting.** `dev/live/live-deploy.ps1` finds exact text in
them: `"siteUrl": "/teams/FCUWebDatastores"` three times in the form config
and three times in the access config, the `accessListUrl` and `formUrl`
lines, and the first `"url": ""` in the resources config. Edit them as text,
never round-trip them through a JSON serializer.

This page covers the keys this form uses. The engine accepts more (other
field types, attachments, business time…), inherited from BSP Forms 0.5.1,
but they aren't part of this form, aren't tested here, and shouldn't be added
to it. A different form belongs on the shared engine, not in this repo.

## Bilingual text

`"form": { "languages": ["en", "fr"] }` makes **any** text in the config an
`{ "en": "…", "fr": "…" }` pair. The active language comes from
`lib/intl.js`, whose detection today is the `?lang=fr` placeholder in the
page URL (`intl.getLang()`). A missing or empty `fr` falls back to `en`.
Every built-in engine message has a French version (`DEFAULT_STRINGS_FR`).
Switching language (`intl.setLang()`) re-renders in place and keeps the
answers.

**Saved values never change with the language.** Each zone's `value` is
English and is what lands in `ZoneSelection` / `PreviousZone`; only `label`
and `description` are translated. `CurrentZone` in the Assignments list must
hold values spelled exactly as in `choices`.

## Formatting: the inline markdown subset

Since 1.4.0 the longer texts take a small, fixed piece of markdown:

| Write | Shows as | Notes |
| --- | --- | --- |
| `[text](url)` | a link | Only `https://`, `http://`, `mailto:`, server-relative `/…` and `#anchor` addresses; anything else stays as typed. Off-page links open in a new tab. |
| `**text**` | **bold** | |
| `*text*` | *italic* | Either can go inside the other (`**a *b* c**`, `*a **b** c*`) or inside a link's text. |
| `\*` | a literal `*` | In the JSON file that's `\\*`, because JSON doubles backslashes. |

The markers must hug their text: `5 * 3`, `a*b`, `Public*`, an unclosed `**`
and markers across a line break all stay as typed. **Nothing else is
markup**: no headings, bullets, numbered lists, dividers or HTML. Those show
exactly as written, so a French sentence starting "1. " can't turn into a
list. Every string is escaped first, so no text can inject markup.

Which texts: the form's `intro`, `headerNote`, notes (`text`), section and
page descriptions, field hints, the zone descriptions, the `empty`,
`allDone`, thank-you and dialog messages; the access list's `intro` and
`empty.message`; the side panel's `text` and `description`. Everything
else (titles, labels, buttons, status tags, the built-in messages) is plain
text: asterisks and brackets show as typed.

The exact behaviour is the case table in `tests/markdown-cases.cjs`, which
the suite runs against the engine's `prose()`. It's written to be copied
as-is to the other BSP parts that adopt the same subset, so they all agree.

## `form`

| Key | In this form | Notes |
| --- | --- | --- |
| `title`, `intro` | EN/FR pairs | Title "Physical Security Work Zone Confirmation" (1.3.0). `intro` takes links, **bold** and *italic* (*Formatting*, above). |
| `appearance` | card · band · sky | Frame, header band, band tint (`sky` `blue` `neutral`). |
| `headerNote` | `{ style: "info", text }` | 1.3.1. A callout in the header band, under the intro: "Any change to a zone will be reviewed…". `style` is `info` (default), `warning`, `success` or `danger`; `text` takes links and `{var:…}`. |
| `headerUser` | `{ label: "Confirmation by:" }` | 1.3.1. The who card (photo or initials, name, email) as the header's right column. It replaces a `currentUser` field in the body; below ~720px it drops under the intro. |
| `vars` | `accessListUrl` | Values for `{var:name}`. `accessListUrl` is the access list page, the access callout's button. `PSZ_FORM_SETTINGS.vars` on the page overrides them (the dev harness does). |

Links in config text that leave the page (`http(s)`, `mailto:`, `/…`) open in
a new tab and carry `data-interception="off"`. Without that attribute a
modern SharePoint page catches the click on a same-tenant link and navigates
**in place**, whatever the `target`, which would replace a half-filled form
(found on the dev tenant with 1.3.0).

Since 1.1.0 the form has **no header card**: the job aid moved to the
resources panel, and the intro uses the full header width. The engine still
supports `form.headerCard` (`{ title, text, url, icon }` beside the intro),
but this form doesn't use it.

**Asset paths stay inside `design/`.** `appearance.icon`,
`confirmation.illustration` and the resources panel's item `icon`s are
resolved against `design/`. A new icon file must be vendored into
`src/design/` first (`04-vendoring.md`). The engine
passes an absolute URL or a server-relative path (`/sites/…`) through
untouched, and a relative path can climb out with `../`
(`../../bsp-design/…` lands in the shared `Code/bsp-design/`). Either way a
config edit would quietly bring back a dependency on the shared folder,
without any setting. Use a plain path below `design/`
(`abacus-icons/light-bulb-48.svg`). The suite fails on any path that leaves
`design/` ("config asset paths are relative and resolve inside design/"),
but an edit made in the deployed copy never meets the suite. Check by hand
when editing on the tenant.

## `target` — where responses are saved

| Key | Value | Notes |
| --- | --- | --- |
| `siteUrl` | `/teams/FCUWebDatastores` | The lists' site; the page is on `/sites/FCUPortal`. |
| `listTitle` | `PS_Zone-Attestation-Responses` | `listUrl` (survives a rename) or `listId` may replace it. |
| `titleTemplate` | `{row:AreaName} — {user:email}` | Fills `Title`. |
| `set` | `UserName`, `UserEmail`, `AttestationTime`, `Attestation` | `{user:name}`, `{user:email}`, `{now}` (one ISO UTC instant shared by every row of a submit; SharePoint shows it in the site's time zone), and the literal `Confirmed`: submitting is the confirmation (1.3.0; it was a checkbox before). |

## `submitConfirm`, `confirmation`, `strings`

- `submitConfirm` — the "are you sure?" dialog after validation: `title`,
  `message`, `confirm`, `cancel`. Focus starts on cancel; **Escape goes back**.
- `confirmation` — the thank-you screen: `title`, `message`,
  `allowAnother: false`, `illustration` (a path below `design/`; see
  *Asset paths stay inside `design/`*).
- `strings` — overrides for engine messages, all EN/FR pairs. The
  assignment wording (`assignCurrent`, `assignConfirm`, `assignChange`,
  `assignKeep`, `assignNewPlaceholder`, status words, `assignRowRequired`,
  `assignRowConfirmRequired`, `assignAllRequired`, `assignProgress`,
  `assignSomeDone`) and the partial-save messages (`rowsPartial`,
  `rowsFailed`) are set here. The full catalogue is `DEFAULT_STRINGS` near
  the top of the engine.

## The `zones` field (`type: "assignments"`)

| Key | Value | Notes |
| --- | --- | --- |
| `source` | Assignments list on `/teams/FCUWebDatastores` | `userColumn: UserEmail` (matches the user's profile email **or** UPN, any case), `labelColumn: AreaName`, `currentColumn: CurrentZone`, `orderBy: AreaName`. `top` defaults to 500; more matches show a warning, never a silent cut. |
| `responses` | `userColumn: UserEmail`, `keyColumn: LookupID` | Rows this user already answered (by copied ID) are skipped; all answered → the `allDone` screen. One read covers 5,000 earlier responses; past that a warning shows and "already submitted" is never claimed. |
| `column` | `ZoneSelection` | The answer per row. A confirmed row saves its current zone. |
| `previousColumn` / `changedColumn` | `PreviousZone` / `ZoneChanged` | The row's `CurrentZone` (left out if none) and whether the answer differs (`true` when there was none). |
| `rowColumns` | `LookupID ← ID`, `UserDescription`, `AreaName` | Copied from the source row into each response. |
| `choices` | the five zones | `{ value, label, color, description }`. Colours: `lime yellow berry orange red` (lime reads apart from red/orange for red-green colour blindness; `blue green gray sky teal lavender` also exist). |
| `choiceLabel`, `placeholder` | | Small heading on a row with no current zone; dropdown text. |
| `empty` / `allDone` | | Screens for "nothing assigned" and "already submitted". |

A row with a current zone shows it with a **confirm** box and **Change**;
Change opens a dropdown without the current zone, plus **Keep current zone**
to undo. A row with no (or an unrecognised) current zone gets the dropdown
straight away. The card wears the colour of the zone it shows.

The config validator refuses (error card instead of the form): a missing
`source.userColumn`, a `responses.keyColumn` that isn't a `rowColumns`
target, two assignments fields, `previousColumn` without
`source.currentColumn`, `previousColumn` equal to `column`, `changedColumn`
equal to a `rowColumns` target, and a language other than `en`/`fr`.

## The notices (`type: "note"`)

Since 1.3.0 there's no attestation checkbox. Notes carry the messages
instead: the review message is the header's `form.headerNote` (1.3.1), and
three notes sit in the `notices` section (first) and the `closing` section
(last):

| `id` | Where | Style | Says |
| --- | --- | --- | --- |
| `accessNotice` | top of the body | `feature` | "Who has access to your areas?", a line of text, and an *Employee access list* button to `{var:accessListUrl}` (new tab). |
| `changeNotice` | bottom | `info` | The review message again, **only while some row is changed**: `visibleWhen: { "field": "zones", "op": "anyChanged" }`. |
| `contactNotice` | bottom | `info` | "If you have questions or concerns, contact … at …", with a `mailto:` link. **Placeholder: set before go-live.** |

Note `style`s: `info` (default), `warning`, `success`, `danger` (a message
bar), `plain` (a hint line), and `feature` (1.3.1): the one message meant to
be acted on, as a card with an accent edge, an icon tile (`icon`: a sprite
name such as `person`), a `title`, the `text`, and a primary button
`{ "text", "url", "fromForm" }` that opens `url` in a new tab. `fromForm: true`
(1.3.3) keeps the new tab's link to the form's tab (`rel="opener"`, which
`target="_blank"` otherwise drops), so the access list's Back can check that
a form opened it. Only for a same-origin `url`: another origin always gets
`noopener`. The validator refuses an
unknown style and a `feature` note without `button.text` or with a
`button.url` that isn't http(s) or server-relative (after `{var:…}`).

`{var:name}` in a note's text (and a feature note's `button.url`) is filled
from `form.vars` when the config is read. `anyChanged` (1.3.0) is a rule op for an `assignments` field: true when
some row's answer differs from its current zone, counting a first zone on a
row that had none (the same test as `ZoneChanged`). Confirming a zone or
*Keep current zone* doesn't count. The validator refuses `anyChanged` on any
other field type.

## Submit, step by step

1. Validate every row; focus goes to the first problem.
2. `submitConfirm` asks ("Submit your confirmations?"). Nothing is saved
   until Confirm.
3. The answers are snapshotted and the form locks.
4. If an earlier attempt failed, the list is asked first which of the unsaved
   rows already landed (`reconcileRows`), and those are skipped.
5. One item per row is added, in order. A failure locks the saved rows and
   says how many are confirmed saved; submitting again sends only the rest.
6. The thank-you screen shows. A reload shows "already submitted".

Two tabs submitting at the same instant could still save a row twice. Only a
uniqueness rule on the list would stop that, and it would also block the next
confirmation round.

## When something fails — `errorLog`, `errorContact`

Two optional top-level keys in the form config. They're independent, and the
form ships with both:

```json
"errorLog": { "siteUrl": "/teams/FCUWebDatastores", "listTitle": "PS_Zone-Attestation-Errors" },
"errorContact": {
  "email": "form.admin@example.com",
  "subject": { "en": "PS Work Zone Confirmation: problem report", "fr": "…" }
}
```

- **`errorLog`**: a failure the user hits adds one item to this list. The
  failures are: the form couldn't start (`init`, once the config itself has
  loaded), couldn't load their areas (`load`), or couldn't save (`save`). The
  item carries `Title` (`[kind] message`), `ErrorKind`, `Message`, `Detail`
  (engine version, page, browser, time, user, list, rows saved), `UserEmail`
  and `EngineVersion`. A **SharePoint list rule** on that list emails the
  admin, with no Power Automate (`05-deploy-steps.md`, step 2b). The write is
  plain REST, so it works even when pnpjs failed to load. It's
  fire-and-forget: a failed write only warns in the console. At most one
  report per kind and 5 per page load. Needs `listTitle`; `siteUrl`
  defaults to the page's site. Users need **Add** on the list. The access
  list page reports its own failures the same way, as kind `access`.
- **`errorContact`**: with any of those errors, the user also sees an
  *Email the form administrator about this problem* link (French when the
  page is French). It's a `mailto:` to `email`, with `subject` (default
  "Problem with the form: {form title}"), and a body that asks what they
  were doing, then lists the same diagnostic lines. It's kept under ~1,800
  characters, because some mail clients cut longer links. A
  validation message never carries the link. `email` must be an address, or
  the config is refused. **It ships as a placeholder
  (`form.admin@example.com`): set it before go-live.**
- Not covered: a config that can't be fetched at all (the page shows the
  error card, and the console has the details), and the resources panel
  (static content).

## While saving — the overlay

From the confirmed submit until the save finishes (one item per area, so a
few seconds), a full-page scrim with a spinner covers the page. It says
"Submitting…" and asks the user not to close, refresh or go back. It blocks
clicks, takes focus (screen readers announce it), and the browser asks
before the page is closed or reloaded. Its wording is the strings
`savingTitle` and `savingMessage`, overridable in `strings` (EN/FR) like any
other. The form sets `savingTitle` to "Submitting your confirmations…".

## The resources panel — `src/ps-zone-attestation.resources.json`

A second web part for the page's narrow (right) column, mounted by the same
engine: `<div data-psz-resources data-config="…/ps-zone-attestation.resources.json">`
(snippet: `webpart/ps-zone-attestation-resources.webpart.html`). It's static:
no lists, no Alpine. It follows the same language as the form, and switches
with it.

```json
{
  "languages": ["en", "fr"],
  "sections": [
    { "heading": "Resources and guides", "items": [ { "type": "feature", … }, { "type": "link", … } ] },
    { "heading": "Information", "items": [ { "type": "text", … }, { "type": "contact", … } ] }
  ]
}
```

| Item `type` | Keys | Shows |
| --- | --- | --- |
| `feature` | `title`, `text`, `url`, `icon`, `description` | The large card the job aid used to have on the form (icon tile, title, text), then the description below it. |
| `link` | `title`, `url`, `icon`, `description` | A compact one-line document link, then its description. `icon` defaults to `document`; `document-pdf` suits a PDF. |
| `text` | `title`, `text` | A small heading and one paragraph. `text` takes links, bold and italic (*Formatting*). |
| `contact` | `name`, `email`, `title` | An optional small heading (e.g. "Questions?"), then a card with initials, the name and a mailto link. |

- **Links:** `url` empty → the item still shows, unlinked (that's how the
  placeholders appear). An http(s) or server-relative address → it opens in
  a new tab. Spaces in a path are encoded (`Shared Documents` works). Any
  other scheme (`javascript:` …) is never linked.
- **Icons:** a path under `design/` (`abacus-icons/light-bulb-48.svg`) or a
  sprite name (`document`, `document-pdf`, `shield`, `info`, `folder` …,
  the `fluent-basic-icons.svg` set).
- `description` (on `feature`, `link`, `contact`) takes links, bold and italic (*Formatting*).
  Every text can be an `{ "en", "fr" }` pair.
- The validator refuses (an error card in the panel, the form unaffected):
  no sections, a section without `items`, an unknown `type`, a
  `feature`/`link`/`text` without `title`, a `contact` without `name`, a
  language other than `en`/`fr`. A contact `email` that isn't an address is
  shown without a mailto link.

## The employee access list — `src/ps-zone-attestation.access.json`

A third web part, on a **page of its own**, mounted by the same engine:
`<div data-psz-access data-config="…/ps-zone-attestation.access.json">`
(snippet: `webpart/ps-zone-attestation-access.webpart.html`). The form's
`accessNotice` links to it, and it opens in a new tab. For information only:
nothing on it is saved.

It reads the signed-in user's rows from the Assignments list (the same
user match as the form: profile email or UPN, any case), then the Access
list's rows for those areas, and shows one **accordion panel per area**
(native `<details>`, all expanded, sorted by area). Each panel lists the
area's employees by name, in **two columns** of name + email (a mailto link;
one column when the page is narrow). *Expand all* / *Collapse all* appear
when there's more than one area.

```json
{
  "languages": ["en", "fr"],
  "title": …, "back": …, "intro": "… [zone confirmation tool]({var:formUrl}).",
  "vars": { "formUrl": "/sites/FCUPortal/SitePages/PS-Work-Zone-Confirmation.aspx" },
  "assignments": { "siteUrl": "/teams/FCUWebDatastores", "listTitle": "PS_Zone-Attestation-Assignments",
                   "userColumn": "UserEmail", "labelColumn": "AreaName", "orderBy": "AreaName" },
  "access": { "siteUrl": "/teams/FCUWebDatastores", "listTitle": "PS_Zone-Attestation-Access",
              "areaColumn": "AreaName", "nameColumn": "EmployeeName", "emailColumn": "EmployeeEmail" },
  "empty": { "title": …, "message": … },
  "errorLog": { … }, "errorContact": { … }
}
```

| Key | Notes |
| --- | --- |
| `title`, `back`, `intro` | EN/FR pairs. `back` is the link above the card (default "Back"). `intro` is the info bar. |
| `vars.formUrl` | The form page. The back link goes there, and so does any intro link to that same address. **Back** closes the tab only when a form opened it: the tab is still on its first page and its `window.opener` is a same-origin page where this engine started a form (a ready `[data-psz-form]` mount in its `PSZoneForm._defs`; an empty div isn't enough). The form's button keeps the opener (`button.fromForm`); the engine sets that itself, a config can't force it. It brings the form's tab forward and closes this one, so the answers stay intact. Otherwise (opened from anywhere else, navigated since, the form tab closed, or a browser that refuses) it follows the link. A URL flag can't do this: any page can put one in a link (Codex, xo turn 4). Must be http(s) or server-relative, or there's no back link. |
| `assignments` | `listTitle` or `listUrl`, `userColumn`, `labelColumn` required; `top` (default 500). |
| `access` | `listTitle` or `listUrl`, `areaColumn`, `nameColumn`, `emailColumn` required; `top` (default 2,000 per 20 areas, at most 4,999). A cut-off read shows a warning. Areas are matched by SharePoint's `eq`: case-blind, but a leading or trailing space in either list means no match; a row for an area that isn't the user's never shows. |
| `empty` | The "no areas assigned" screen, shown only when the read was complete. A cut-off read with no usable area shows "Your areas couldn’t all be loaded" instead (`accessPartialTitle`, `accessPartialMessage`). |
| `strings` | Overrides for its engine messages (`accessLoading`, `accessLoadError`, `accessNoEmployees`, `accessCount`, `accessExpandAll`, …: `DEFAULT_STRINGS`). |
| `errorLog`, `errorContact` | As on the form. A failed read logs kind `access` and offers the email link beside *Try again*. |

The validator refuses (an error card on the page): a missing list or column
key, a language other than `en`/`fr`. The Access list's `AreaName` should be
indexed, or the filter fails once the list passes 5,000 rows.

**Privacy:** the page shows each user only their own areas, but it reads with
the user's own rights, so everyone who uses it needs **Read** on the whole
Access list (`05-deploy-steps.md`, step 2).
