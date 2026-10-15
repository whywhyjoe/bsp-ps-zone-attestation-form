# LOG — bsp-ps-zone-attestation-form

**Append-only.** One entry per ship or merge — not per session. Current state
is in `STATE.md`.

Newest first.

---

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
