# Step 1 — Fix 1: close review 1's two should-fixes

Source: Brume's review 1 (fail 7/10 on `3074f0e`, re-confirmed on `cf2a7c0`).
The caching-doc nit is already fixed in `cf2a7c0` (Rook). Two should-fixes
remain; both are accepted, none rejected.

## Goal

1. The smoke suite proves the **real (non-mock) pnp loader** fetches
   `lib/pnp2.bundle.js` from inside `src/`, and would fail if the engine's
   pnp URL ever pointed outside it.
2. `dev/live/live-deploy.ps1` checks **every input it can check before it
   mutates anything** on the tenant: config validation before any upload,
   template-marker check before the old page is recycled.

## Inputs

- `tests/smoke.cjs:561-569` — `testStandalone`. Line 567 injects the pnp
  bundle with `page.addScriptTag`, which bypasses the engine; in mock mode
  `whenPnp()` returns early (`src/ps-zone-attestation.js:517`), so the
  engine never requests pnp and the "inside src/" check (line 540) never
  sees a pnp request.
- Engine facts the new check relies on (read, don't change):
  - `pnpUrl = settings.pnpUrl || libBase + 'pnp2.bundle.js'` (`:80`), with
    `libBase` derived from the engine's own `<script src>` (`:62-78`).
  - `loadScript` tags the injected script `data-psz-script="pnp"` (`:509`).
  - Non-mock `init` calls `adapter.ready()` in the background (`:2051`), and
    `resolvePageWeb` probes `<path>/_api/web` upward from the page
    (`:569-583`), i.e. `/dev/_api/web` then `/_api/web` on the harness origin.
- `dev/index.html:43-47` — the harness sets
  `PSZ_FORM_SETTINGS = { mockSp: window.PSZ_MOCK_SP }`, so mock mode is off
  if `mock-sp.js` doesn't define `PSZ_MOCK_SP`.
- `dev/live/live-deploy.ps1` (whole file, 65 lines). Mutations, in order:
  `Add-PnPFile` loop (`:22-25`), config upload (`:38`), `Remove-PnPFile
  -Recycle` (`:53`), `Copy-PnPFile` (`:56`), `Set-PnPListItem` (`:60`),
  `Set-PnPPage -Publish` (`:61`). Checks that currently come too late:
  config `throw`s (`:31`, `:33`) and template marker (`:59`).
- Counts of checks quoted in docs: `README.md:36`, `tests/README.md:31`
  (both say 90). `LOG.md` and `STATE.md` are not touched in this step (see
  Out of scope).

## Expected artifact

One commit (or two, one per item) on `crew/zone-split-review` containing:

### A. `tests/smoke.cjs` — new non-mock loader check in `testStandalone`

Add a new block after the existing standalone context closes (after line
570) and before the "shared BSP Forms engine" block. Shape:

1. New context + page. Record every request URL (same pattern as `:526-527`)
   and page errors.
2. `page.route('**/dev/mock-sp.js', r => r.fulfill({ contentType:
   'application/javascript', body: '/* mock off: real adapter */' }))` so
   `PSZ_MOCK_SP` is undefined and the engine runs its real adapter.
3. `page.route('**/_api/**', r => r.fulfill({ status: 404, body: '' }))` so
   the page-web probe (and anything after it) gets a fast, local 404. Nothing
   leaves the machine; no network.
4. `goto(BASE)`, then wait for the engine's own tag:
   `page.waitForSelector('script[data-psz-script="pnp"]', { state:
   'attached', timeout: 8000 })`, then
   `page.waitForFunction(() => !!(window.pnp && window.pnp.sp))`.
5. Checks (new, ~3):
   - `real loader requests pnp from src/lib/` — the `data-psz-script="pnp"`
     tag's `src` (resolved, `?query` stripped) equals `SRC +
     'lib/pnp2.bundle.js'`, **and** that URL appears in the recorded
     requests.
   - `real loader: window.pnp.sp is defined` — from the engine's load, not
     `addScriptTag`.
   - `real loader: no asset request leaves src/` — same filter as `:539`,
     except same-origin URLs whose path contains `/_api/` are excluded (those
     are SharePoint REST calls the route answered with 404, not asset loads).
     Name the exclusion in a one-line comment.
   Do **not** assert zero page errors here: the real adapter will fail to
   find a web and may surface that; that's expected without SharePoint.
6. Close the context.

Keep line 567-568 as is (it proves the vendored bundle itself is valid) but
optionally retitle it to `lib/pnp2.bundle.js is a working pnp bundle
(direct load)` so it stops sounding like a loader check.

**Prove the check can fail** (do once locally, don't commit). Temporarily
change the engine's default at `:80` to `'/nowhere/pnp2.bundle.js'`, run the
suite, and confirm the new checks fail. Then revert. (You can't do this
through settings, because the harness overwrites `PSZ_FORM_SETTINGS`.) Quote
the failing output lines in the hand-back. Because the engine edit is
reverted, the committed engine is unchanged, so `VERSION` and `?v=` are **not**
bumped.

### B. `dev/live/live-deploy.ps1` — preflight before mutation

Reorder into three phases, with a comment line heading each:

1. **Preflight (read-only).** After `Connect-SpEnvDev` and the path
   variables:
   - Read and transform the config (current `:29-34`), keeping both `throw`s
     exactly as worded. Write the temp file (`:35-37`) here too; it's local.
   - Build `$old` / `$new` (current `:46-49`; move `function J` up with
     them).
   - Read the template's canvas **without copying it**:
     `$tpl = Get-PnPFile -Url "$pagesRel/_app-template.aspx" -AsListItem
     -Connection $conn` and `throw` with the existing message if
     `-not ([string]$tpl['CanvasContent1']).Contains($old)`.
2. **Upload.** The `Add-PnPFile` loop and the config upload (`:21-25`,
   `:38-39`) unchanged.
3. **Page.** Recycle, copy, rewrite, publish, verify (`:51-64`). Keep the
   post-copy `Contains($old)` check at `:59` as a second guard (the copy is
   what gets edited), but it is no longer the first.

No behaviour change otherwise: same parameters, same messages, same target
paths. Update the header comment (`:3-4`) with one line: "Checks the config
and the template before uploading or recycling anything."

### C. Doc counts

Update the check count in `README.md:36` and `tests/README.md:31` to the
suite's new total (whatever the run prints). Don't touch `LOG.md`.

### D. Thread state

Per CLAUDE.md, update `state/2026-10-14-standalone-split.md` "What was done"
with one or two sentences on Fix 1 (new count; deploy preflight), and commit
it with the work.

## Acceptance tests

1. `node tests/smoke.cjs http://127.0.0.1:8646/dev/index.html` (server on
   repo root, `NODE_PATH=C:/dev/repos/sp-traffic-analytics/node_modules`)
   prints `ALL CHECKS PASSED`, with the total = 90 + the number of checks
   added.
