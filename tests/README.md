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
| `node tests/smoke.cjs` | full | ~2.5 min | 178 | Edit-mode placeholder; the whole confirmation lifecycle on the mock (load, filter, confirm/change/keep, validation and focus, confirm dialog, per-row payload, partial-save and lost-reply retries, already-answered rows, cut-off reads, EN/FR, frozen answers mid-save and the **saving overlay** (scrim, spinner, focus, leave-page guard), hostile text, config errors); **error reporting** (an error-log item per failed load / save / start-up with its diagnostics, one per kind, the mailto link with subject and body, never beside a validation message, French, a failing report that breaks nothing, nothing when unconfigured); the **standalone** guarantees: no request leaves `src/` beyond the harness page and its mock, the vendored files all load, every sprite reference resolves, the `.psz` layer applies, config asset paths resolve inside `design/`, the real (non-mock) loader fetches pnp from `lib/`, and **the real BSP Forms 0.5.1 engine** on the same page, loaded before or after this one, mounts only its own form and leaves the zone form's computed styles unchanged; and the **resources panel** (`dev/page.html`): both groups render beside the form, placeholders unlinked, real and space-containing URLs linked in a new tab, `javascript:` never linked, the contact card, EN/FR switching with the form, the edit-mode placeholder, and a broken panel config failing alone while the form still loads; the **form's notices** (1.3.0: no checkbox, the review and access-list bars on top, the "you changed" bar only while a row is changed, the contact bar, `Attestation = Confirmed` still saved, every new-tab link carrying `data-interception="off"`, the access list opening in a new tab whose Back closes it); and the **access list** (`dev/access.html`): the user's areas only, sorted and expanded, employees by name in two columns (one when narrow) with mailto links, area matching blind to case but not outer spaces (as SharePoint's `eq`), "no employees", expand / collapse all and keyboard toggling, Back following the link in a tab with history or one another page opened (only the form's `pszFrom=form` tab closes), area names that are `Object.prototype` keys, EN/FR keeping collapsed panels, a failed read (Try again, email link, an `access` error-log item), nothing assigned, a cut-off read (also when the rows that arrived had no usable area), hostile text, edit mode, a broken config. |

`tests/fixtures/bsp-forms-0.5.1/` holds that engine (`bsp-forms.js`,
`bsp-forms.css`, copied from bsp-sp-parts `fe5c040`). It's test-only and
never deployed. The coexistence checks point its design-system base at the
same vendored files, so they test the two engines and their layers. Two
*different* design-system versions on one page is a deployment rule
(`docs/00-overview.md`, *Page-wide CSS*), not something a test can settle.

The style comparison fingerprints **every** computed property (sorted, so
token load order can't matter) of every element in the zone mount, with
`::before`/`::after`, after finishing animations. It skips only the resolved
pixel offsets of absolute/fixed elements, which move when another form sits
above. It refuses to compare a form that didn't render (3 rows each side),
so two empty mounts can't match. The mount checks also require two distinct
namespaces (`PSZoneForm` isn't `BSPForms`).

The standalone checks were each shown to fail when the thing they guard
breaks (2026-10-14):
- a stray harness request under `dev/` failed both boundary checks;
- `../../bsp-design/…` as the illustration path failed the asset-path check
  (and the boundary checks);
- the old shared `BSPForms` global put back into the fixture engine failed
  both mount checks, and the style check with "form not rendered" rather
  than a vacuous match;
- `opacity: 0 !important` on `.psz-asg__row` in the fixture CSS failed both
  style checks, on exactly the three rows.

The 1.3.0 checks were shown to fail when what they guard breaks
(2026-10-15): `anyChanged` always false failed both "you changed" checks;
no `window.close()` failed the Back-closes-the-tab check; no back marker on
the intro link failed its check; one grid column failed the two-columns
check. Five failures, no others.

The 1.3.2 checks (Codex review, xo turn 3) failed with their fixes reverted
(2026-10-15), four failures and no others: a mock that trims area names
again; Back closing without the `pszFrom=form` marker; `{}` instead of a
null-prototype map; the empty screen without the cut-off warning. The mock
now matches area names as SharePoint's `eq` does (case-blind, spaces count);
`dev/live/live-zone.js` confirms that on the real list.

What the harness **can't** reproduce: SharePoint's in-place navigation,
which ignores `target="_blank"` on a same-tenant link unless it carries
`data-interception="off"`. The suite checks the attribute;
`dev/live/live-zone.js` checks the behaviour (the access list opens in a new
tab, Back closes it).

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
