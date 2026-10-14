# State — Standalone split from bsp-sp-parts

Last touched: 2026-10-14
Branch: `main`, pushed to private GitHub repo
`whywhyjoe/bsp-ps-zone-attestation-form`. `crew/zone-split-review` was merged
(`9a416c3`), then its branch and worktree were deleted.
State: split done; three review rounds behind it (crew, Codex turn 1, Codex
re-review turn 2), all fixes committed on main; suite 100/100 green. Dev
live run not done; **prod untouched**.

## What was done

The zone attestation was a config of the shared BSP Forms engine in
`bsp-sp-parts/bsp-forms`. Because it's critical, the user had it split into
this repo so nothing shared can break it (2026-10-14). Everything it loads
sits in `src/`, which deploys as one folder (`docs/04-vendoring.md`).

Review round 1 (xo crew, merged): the real pnp loader is now tested,
`live-deploy.ps1` validates before it touches the tenant, the zone checks
wait on load state, and the cache docs are corrected. Review round 2 (Codex,
xo turn 1 in this repo): request-boundary check tightened to the harness
page and mock; the coexistence check now loads the real BSP Forms 0.5.1
(`tests/fixtures/`) before and after this engine; config asset paths must
be relative (tested + documented); the overview's wrong "CSS can't leak"
claim is replaced by *Page-wide CSS*. Re-review (turn 2) closed the boundary
and coexistence fixes and found three more, all fixed: the asset-path check
now also rejects `../` escapes; the style comparison covers every computed
property and can't match two empty forms; the overview admits the shared
`[x-cloak]` rule. A further hole found while testing (a shared engine
assigning `window.PSZoneForm`) is now checked too. Each new check was shown
to fail on the breakage it guards.

Deploy handoff: `docs/05-deploy-steps.md` is a step-by-step prod guide for a
developer new to the project (checks after every step, troubleshooting
table), and `.github/copilot-instructions.md` points Copilot at it.
`deploy/dcspad-setup-lists.js` creates both lists and seeds `TEST - ` rows
for four attesters (incl. no-zone cases), with a `remove-test-data` mode.
Verified against an in-memory REST mock (dry run, setup, rerun, removal),
**not yet run on a real tenant**.

## Decisions (user, 2026-10-14)

- projects-standard profile `sp-app`, with the `browser-tests` and
  `design-system` fragments wanted. Neither fragment exists yet in the
  standard (0.3.1), so their jobs are done by hand here.
- **Renamed fork**, not a byte-identical copy: the shared engine on the same
  page would otherwise mount or skip this form.
- **bsp-sp-parts keeps its copy** of the config (its suite's assignments
  reference), with a pointer to this repo as the deploy source.
- **Merge the crew branch** into main before fixing the Codex findings.
- The crew experiment is over for now (too much babysitting). Lessons are in
  xo `state/2026-10-14-crew-run-lessons.md`.

## Next

- [ ] Try `deploy/dcspad-setup-lists.js` on the dev tenant (dry run, setup,
      remove-test-data) before prod.
- [x] Dev deploy (`live-deploy.ps1 -Ver 1.0.0`) and admin live run:
      23/23 on 2026-10-14. On the live page, all 11 form files loaded from
      `Code/ps-zone-attestation/` and none from the shared folders; no
      `BSPForms` on the page.
- [ ] Non-admin live run: `node dev/live/live-zone.js --as <profile>`.
- [ ] Content: real zone descriptions, official French names, job aid URL.
- [ ] Prod install (`docs/01-hosting-and-deploy.md`).

## Landmines

- The suite needs Playwright through `NODE_PATH`
  (`C:/dev/repos/sp-traffic-analytics/node_modules` worked) and a server on
  the repo root. On this machine, `C:/dev/repos` served on 8647 also works:
  pass `http://127.0.0.1:8647/bsp-ps-zone-attestation-form/dev/index.html`.
  Two suite runs at once used to flake; the load-state waits fixed that.
- `live-deploy.ps1` swaps exact lines in the config. Keep the JSON
  hand-formatted.
- Dev's shared `<code>/bsp-forms/` is the builder branch's 0.6.0. This repo
  never touches it (its own folder), so no backup/restore is needed. That's
  unlike the bsp-forms live runs.