2. The temporary-breakage run from A fails on the new loader check(s), and
   the hand-back quotes those failure lines. Engine back to byte-identical
   afterwards: `git diff --stat src/` is empty.
3. `live-deploy.ps1` parses (does **not** run):
   `pwsh -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('dev/live/live-deploy.ps1',[ref]$null,[ref]$e); $e.Count"`
   prints `0`. If the builder may not run it, ask Joe with a `run:` line.
4. By reading `live-deploy.ps1`: no `Add-PnPFile`, `Remove-PnPFile`,
   `Copy-PnPFile`, `Set-PnPListItem` or `Set-PnPPage` line appears above the
   config `throw`s or the template `Contains($old)` throw. (Reviewer checks
   by line number.)
5. `git diff --stat` touches only: `tests/smoke.cjs`,
   `dev/live/live-deploy.ps1`, `README.md`, `tests/README.md`,
   `state/2026-10-14-standalone-split.md`. Nothing under `src/`.

## Stop rule

Stop and hand back to the reviewer (Review 2) when acceptance 1-5 hold.
Stop early and ask the planner (me) if:
- the non-mock run can't reach `window.pnp.sp` within the timeout (e.g. the
  real adapter path throws before `whenPnp`), rather than reshaping the
  engine to make it work;
- making the test pass seems to need any change under `src/`;
- the `_api` exclusion turns out to need more than the one path pattern.

## Out of scope

- Any edit to `src/` (engine, CSS, config, `design/`, `lib/`). No `VERSION`
  / `?v=` bump.
- **Running anything in `dev/live/`** or touching any tenant. B is a static
  edit, verified by parse + reading.
- Other `dev/live/` scripts (`live-zone*.js`) — not in review 1's findings.
- `LOG.md` (one entry at the very end of the exercise) and `STATE.md`
  (rewritten at the end, if at all).
- A `-WhatIf`/dry-run mode for the deploy script. Nice, not asked.

## Open questions

- None blocking. If Brume wants the non-mock check to also assert the
  *config* and *design* loads in non-mock mode, that's a one-line addition
  to the same filter; say so in Review 2 and it goes into Fix 2.
