# bsp-ps-zone-attestation-form

The Physical Security Work Zone Confirmation form for the FCU Portal
(formerly the Zones Attestation): each employee confirms or changes the
security zone of every area assigned to them, and the form saves one
response per area to a SharePoint list. A second page lists the employees
who have access to each of their areas, for information.

It stands on its own. The form engine, its CSS, the design-system pieces it
uses, Alpine, pnpjs and the bilingual library are all **vendored** into one
folder, [`src/`](src/), which deploys as a unit. Nothing in this repo loads
from the shared `Code/bsp-forms`, `Code/bsp-design` or `Code/lib`
folders, so changes there can't break the form.

```
src/                              → deployed whole to …/Code/ps-zone-attestation/
├─ ps-zone-attestation.js         the engine (a renamed fork of BSP Forms 0.5.1)
├─ ps-zone-attestation.css        its layer
├─ ps-zone-attestation.json       the form: lists, zones, wording (EN/FR)
├─ ps-zone-attestation.resources.json   the side panel: guides, info, contact
├─ ps-zone-attestation.access.json      the employee access list page
├─ design/                        the BSP design-system files it needs, nothing more
└─ lib/                           alpine.js · pnp2.bundle.js · intl.js
```

Three web parts on the one engine. The form page has the form (left, ⅔) and
a resources panel (right, ⅓) with the job aid, document links, information
and a contact. The access list page, linked from the form, shows each of the
user's areas with the employees who have access to it.

## Running it

```bash
python -m http.server 8646
```

Then open `http://localhost:8646/dev/page.html` for the whole page (form +
side panel), `dev/index.html` for the form alone, or `dev/access.html` for
the access list. It's the real `src/`
folder with SharePoint mocked. Add `?validate` for the column check (form
only), `?lang=fr` for French or `?Mode=Edit` for the edit-mode placeholder.

```bash
node tests/smoke.cjs
```

This runs the regression suite (252 checks, Playwright). See
[`tests/README.md`](tests/README.md).

## Deploying

**Follow [`docs/05-deploy-steps.md`](docs/05-deploy-steps.md).** It's step
by step, for someone new to the project, with a check after each step. In
short: create four lists (one is the error log, one the access list), upload
the contents of `src/` to `/sites/FCUPortal/Code/ps-zone-attestation/`, add
two web parts to the form's page and one to the access list's page, and
check it. No build and no install.

Using Copilot? It picks up
[`.github/copilot-instructions.md`](.github/copilot-instructions.md), which
points it at the same guide.

## Where to look

| | |
| --- | --- |
| How it works | [`docs/README.md`](docs/README.md) |
| Where things stand | [`STATE.md`](STATE.md) |
| What shipped when | [`LOG.md`](LOG.md) |
| Rules for agents | [`CLAUDE.md`](CLAUDE.md) |
