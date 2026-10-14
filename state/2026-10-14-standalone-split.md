# State — Standalone split from bsp-sp-parts

Last touched: 2026-10-14
Branch: `main` (new repo, committed locally, no remote yet)
State: repo scaffolded and populated; harness suite 90/90 green; dev live
run not done; **prod untouched**.

## What was done

The zone attestation was a config of the shared BSP Forms engine in
`bsp-sp-parts/bsp-forms`. Because it's critical, the user had it split into
this repo so nothing shared can break it (2026-10-14). Everything it loads
now sits in `src/`, which deploys as one folder. See `docs/04-vendoring.md`
for what was copied from where.

## Decisions (user, 2026-10-14)

- projects-standard profile `sp-app`, with the `browser-tests` and
  `design-system` fragments wanted. Neither fragment exists yet in the
  standard (0.3.1), so their jobs are done by hand here.
- **Renamed fork**, not a byte-identical copy: the shared engine on the same
  page would otherwise mount or skip this form.
- **bsp-sp-parts keeps its copy** of the config (its suite's assignments
  reference), with a pointer to this repo as the deploy source.

## Next

- [ ] Create the GitHub repo and push, if wanted (initial commit is local only).
- [ ] Dev live run: `dev/live/live-deploy.ps1 -Ver 1.0.0` →
      `node dev/live/live-zone.js` (admin) → `--as <profile>` (non-admin).
- [ ] Content: real zone descriptions, official French names, job aid URL.
- [ ] Prod install (`docs/01-hosting-and-deploy.md`).

## Landmines

- The suite needs Playwright through `NODE_PATH`
  (`C:/dev/repos/sp-traffic-analytics/node_modules` worked) and a server on
  the repo root. On this machine, `C:/dev/repos` served on 8647 also works:
  pass `http://127.0.0.1:8647/bsp-ps-zone-attestation-form/dev/index.html`.
- `live-deploy.ps1` swaps exact lines in the config. Keep the JSON
  hand-formatted.
- Dev's shared `<code>/bsp-forms/` is the builder branch's 0.6.0. This repo
  never touches it (its own folder), so no backup/restore is needed. That's
  unlike the bsp-forms live runs.
