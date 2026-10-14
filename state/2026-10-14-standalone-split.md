# State — Standalone split from bsp-sp-parts

Last touched: 2026-10-14
Branch: `crew/zone-split-review` (review branch; Joe decides whether to merge)
State: Fix 1 and Fix 2 (test-only) committed. Fix 2 passed four local 93-check
runs (two sequential, then two concurrent); final reviewer sign-off is pending.
Dev live run not done; **prod untouched**.

## What was done

The zone attestation was a config of the shared BSP Forms engine in
`bsp-sp-parts/bsp-forms`. Because it's critical, the user had it split into
this repo so nothing shared can break it (2026-10-14). Everything it loads
now sits in `src/`, which deploys as one folder. See `docs/04-vendoring.md`
for what was copied from where.

On the separate `crew/zone-split-review` branch, the hosting and vendoring
guides' cache instructions were corrected during review 1: design CSS and the
icon sprite have no per-file URL override. The final review is pending.

The overview and hosting guide now distinguish asset requests from SharePoint
REST calls when describing the standalone check and deploy verification.

Fix 1 (docs/plans/step-1.md): `testStandalone` gained a non-mock loader block
(3 checks, suite now 93), and `live-deploy.ps1`
now runs config + template-marker checks before uploading or recycling anything.
Nothing under `src/` changed.

Rook's local suite runs on the review branch disagreed with Brume's 93/93:
one stopped at the done screen after Confirm (`tests/smoke.cjs:175`), another
failed three zone checks (one row already submitted, everything submitted,
earlier-responses read cut off). Cause: `openZone` slept a fixed 1200 ms and
the checks read the DOM once, without retrying, before the assignments load
had settled; likely two suite runs overlapped. Fix 2 (docs/plans/step-2.md,
tests only): `openZone` now waits for `asg.state` to leave idle/loading
(tolerant, 15 s) plus a 100 ms paint tick, and every 5000 ms wait is 15000.
On `a49c072`, Rook ran the 93-check suite twice in sequence, then two copies
concurrently; all four exited 0 with ALL CHECKS PASSED. These are local mock
and loader checks, not a live SharePoint run.

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
