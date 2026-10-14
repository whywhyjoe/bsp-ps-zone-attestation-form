# Step 2 — Fix 2: make the zone checks wait for the load, not the clock

## Goal

Review 2 passed `0c88458` on code: Brume's run was 93/93 green. Rook's two
local runs of the same tree were not. One timed out at `tests/smoke.cjs:175`
and the other failed three zone checks. Two runs of one tree that disagree
point at a flaky suite, not at the fix. This step makes the suite settle on
the form's real load state before it asserts anything, so a slow or loaded
machine gets the same verdict as a fast one. It also clears the state-file
nit.

Diagnosis, from reading the code (not yet proven by a run):

- `openZone` (`tests/smoke.cjs:63-86`) navigates, then sleeps a fixed
  `waitForTimeout(1200)`. It never waits for the assignments load to finish.
- The three checks that failed read the DOM straight away with
  `isVisible()` / `count()`, which return at once and don't retry:
  `:321` (one row already submitted), `:325` (everything submitted) and
  `:485` (earlier-responses read cut off). Each of them depends on
  `loadAssignments` (`src/ps-zone-attestation.js:2077-2134`) having moved
  `asg.state` out of `'idle'`/`'loading'`. Under CPU load (for example two
  suite runs at once, which is likely what happened around 18:17), 1200 ms
  isn't always enough.
- The `:175` timeout is the same story: a fixed 5000 ms budget for the done
  screen after Confirm.

## Inputs

- `tests/smoke.cjs`: `openZone` at :63-86. There are 13 `timeout: 5000` waits
  (an earlier draft said 17; Pika's grep and a recount both give 13).
- Engine load states: `asg.state` is one of `idle | loading | ready | error |
  empty | done` (`src/ps-zone-attestation.js:2031`, set at :2079 and
  :2121-2130). The Alpine root is the element with `data-psz-uid`
  (`:1792`). Its data is `Alpine.$data(el)`.
- Rook's failure notes are in `state/2026-10-14-standalone-split.md`.
- Brume's Review 2 nit: the state file still called the 93-check run pending.
  Rook's `d8e4c9e` has already dropped that word, but it added a line saying
  the suite is "not green" and "needs triage before Review 2 or sign-off".
  That line has to be rewritten once this step lands.

## Expected artifact

One commit that touches only these two files:

1. **`tests/smoke.cjs`**
   - **A. Settle wait in `openZone`.** Keep the existing
     `waitForTimeout(1200)` as a floor, so callers that don't load
     assignments keep their current timing. Then add a tolerant wait:
     ```js
     await page.waitForFunction(() => {
       var el = document.querySelector('[data-psz-uid]');
       var d = el && window.Alpine && window.Alpine.$data(el);
       return !d || !d.asg || (d.asg.state !== 'idle' && d.asg.state !== 'loading');
     }, null, { timeout: 15000 }).catch(() => {});
     ```
     The wait is tolerant (`.catch`) on purpose. Config-error and doctor
     cases never reach a settled `asg`, and the checks that follow still
     assert, so a page that never settles still fails loudly. Add a
     one-line comment that says so, in the file's comment style.
   - **B. Wait for the post-load render.** After the settle, add
     `await page.waitForTimeout(100)` inside `openZone` so Alpine's next tick
     paints the rows and done screens before `isVisible()` runs. Don't touch
     the three failing checks themselves. The fix belongs in `openZone`, so
     every caller gets it.
   - **C. Widen the fixed budgets.** Change every `timeout: 5000` in the file
     to `timeout: 15000`. This only adds headroom: a passing wait returns as
     soon as its selector appears, so green runs don't get slower.
   - No new checks, so the suite stays at 93. If you add a check anyway,
     update the counts quoted in `README.md:36` and `tests/README.md:31`.
2. **`state/2026-10-14-standalone-split.md`**
   - Replace Rook's "not green / needs triage" paragraph with the outcome:
     the cause (fixed sleep plus non-retrying reads under load), the fix (A–C)
     and the runs from the acceptance tests with their results. Keep the
     "State:" header line true.

Nothing under `src/` changes, so there's no `VERSION` or `?v=` bump. Don't
touch anything in `dev/live/`.

## Acceptance tests

1. `git diff --stat HEAD~1` lists only `tests/smoke.cjs` and the state file.
2. `node tests/smoke.cjs http://127.0.0.1:8646/dev/index.html` reports
   93/93 passing **twice in a row**.
3. **Load run:** start two copies of the suite at the same time against the
   same server. Both report 93/93. This is the situation Rook hit, and it's
   the real proof.
4. `grep -c "timeout: 5000" tests/smoke.cjs` returns 0.
5. Breakage proof (in memory, no repo edit): temporarily change the predicate
   in A to `return false`. The suite should still finish, only about 15 s
   slower per `openZone`, and still be green. That shows the `.catch` is
   tolerant and that nothing depends on the wait succeeding by accident.
   Optional if time is short; say whether it was done.

If the builder can't run Playwright, ask Joe with `run:` lines for tests 2
and 3. Rook and Brume have both run the suite and can do it too.

## Stop rule

- If a **single, isolated** run (nothing else running) still fails any of
  `:321`, `:325`, `:485` or `:175` after A–C, **stop**. That's a real
  behaviour difference, not timing. Hand back the failing output and the
  `asg.state` value at the moment of failure (log it with a
  `page.evaluate`). Don't widen the timeouts further.
- Stop after the one commit plus the state-file update. Don't refactor other
  `waitForTimeout` sleeps.

## Out of scope

- `docs/copy.md`, and moving copy out of the engine and config (Rook's
  question). That's a separate piece of work, not part of this review cycle.
- Any engine, CSS, config or vendored-file change.
- `LOG.md`. Rook writes the single entry once Brume signs off.
- Replacing every `waitForTimeout` sleep in the suite with event waits. That's
  worth doing someday, but not here.

## Open questions

- Is the vendored Alpine exposing `window.Alpine`? It normally does. If it
  doesn't, fall back to `el._x_dataStack && el._x_dataStack[0]` in the
  predicate and note that in the commit message.
- If acceptance test 3 still flakes with two parallel runs but single runs are
  clean, report it rather than chasing it. Joe can decide whether "green
  under double load" is a bar he wants.
