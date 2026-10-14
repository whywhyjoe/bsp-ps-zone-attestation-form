# bsp-ps-zone-attestation-form

The Physical Security Zones Attestation form for the FCU Portal: each
employee confirms or changes the security zone of every area assigned to
them, and the form saves one response per area to a SharePoint list.

It stands on its own. The form engine, its CSS, the design-system pieces it
uses, Alpine, pnpjs and the bilingual library are all **vendored** into one
folder, [`src/`](src/), which deploys as a unit. Nothing in this repo loads
from the shared `Code/bsp-forms`, `Code/bsp-design` or `Code/lib`
folders, so changes there can't break the attestation.

```
src/                              → deployed whole to …/Code/ps-zone-attestation/
├─ ps-zone-attestation.js         the engine (a renamed fork of BSP Forms 0.5.1)
├─ ps-zone-attestation.css        its layer
├─ ps-zone-attestation.json       the form: lists, zones, wording (EN/FR)
├─ design/                        the BSP design-system files it needs, nothing more
└─ lib/                           alpine.js · pnp2.bundle.js · intl.js
```

## Running it

```bash
python -m http.server 8646
```

Then open `http://localhost:8646/dev/index.html`. It's the real `src/`
folder with SharePoint mocked. Add `?validate` for the column check,
`?lang=fr` for French or `?Mode=Edit` for the edit-mode placeholder.

```bash
node tests/smoke.cjs
```

This runs the regression suite (100 checks, Playwright). See
[`tests/README.md`](tests/README.md).

## Deploying

**Follow [`docs/05-deploy-steps.md`](docs/05-deploy-steps.md).** It's step
by step, for someone new to the project, with a check after each step. In
short: create two lists, upload the contents of `src/` to
`/sites/FCUPortal/Code/ps-zone-attestation/`, add one web part to a page of
its own, and check it. No build and no install.

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
