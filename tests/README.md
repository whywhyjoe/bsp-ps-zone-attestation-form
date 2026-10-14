# bsp-ps-zone-attestation-form — tests

Tiers and budgets per
[projects-standard `docs/03-test-policy.md`](https://github.com/whywhyjoe/projects-standard/blob/main/docs/03-test-policy.md).

**A check that does not need the DOM does not get a browser.** Today every
check here needs one: the engine is a single browser IIFE with no pure
module to import, so there's no fast tier yet (`STATE.md`, deferred).

## Setup

```bash
python -m http.server 8646        # terminal 1, from the repo root
```

Playwright isn't a dependency of this repo. The suite is CommonJS so that
`NODE_PATH` can point at any install of it, e.g.

```powershell
$env:NODE_PATH = 'C:/dev/repos/sp-traffic-analytics/node_modules'
node tests/smoke.cjs
```

`CHROMIUM=/path/to/chrome` pins the browser. A different harness URL can be
passed as the first argument.

## Suites

| Suite | Tier | Runtime | Checks | What it proves |
| --- | --- | --- | --- | --- |
| `node tests/smoke.cjs` | full | ~1.5 min | 90 | Edit-mode placeholder; the whole attestation lifecycle on the mock (load, filter, confirm/change/keep, validation and focus, confirm dialog, per-row payload, partial-save and lost-reply retries, already-answered rows, cut-off reads, EN/FR, frozen answers mid-save, hostile text, config errors); and the **standalone** guarantees: no request leaves `src/`, the vendored files all load, every sprite reference resolves, the `.psz` layer applies, pnp loads from `lib/`, and a shared BSP Forms engine already on the page can't take the form over. |

## Browser-suite rules

- Nav clicks are programmatic (`el.click()` in `evaluate`). Pointer clicks
  flake when a validation message shifts the layout mid-click.
- Inherited from BSP Forms, the suite still uses short fixed waits
  (`waitForTimeout`) between steps. New checks should wait on the real
  condition instead.

## Not tested here

Live tenant behaviour (real permissions, own-items read, cross-site writes,
a non-admin user) can only be verified in a tenant: `dev/live/`, and the
**Manual gates** in `../STATE.md`.
