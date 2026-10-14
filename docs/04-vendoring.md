# Vendored files — what, from where, and how to refresh

Everything in `src/design/` and `src/lib/` is a **byte copy** of a file from
another repo, taken on 2026-10-14. The engine and its CSS are a **renamed
fork**. The hashes below are SHA-256, first 16 hex characters. Re-check one
with:

```powershell
(Get-FileHash -Algorithm SHA256 src/lib/intl.js).Hash.Substring(0,16).ToLower()
```

## Byte copies

| File | Source | Version | SHA-256 (16) |
| --- | --- | --- | --- |
| `design/colors_and_type.css` | `bsp-design-system/colors_and_type.css` @ `8deb7293` | design system 1.1.0 | `8c761e16fcad9108` |
| `design/components.css` | `bsp-design-system/components.css` @ `8deb7293` | 1.1.0 | `65f0c8afd9ef9dca` |
| `design/fluent-basic-icons.svg` | `bsp-design-system/fluent-basic-icons.svg` @ `8deb7293` | 1.1.0 | `b5146ac961b2f591` |
| `design/abacus-icons/light-bulb-48.svg` | `bsp-design-system/abacus-icons/` @ `8deb7293` | 1.1.0 | `4efe8f799adb5546` |
| `design/spot-illustrations/shield-checkmark-xs.svg` | `bsp-design-system/spot-illustrations/` @ `8deb7293` | 1.1.0 | `c7f8bbc7f59c515a` |
| `lib/alpine.js` | `sp-dcspad/lib-mirror/alpine.js` (mirror of the portal's `Code/lib`) | Alpine 3.15.2 | `b530d5962571c13f` |
| `lib/pnp2.bundle.js` | `sp-dcspad/lib-mirror/pnp2.bundle.js` (mirror of the portal's `Code/lib`) | pnpjs v2 UMD bundle | `7662814018edb383` |
| `lib/intl.js` | `bsp-sp-parts/bilingual/intl.js` @ `fe5c040` | intl.js 1.1.4 | `b017782e7eb5401d` |

Only the design-system files this form actually uses were taken: the two
stylesheets the engine injects, the icon sprite it inlines, the job aid card
icon and the thank-you illustration the config names. `editorial.css`,
`styles.css`, `fluent-icon.js` and the rest of the icon and illustration
sets were left out.

## Forks (renamed, then owned here)

| File | Source | Changes |
| --- | --- | --- |
| `ps-zone-attestation.js` | `bsp-sp-parts/bsp-forms/bsp-forms.js` @ `fe5c040` (engine 0.5.1) | `BSPForms`→`PSZoneForm`, `BSP_FORMS_SETTINGS`→`PSZ_FORM_SETTINGS`, `data-bsp-form`→`data-psz-form`, `bspf`→`psz` everywhere (classes, data attributes, container name, init flags), `[BSP Forms]`→`[PS Zone Form]` in logs, brand words in two user-facing strings per language; default `designBase`/`libBase` moved from `../bsp-design/` and `../lib/` to `design/` and `lib/` beside the engine; its CSS file name; `VERSION` 1.0.0. |
| `ps-zone-attestation.css` | `bsp-forms/bsp-forms.css` @ `fe5c040` | `bspf`→`psz`, `data-bsp-form`→`data-psz-form`, header. |
| `ps-zone-attestation.json` | `bsp-forms/forms/ps-zone-attestation.json` @ `fe5c040` | none (byte copy at the split). |
| `dev/mock-sp.js` | `bsp-forms/dev/mock-sp.js` | renamed globals (`PSZ_MOCK_*`), trimmed to the zone form's lists. |
| `tests/smoke.cjs` | `bsp-forms/dev/smoke.spec.js` (zone section + edit mode) | renamed selectors; plus the *standalone* checks. |
| `dev/live/*.js` | `bsp-forms/dev/live/live-zone*.js` | renamed selectors, new page name. `live-deploy.ps1` replaces `live-setup.ps1` + `live-page.ps1`. |

## Refreshing a byte copy

Only when there's a reason (a bug fix this form needs, a security fix in a
library). Never as routine catch-up: an unchanged copy is the point.

1. Copy the new file over the old one, byte for byte (no reformatting).
2. Update its row: source commit, version, hash.
3. Run `node tests/smoke.cjs`. For a design-system change, also look at the
   harness in both languages, because a CSS change can pass every check and
   still look wrong.
4. **Cache:** the vendored files have no `?v=`. Deploy a changed one under a
   new name (e.g. `components.1-2-0.css`) and point the engine at it, or the
   browser may keep the old copy. Log it.

## Porting an upstream engine fix

The fork doesn't track BSP Forms. If a fix there matters here:

1. Read the upstream diff and apply the same change by hand, renaming
   `bspf`→`psz` and `BSPForms`→`PSZoneForm` as you go.
2. Bump `VERSION` and the web part's `?v=` together.
3. Add the upstream commit to this page's fork table and to `LOG.md`.
4. Run the suite. If the fix came with a regression test upstream, port that
   too.
