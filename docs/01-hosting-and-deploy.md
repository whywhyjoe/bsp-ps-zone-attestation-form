# Hosting, boot and deploy

## Where it lives

One folder in the portal's `Code` library:

```
/sites/FCUPortal/Code/ps-zone-attestation/     ← the contents of src/, as is
├─ ps-zone-attestation.js · .css · .json
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

Done by hand on the prod machine: `git pull`, then copy files into the `Code`
library (browser upload or the OneDrive-synced folder). Nothing outside
`src/` is ever deployed.

### First install

1. **Lists and permissions** on `/teams/FCUWebDatastores`: see
   `02-sharepoint-data.md`. Fill `CurrentZone` for each assignment.
2. **Config:** in `src/ps-zone-attestation.json` set `form.vars.jobAidUrl`
   once the job aid exists (the card stays hidden while it's empty). It can
   also be set later in the deployed copy.
3. **Upload** the contents of `src/` to `Code/ps-zone-attestation/`, keeping
   `design/` and `lib/` as subfolders (11 files in all).
4. **Page** on `/sites/FCUPortal`: add a Modern Script Editor web part and
   paste `webpart/ps-zone-attestation.webpart.html` with `TENANT` replaced,
   keeping `data-validate` on the div for now. Publish.
5. **Check** (this is the verification step, and the deploy isn't done
   without it):
   1. Load the page. The *Form configuration check* table above the form
      shows every row **OK**: Responses columns, `target.set`, row columns,
      and the Assignments (source) columns. A **Problem** row names the
      column to fix.
   2. In devtools → Network, every form request goes to
      `…/Code/ps-zone-attestation/…`. Nothing goes to `Code/bsp-design`,
      `Code/lib` or `Code/bsp-forms`. Console: no `[PS Zone Form]` errors.
   3. Remove `data-validate`, republish.
   4. As an ordinary attester with assignment rows: submit. One Responses
      item per area, with `ZoneSelection`, `PreviousZone`, `ZoneChanged`,
      `Attestation = Confirmed` and the time. Reload → "already submitted".
   5. `?lang=fr` on the page URL → French. (Real language detection is still
      an intl.js placeholder.)

### Updating the engine or CSS

1. Keep copies of the deployed `ps-zone-attestation.js` and `.css`.
2. Upload the new pair over them.
3. Bump `?v=` in the page's web part to the new `VERSION`.
4. Load the page: renders, no console errors, one test submit if the change
   touched saving.

**Rollback:** restore the saved pair and the old `?v=`.

### Changing wording, zones or the job aid

Edit the **deployed** JSON (and commit the same edit here). It's live on
refresh. Keep each zone's `value` in English. A new attestation round means
clearing or archiving the Responses list: an area with a response from that
user counts as done.

## Dev tenant

`dev/live/` mirrors this on the dev tenant (needs the `sp-env` skill; never
run on prod): `live-zone-lists.js` creates the twin lists on the tenant
root site, `live-zone-perms.js` copies the permission setup,
`live-deploy.ps1 -Ver <n>` uploads `src/` to `<code root>/ps-zone-attestation/`
and builds `SitePages/ps-zone-attestation-test.aspx`, and `live-zone.js
[--as <profile>]` submits EN and FR and reads the items back. Because the
folder is the form's own, nothing else on dev needs backing up around a run.
