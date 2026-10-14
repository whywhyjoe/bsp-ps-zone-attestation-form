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

Upload `src/` to the portal's `Code` library as `ps-zone-attestation/`,
create the two lists, and paste the snippet from
[`webpart/ps-zone-attestation.webpart.html`](webpart/ps-zone-attestation.webpart.html)
into a Modern Script Editor web part on the attestation's own page. Steps and
checks: [`docs/01-hosting-and-deploy.md`](docs/01-hosting-and-deploy.md).

## Where to look

| | |
| --- | --- |
| How it works | [`docs/README.md`](docs/README.md) |
| Where things stand | [`STATE.md`](STATE.md) |
| What shipped when | [`LOG.md`](LOG.md) |
| Rules for agents | [`CLAUDE.md`](CLAUDE.md) |
