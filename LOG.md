# LOG — bsp-ps-zone-attestation-form

**Append-only.** One entry per ship or merge — not per session. Current state
is in `STATE.md`.

Newest first.

---

## 2026-10-15 — engine 1.4.5: header and submit-button layout

From a production screenshot:
- The header's "changes will be reviewed" callout was wider than the intro
  above it (the intro was capped at 64ch). With the who card beside it,
  the intro now spans the column, so the two match.
- The "Confirmation by" card stretched to 340px; it's now only as wide as
  its content (up to 340px).
- Zone descriptions were capped at 72ch; they now fill the card.
- New `form.appearance.submit: "prominent"` (on in this form): the submit
  button large (48px), centred, with a checkmark icon; full width on a
  narrow page.

Four layout checks (two at production width) fail against the 1.4.4 CSS.
Suite 262/262; dev admin run 33/33.

## 2026-10-15 — engine 1.4.4: refused links keep a typed \*

Codex's re-review of 1.4.3 (xo turn 10) closed the turn-9 security finding
with no regressions and found one cosmetic gap: a link refused by the
finished-address check turned a typed `\*` into `*`. It now keeps `\*` as
typed. 68 cases; the new one fails with the fix reverted. Not re-reviewed
(one line). Suite 257/257; dev admin run 33/33.

The markdown subset went through four Codex rounds (xo turns 7–10); the case
table `tests/markdown-cases.cjs` with its header's template contract is the
spec to port to BSP Forms and intl.js.

## 2026-10-15 — engine 1.4.3: Codex turn-9 findings on the markdown subset

- **High:** a list value containing the formatter's placeholder characters
  could stand for a second value filled in later, rebuilding an off-site
  `//host` link after the address check passed. Values are now cleaned of
  those characters before anything is checked or inserted.
- A link refused by the finished-address check is set aside like an
  accepted one, so it stays entirely as typed (its text unformatted).

67 cases; each fix's two cases fail with it reverted (the first reproduces
Codex's exploit exactly). Suite 256/256; dev admin run 33/33.

## 2026-10-15 — engine 1.4.2: Codex turn-8 findings on the markdown subset

- **High:** a data value inside a link address could finish it as
  `//host` (`[x](/{field:area})` with `/host`) after the address check had
  passed. The finished address, values in, is now checked again; a failing
  link stays as typed and its values go back in as text.
- The shared case table now specifies the template contract (held values,
  as an optional 4th element) and the 4,000 / 4,001-character boundary:
  63 cases, so a port can't pass it while formatting data or skipping the
  bound.
- The wording document matches whole path segments (`button`), not the
  word anywhere; its classifier has a self-test.

Suite 252/252; dev admin run 33/33.

## 2026-10-15 — engine 1.4.1: Codex review of the markdown subset (xo turn 7)

- **High, older than the markdown:** a link address starting `//host` (or
  `/\host`, which browsers read the same) passed as "server-relative" and
  pointed off-site. Links and `safeHref` now require exactly one leading
  slash. The shared BSP Forms engine has the same link rule.
- A result message (`afterSubmit` / `queryError`) formatted the data it
  filled in: list values now go back in after formatting, escaped.
- Emphasis no longer spans `\r` or the Unicode line separators.
- "Inside a word" counts accented letters (Latin-1, Latin Extended-A/B).
- Crossed markers (`*a **b* c**`) and bold holding an unpaired `*` stay as
  typed.
- A text over 4,000 characters shows plain (a margin: the worst case
  measured ~50 ms at 4,000 without it).
- The wording document and docs list exactly prose()'s inputs (hints, lock
  notes, result messages added).

52 cases now; each fix's cases fail with it reverted. Suite 241/241; dev
admin run 33/33.

## 2026-10-15 — engine 1.4.0: inline markdown in author text

