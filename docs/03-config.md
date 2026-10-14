# The form config — `src/ps-zone-attestation.json`

Everything a business owner might ask to change lives in this one JSON file:
wording in both languages, the five zones and their descriptions, the job aid
link and the list names. It's fetched uncached (`cache: 'no-cache'`), so an
edit to the **deployed** copy is live on the next page load, with no `?v=`
bump.

**Keep the hand formatting.** `dev/live/live-deploy.ps1` finds exact lines in
it (`"siteUrl": "/teams/FCUWebDatastores"` twice, `"jobAidUrl": ""`). Edit
it as text, never round-trip it through a JSON serializer.

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

## `form`

| Key | In this form | Notes |
| --- | --- | --- |
| `title`, `intro` | EN/FR pairs | `intro` takes `[text](url)` links (http(s), mailto, `/…`, `#…`; anything else stays literal). |
| `appearance` | card · band · sky | Frame, header band, band tint (`sky` `blue` `neutral`). |
| `vars.jobAidUrl` | `""` | The job aid's address. While empty, or not http(s)/server-relative, the job aid card is hidden. |
| `headerCard` | job aid tile | `{ title, text, url, icon }`; `url` is `{var:jobAidUrl}`; opens in a new tab. `icon` is a path under `design/` (`abacus-icons/light-bulb-48.svg`). A new icon file must be vendored into `src/design/` first (`04-vendoring.md`). |

## `target` — where responses are saved

| Key | Value | Notes |
| --- | --- | --- |
| `siteUrl` | `/teams/FCUWebDatastores` | The lists' site; the page is on `/sites/FCUPortal`. |
| `listTitle` | `PS_Zone-Attestation-Responses` | `listUrl` (survives a rename) or `listId` may replace it. |
| `titleTemplate` | `{row:AreaName} — {user:email}` | Fills `Title`. |
| `set` | `UserName`, `UserEmail`, `AttestationTime` | `{user:name}`, `{user:email}`, `{now}` (one ISO UTC instant shared by every row of a submit; SharePoint shows it in the site's time zone). |

## `submitConfirm`, `confirmation`, `strings`

- `submitConfirm` — the "are you sure?" dialog after validation: `title`,
  `message`, `confirm`, `cancel`. Focus starts on cancel; **Escape goes back**.
- `confirmation` — the thank-you screen: `title`, `message`,
  `allowAnother: false`, `illustration` (a path under `design/`).
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

## The attestation checkbox

`attestation` is a `boolean` with `control: "checkbox"`, `required`, and
`values: { "on": "Confirmed", "off": "" }` saved to `Attestation` on every
row's item. Its section has `tint: "blue"`.

## Submit, step by step

1. Validate every row and the checkbox; focus goes to the first problem.
2. `submitConfirm` asks. Nothing is saved until Confirm.
3. The answers are snapshotted and the form locks.
4. If an earlier attempt failed, the list is asked first which of the unsaved
   rows already landed (`reconcileRows`), and those are skipped.
5. One item per row is added, in order. A failure locks the saved rows and
   says how many are confirmed saved; submitting again sends only the rest.
6. The thank-you screen shows. A reload shows "already submitted".

Two tabs submitting at the same instant could still save a row twice. Only a
uniqueness rule on the list would stop that, and it would also block the next
attestation round.
