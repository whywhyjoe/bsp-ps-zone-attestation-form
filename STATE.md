# STATE — bsp-ps-zone-attestation-form

**Rewritten, never appended.** History lives in `LOG.md`. Cap: 150 lines — if
it is growing, something belongs in `LOG.md` or `docs/`.

Threads of work in progress: [`state/`](state/), one file per thread, kept by
the `project-state` skill.

## Where things stand

| | |
| --- | --- |
| **Version** | engine 1.0.0 (fork of BSP Forms 0.5.1), config as of bsp-sp-parts `fe5c040` |
| **Deployed** | Nowhere yet. Prod has never had the zone attestation, and dev has only the BSP Forms copy (`<code>/bsp-forms-zc/`), not this folder. |
| **Last shipped** | — (repo created 2026-10-14; harness suite 90/90 green) |

## Next committed step

Dev live run of this folder: `dev/live/live-deploy.ps1 -Ver 1.0.0`, then
`node dev/live/live-zone.js` as admin and `--as <profile>` as a non-admin.
The scripts are ported but haven't run from this repo yet.

## Blocking

- [ ] Dev live run green from this repo (above).
- [ ] Real zone descriptions and the official French zone names (form JSON
      only; today they're `[Placeholder]` drafts).
- [ ] The job aid's URL for `form.vars.jobAidUrl` (the card hides until set).

## Manual gates

- [ ] Prod install per `docs/01-hosting-and-deploy.md`: lists, columns,
      permissions, `CurrentZone` filled, folder uploaded, page built, the
      doctor all OK, Network shows nothing outside
      `Code/ps-zone-attestation/`.
- [ ] One prod submit as an ordinary attester: one item per area, reload
      says already submitted, and the attester can't see others' responses.
- [ ] `?lang=fr` on prod renders French.

## Deferred by design

- **Trimming the engine** to the zone form's features. It would shrink the
  attack surface, but it's a rewrite of tested code. Revisit only if the
  unused paths cause a real problem.
- **A fast (pure, no-DOM) test tier.** The engine is one IIFE with no
  importable pure module. Extracting one is a refactor for later.
- **Tracking upstream BSP Forms.** It's a frozen fork. Fixes are ported
  deliberately (`docs/04-vendoring.md`).
- **Real language detection.** It's intl.js's placeholder (`?lang=fr`) until
  `bilingual/intl.js` ships detection and it's re-vendored here.

## Open questions

- Where on prod does the folder live? The docs assume
  `/sites/FCUPortal/Code/ps-zone-attestation/`. Settle it at deploy time and
  update the web part snippet's default.
- Should the item-level Read flow on the Assignments list (privacy of
  others' assignments) be in place before go-live? It's the business
  owner's call (`docs/02-sharepoint-data.md`).