`prose()` (every longer config text: intros, notes, descriptions, screen and
dialog messages, the side panel's paragraphs, the access list's intro)
takes a fixed inline subset on top of the links it already had:
`**bold**`, `*italic*` (either inside the other, or inside a link's text)
and `\*` for a literal asterisk. Everything is escaped first; links are held
aside while emphasis is matched, so markers in a URL are never touched;
markers must hug their text, so `5 * 3`, `a*b`, `Public*` and an unclosed
`**` stay as typed. No block markup: headings, lists and dividers show as
written (wanted later for BSP Forms, other parts and intl.js; not this form).

The behaviour is the case table `tests/markdown-cases.cjs` (39 cases),
written to be copied to those other parts. The SME wording document marks
the 21 rows that take formatting. Suite 226/226; dev admin run 33/33.

## 2026-10-15 — engine 1.3.4: Codex turn-5 findings

- **Opener only by the engine:** a config could set the button's internal
  `_keepOpener` and keep `window.opener` for another origin. Normalization
  now resets it before the same-origin check.
- **Back needs a started form:** an empty `[data-psz-form]` div on a
  same-origin page no longer counts; the opener must have a ready form
  mount in its `PSZoneForm._defs`. A same-origin page faking the engine's
  globals could still pass; same origin can do far more than close a tab.
- **Audit matches the page:** `audit-access` flags a row with neither
  `EmployeeName` nor `EmployeeEmail` (the page drops it) and no longer
  counts it as covering its area.

Suite 182/182; dev admin run 32/32.

## 2026-10-15 — engine 1.3.3: Codex re-review follow-ups (xo turn 4)

Codex's re-review closed two of turn 3's findings (cut-off warning,
prototype-named areas) and kept two open, plus one new low:

- **Back provenance:** 1.3.2's `pszFrom=form` URL flag proved nothing (any
  page can put it in a link). Now the form's button keeps the new tab's
  `window.opener` (`rel="opener"`, same-origin targets only; another origin
  still gets `noopener`), and Back closes the tab only when that opener is
  a same-origin page with a `[data-psz-form]` mount. Verified on the dev
  tenant (Back still closes the form's tab).
- **Area names with outer spaces:** the page can't fix bad data (SharePoint's
  `eq` doesn't trim; a contains-search wouldn't survive 5,000 rows). The
  DCSPad setup script gets a read-only `MODE = "audit-access"` listing every
  access row that will never show (space at either end, blank, or not in
  the Assignments list) and the assigned areas with nobody listed. The
  deploy guide runs it in step 3.
- **Partial empty screen:** a cut-off read with no usable area now says
  "Your areas couldn't all be loaded" instead of "No areas assigned".

Each new check fails with its fix reverted. Suite 180/180; dev admin run
32/32.

## 2026-10-15 — engine 1.3.2: Codex review of the access list (xo turn 3)

Codex reviewed 1.3.0's employee access list: no critical or high findings.
All four fixed, each with a check shown to fail without its fix:

- **Outer spaces in area names:** SharePoint's `eq` matches case-blind but
  doesn't trim, so an Access row with a leading or trailing space never
  showed, while the docs said spaces didn't matter and the mock trimmed
  (hiding it). The mock now matches as SharePoint does, the docs say
  spaces count, and the dev live run checks it on the real list (a
  different-case row shows, a spaced one doesn't).
- **Cut-off read with no usable area:** the page showed "No areas assigned"
  without the cut-off warning; the warning now shows above it.
- **Back closing the wrong tab:** Back closed any new tab still on its
  first page. Now the form's button marks the URL (`button.fromForm` →
  `pszFrom=form`) and Back closes only a tab carrying it.
- **Prototype-named areas:** maps keyed by area name are null-prototype,
  so an area called `constructor` or `toString` gets its panel.

Suite 178/178; dev admin run 32/32.

## 2026-10-15 — engine 1.3.1: header who card and callout, access callout

- `form.headerUser` puts the who card ("Confirmation by:") in the header
  band as its right column (it drops under the intro below ~720px); the
  body's `currentUser` field is gone.
- `form.headerNote` puts the "changes will be reviewed" callout in the
  header band, under the intro.
- New note style `feature`: an accent-edged card with an icon tile, a
  title, text and a primary button opening `button.url` in a new tab. The
  access list notice uses it ("Who has access to your areas?" + an
  *Employee access list* button). The validator now refuses unknown note
  styles and a feature note without a safe button url.
- Suite 175/175; dev admin run 31/31.

## 2026-10-15 — engine 1.3.0: Work Zone Confirmation, notices, employee access list

- **Wording:** the form is now the *Physical Security Work Zone
  Confirmation* (EN + FR draft). The page's "attestation" wording became
  "confirmation": the submit button, the "Submit your confirmations?"
  dialog, the saving overlay, the thank-you and already-submitted screens,
  "Confirmation by:". List and column names are unchanged.
- **No checkbox:** submitting is the confirmation; every response still
  saves `Attestation = Confirmed` (`target.set`).
- **Notices:** info bars at the top (changes will be reviewed; a link to
  the access list in a new tab), and at the bottom a contact message and,
  only while some zone is changed, the review message again. New rule op
  `anyChanged` for an assignments field; `{var:…}` in note text, with
  `PSZ_FORM_SETTINGS.vars` overriding `form.vars`.
- **Employee access list:** a third web part (`data-psz-access`,
  `ps-zone-attestation.access.json`) on a page of its own: the user's areas
  from Assignments, each an open `<details>` panel listing its employees
  from the new `PS_Zone-Attestation-Access` list, by name, two columns of
  name + mailto email. Expand/collapse all, back link (closes the tab when
  opened from the form), EN/FR, error log kind `access` with the email
  link, edit-mode placeholder. Adapter `getAccess` + mock twin.
