# bsp-ps-zone-attestation-form — overview

## What this is

The **Physical Security Work Zone Confirmation** for the FCU Portal (called
the "Zones Attestation" until 1.3.0; the repo, file and list names keep that
word). Each employee sees the areas assigned to them (from the list
`PS_Zone-Attestation-Assignments`), confirms each area's current zone or
changes it, and submits; submitting is the confirmation (there's no checkbox
since 1.3.0). The form saves one item per area to
`PS_Zone-Attestation-Responses`, with the zone, the previous zone, whether it
changed, who answered and when. It runs in English and French. An area
already answered drops out. When every area is done, the form says the
confirmation is already submitted. Info bars say changes will be reviewed
(again at the bottom once a zone is changed) and whom to contact.

Beside the form, in the page's narrow right column, a **resources panel**
(engine 1.1.0) lists the job aid and other guides, some information text and
a contact. It's a second web part mounted by the same engine
(`data-psz-resources`), from its own config
(`ps-zone-attestation.resources.json`), and it switches language with the
form.

On a page of its own, the **employee access list** (engine 1.3.0,
`data-psz-access`, `ps-zone-attestation.access.json`) shows each of the
user's areas with the employees who have access to it, from
`PS_Zone-Attestation-Access`. The form links to it in a new tab; its *Back*
closes that tab. For information only.

It began as one config (`forms/ps-zone-attestation.json`) of the shared BSP
Forms engine in `bsp-sp-parts`. It was split out on 2026-10-14 because it's
critical: a change to the shared engine, design system or libraries made for
some other form must not be able to break it.

## The non-negotiables

- **Self-contained folder.** Every runtime file sits in `src/` and deploys as
  one folder. The engine finds `design/` and `lib/` beside itself
  (`engineBase + 'design/'`, `engineBase + 'lib/'`), derived from its own
  `<script src>`. If anything points back at the shared `Code/` folders, the
  split is undone without anyone noticing. The suite checks that form asset
  requests stay inside `src/`; SharePoint REST calls and the local harness
  are separate requests.
- **Renamed identity.** The shared engine is still deployed on the portal and
  may share a page with this one. Both used `window.BSPForms` with an
  "already loaded" guard, mounted every `[data-bsp-form]`, and styled
  `.bspf-*`. Whichever loaded first would have run both forms. This fork uses
  `PSZoneForm`, `data-psz-form`, `PSZ_FORM_SETTINGS` and `.psz-*`.
- **Frozen fork, not a tracking copy.** Upstream fixes are not pulled in
  automatically. When one matters, port it deliberately: rename its
  identifiers, run the suite and log it.
- **Values English, labels translated.** See CLAUDE.md, hard rule 5.

## How the pieces fit

```
page web part:  <div data-psz-form data-config=".../ps-zone-attestation.json">
                <script src=".../ps-zone-attestation.js?v=1.3.0">
                        │
ps-zone-attestation.js ─┼─ injects design/colors_and_type.css, design/components.css,
                        │  ps-zone-attestation.css (?v=) and the design/ sprite
                        ├─ loads lib/pnp2.bundle.js (define.amd hidden), lib/alpine.js,
                        │  lib/intl.js (bilingual config)
                        ├─ fetches the config (no-cache), localize() → normalizeConfig()
                        ├─ resolves the page web + current user over REST
                        ├─ reads the user's Assignments rows and earlier Responses keys
                        └─ renders cards → validates → confirm dialog → one addItem per row

second web part: <div data-psz-resources data-config=".../ps-zone-attestation.resources.json">
                 (same script; it runs once and mounts both)
                        └─ fetches its config, localize() → normalizeResources() → static
                           markup (no Alpine, no lists); re-rendered on a language switch

access list page: <div data-psz-access data-config=".../ps-zone-attestation.access.json">
                  (same script, its own page)
                        └─ fetches its config, normalizeAccess() → the user's Assignments
                           rows → their Access rows (adapter.getAccess) → <details> panels
                           (no Alpine); re-rendered on a language switch
```

The engine is the whole BSP Forms engine: it still supports field types and
features the zone form doesn't use (attachments, people pickers, business
time, afterSubmit…). They're inert here. Trimming them was deferred
(`STATE.md`). The zone-relevant config keys are in `03-config.md`.

**Page globals.** Alpine, `window.pnp`, `window.intl` and the icon sprite
are page-wide. The engine reuses one that's already on the page instead of
loading a second copy, because two Alpines on one page break each other.
So on a page shared with other parts, the form could run on *their*
versions. Two engines that both start loading Alpine at the same moment can
also inject it twice.

