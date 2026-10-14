# Hosting, boot and deploy

## Where it lives

One folder in the portal's `Code` library:

```
/sites/FCUPortal/Code/ps-zone-attestation/     ← the contents of src/, as is
├─ ps-zone-attestation.js · .css · .json · .resources.json
├─ design/  (colors_and_type.css, components.css, fluent-basic-icons.svg,
│            abacus-icons/light-bulb-48.svg, spot-illustrations/shield-checkmark-xs.svg)
└─ lib/     (alpine.js, pnp2.bundle.js, intl.js)
```

Any library or path works. The engine derives every path from its own
`<script src>`, so only the web part snippet needs to know the location.
`PSZ_FORM_SETTINGS` (set before the script) can override `designBase`,
`libBase`, `alpineUrl`, `pnpUrl`, `intlUrl` or `webUrl`, but a normal deploy
sets none of them. Overriding one back to a shared folder undoes the split.

The **page** should be the attestation's own: no other custom-script parts on
it. Alpine, `window.pnp`, `window.intl` and the icon sprite are page globals,
and the engine reuses any that's already there (`00-overview.md`, *Page
globals*). The SharePoint section layout (¾ form, ¼ resources) is the page's
own and isn't set by the engine.

## Boot

1. The script runs (idempotently: `PSZoneForm.__engineLoaded`), injects the
   tokens CSS, components CSS and its own layer (`?v=` from its own URL), and
   scans for `[data-psz-form]`.
2. **Edit mode:** an inert placeholder naming the config shows instead
   (`.is-suspended` stays on for the whole edit session). It mounts on
   return to view mode.
3. The config is fetched uncached, localized, normalized and validated. A bad
   config renders an error card (`data-psz-fatal`), never a half form.
4. pnp loads with `define.amd` hidden, then Alpine, then intl.js (bilingual
   config). The page web and current user resolve over REST when
   `_spPageContextInfo` is absent.
5. Rows load and the form renders. A failed init stays retryable
   (`PSZoneForm.retry(mount)`, or any re-scan).

## Caching

`?v=` on the script URL is the version stamp for the engine **and** its CSS.
Bump it on every engine or CSS deploy and keep it equal to `VERSION` in the
engine. The config never needs a bump. Vendored `design/` and `lib/` files
carry no stamp. When re-vendoring one, give the changed file a new name and
update its engine or config reference (`04-vendoring.md`). The script-library
URL settings can point to renamed files; the design CSS and sprite have no
per-file URL override.

## Deploy

The procedure (first install, updates, rollback, troubleshooting) is
[`05-deploy-steps.md`](05-deploy-steps.md). It's written for someone new to
the project, so keep it the only copy of the steps. It's done by hand on
the prod machine: `git pull`, then copy the contents of `src/` into the `Code`
library. Nothing outside `src/` is ever deployed.

Its verification step is what makes a deploy count as done. The
*Form configuration check* (`data-validate`) is all **OK**, no form asset
request leaves `Code/ps-zone-attestation/`, and a test submit saves one
Responses item per area.

## Dev tenant

`dev/live/` mirrors this on the dev tenant (needs the `sp-env` skill; never
run on prod): `live-zone-lists.js` creates the twin lists on the tenant
root site, `live-zone-perms.js` copies the permission setup,
`live-deploy.ps1 -Ver <n>` uploads `src/` to `<code root>/ps-zone-attestation/`
and builds `SitePages/ps-zone-attestation-test.aspx`, and `live-zone.js
[--as <profile>]` submits EN and FR and reads the items back. Because the
folder is the form's own, nothing else on dev needs backing up around a run.