- **Found on the dev tenant:** a modern SharePoint page navigates a
  same-tenant link in place, ignoring `target="_blank"`, which would have
  replaced a half-filled form. Every new-tab link (and the back links) now
  carries `data-interception="off"`; this also fixes the resources panel's
  and the config prose's same-tenant links.
- Setup script, dev scripts and docs cover the fourth list and second page.
  Suite 171/171 (each new check shown to fail when what it guards breaks);
  dev admin run 31/31.

## 2026-10-15 — engine 1.2.1: icons under VS Code Live Server

Live Server injects its reload script before every `</svg>` in an `.svg`,
including the example one in the sprite's header comment. The injected
`<!-- … -->` ended that comment early and closed the sprite before any
symbol, so no icons showed. The engine strips Live Server's block before
parsing, and warns if a sprite ever parses with no symbols. A suite check
reproduces Live Server's rewrite (it fails without the fix: 0 symbols, all
42 icons missing). The harness pages link to each other (form only ↔ with
the resources sidebar). Suite 132/132.

## 2026-10-14 — engine 1.2.0: error reporting, saving overlay

- **Error log:** a failure the user hits (`init` once the config has
  loaded, `load` of their areas, `save`) adds one item to the
  `PS_Zone-Attestation-Errors` list (config `errorLog`). A SharePoint list
  rule there emails the admin, with no Power Automate. Plain REST, so a
  failed pnp load is reportable too. Fire-and-forget, at most one per kind
  and 5 per page load.
- **Email link for the user:** the same errors show an *Email the form
  administrator about this problem* `mailto:` (config `errorContact`), with
  the configured subject and a body pre-filled with what happened plus
  diagnostics. Never beside a validation message. EN/FR.
- **Saving overlay:** a full-page scrim with a spinner while a submit runs
  ("Submitting your attestation…", don't close, refresh or go back). It
  blocks clicks, takes focus, and has a `beforeunload` guard.
- The DCSPad setup script and the dev list script create the Errors list.
  The deploy guide has the third list, its permissions, and step 2b (the
  email rule). `errorContact.email` is a placeholder until prod.

## 2026-10-14 — engine 1.1.0: resources side panel; job aid off the form

The job aid card is gone from the form's header, and the intro now spans
the header. A second web part, the **resources panel**
(`data-psz-resources`, `src/ps-zone-attestation.resources.json`,
`webpart/ps-zone-attestation-resources.webpart.html`), is mounted by the
same engine for the page's ⅓ column. It shows resources and guides (the job
aid card as it looked on the form, compact document links), information
text and a contact card, all placeholders for now. It's static, bilingual
with the form, has its own edit-mode placeholder and error card, and
encodes spaces in document paths. `dev/page.html` shows both side by side.
Suite 113/113. `?v=1.1.0`.

## 2026-10-14 — Codex review fixes (xo turns 1–2)

Codex reviewed main (turn 1) and the fixes (turn 2). Test and doc changes
only; `src/` untouched. The request-boundary check allows exactly the
harness page and mock. The coexistence checks load the real BSP Forms 0.5.1
(`tests/fixtures/`, dev-only) before and after this engine, and compare every
computed style of the zone form against the form alone. Config asset paths
must resolve inside `design/`. The overview's CSS claims are corrected
(*Page-wide CSS*, the shared `[x-cloak]` rule). Each new check was shown to
fail on its breakage. Suite 100/100.

## 2026-10-14 — merged crew/zone-split-review (`9a416c3`)

An xo crew experiment ran review → fix → re-review → fix on the split. Its
reviewer found two real defects: the suite's pnp check bypassed the engine's
loader, and `live-deploy.ps1` uploaded files and recycled the page before
validating the config and template. Both fixed, plus load-state waits for
the flaky zone checks and corrected cache docs. Suite 93/93. Nothing under
`src/` changed. The crew's plan files (`docs/plans/`) were removed after the
merge; git history has them.

## 2026-10-14 — split out of bsp-sp-parts; scaffolded

Started from [projects-standard](https://github.com/whywhyjoe/projects-standard)
0.3.1, profile `sp-app`. Made standalone from `bsp-sp-parts` `fe5c040`:
the BSP Forms 0.5.1 engine and CSS forked and renamed (`PSZoneForm`,
`data-psz-form`, `.psz-*`) as engine 1.0.0; the zone config copied as is;
the BSP design-system subset (tokens, components, sprite, two images) and
Alpine 3.15.2, pnpjs v2 and intl.js 1.1.4 vendored into `src/` with their
provenance in `docs/04-vendoring.md`. Harness and the zone half of the smoke
suite ported, plus standalone checks: 90/90 green. Dev live scripts ported
and not yet run. Nothing deployed.