**Page-wide CSS.** The design-system stylesheets are page-wide too, and they
are the one thing the rename can't separate. This form and every other BSP
part use the same design-system classes and tokens (`.field`, `.btn`,
`--color-…`). If the page also loads the shared `Code/bsp-design` CSS, both
copies apply, and whichever loads later wins wherever the two versions
differ. A newer shared design system can restyle this form's controls, and
this form's copy can restyle theirs. The two form layers are scoped to their
own prefixes, `.psz-*` in `ps-zone-attestation.css` and `.bspf-*` in
`bsp-forms.css`, with one exception: both carry the same global
`[x-cloak] { display: none !important; }` (Alpine's pre-boot hide, kept out of
inline styles for CSP). The declarations are identical, so either copy
gives the same result, but don't change it in one layer only. The suite
proves the real BSP Forms engine and layer, loaded before or after this
one, leave every computed style in the zone form unchanged.

Both points are why **the form gets its own page**, with no other
custom-script parts on it. That's a deployment rule, not something the code
can enforce.

## Decisions

### Vendored fork in its own repo — 2026-10-14

Chosen: a full copy of BSP Forms 0.5.1 plus every file it loads, renamed,
in one folder. **Rejected:** a byte-identical copy (it collides with the
shared engine on the same page), and a trimmed rewrite of the engine (too
much regression risk for no runtime gain). **Costs:** upstream fixes must
be ported by hand, and the engine carries code the form never runs.

### Leave bsp-forms' copy of the config in place — 2026-10-14

`bsp-sp-parts/bsp-forms` keeps `forms/ps-zone-attestation.json` because
its smoke suite uses it as the reference config for `assignments`. Its
PROD-DEPLOY and README point here as the deploy source.

## Paid-for gotchas

Inherited from BSP Forms (each was found the hard way there; identifiers
renamed). Plus one of this repo's own, last.

- **The edit-mode placeholder depends on `.is-suspended` staying ON** for a
  deferred mount; `applyEditState` must never touch deferred mounts'
  classes. Removing it blanks the web part in edit mode.
- **Init failures are retryable.** A failed mount clears `__pszInit`; error
  cards carry `data-psz-fatal`; `PSZoneForm.retry(mount)` from devtools.
- **The pnp bundle loads with `define.amd` hidden.** Modern pages run an AMD
  loader; a late UMD bundle otherwise registers anonymously and `window.pnp`
  never appears. Restore on success and failure.
- **No `_spPageContextInfo` on modern pages.** `resolvePageWeb()` probes
  `<path>/_api/web` upward and fetches the current user. Every adapter call
  goes through `whenCtx()`.
- **Never let pnp guess the item type on `items.add`.** pnp v2 caches
  `ListItemEntityTypeFullName` in localStorage for 5 days keyed by the
  list's relative URL, so same-titled lists on two webs collide. `addItem`
  passes the type it read from the target list (`listEntityType`).
- **`pnp.sp.setup` is global**; the adapter re-asserts `baseUrl` first.
- **Layout is keyed to the form's width** (`@container psz`), not the
  viewport. A web part can sit in a narrow column on a wide screen.
- **Author prose goes through `prose()`**, never raw `innerHTML`; only
  `[text](url)` with a safe target becomes a link. Links pass `safeHref`.
- **Bilingual = `localize()` before `normalizeConfig`.** A language switch
  re-normalizes and re-renders, carrying state through `snapshotState`; it
  waits while a submit is busy. The form root carries `lang-keep`, or
  intl.js would hide it and disable its inputs mid-switch.
- **Assignment rows stack**: an open menu's row needs `is-open` (z-index).
- **`row.value` is always the row's answer.** Confirm copies `row.current`
  into it; Change and Keep clear it; `row.mode` only picks the control. No
  separate "confirmed" flag. A `current` that isn't a choice value is dropped.
- **`row.saved` is the per-row "never twice" guard**, and any failed save
  sets `store.rowsUncertain` so the next submit runs `reconcileRows()`
  (`getRowKeysFor`, unquoted number keys, chunks of 20) first. An add can
  land while its reply is lost. Don't skip it.
- **Rows are saved from `store.snap`**, taken when the confirmed submit
  starts. The disabled fieldset only keeps the UI honest (`input.disabled`
  stays false under it; test with `:disabled`).
- **Reads that can be cut off say so** (`{ …, more }`): a warning, never a
  silently short list, never a false "already submitted".
- **Escape means opposite things**: in `submitConfirm` it's Go back.
- **Errors clear live** (`reval()`), or the Submit button jumps mid-click.
- **No `<button>` inside the combo control** (a `div[role=combobox]`).
- **Assignments filter ≠ security.** It's a browser-side `$filter`. Privacy
  comes from list permissions (`02-sharepoint-data.md`).
- **Paths come from the engine's own `<script src>`** (this repo). A page-
  relative path breaks under SharePoint's routing, so the web part snippet
  uses the full tenant URL for the script and a server-relative one for the
  config.
