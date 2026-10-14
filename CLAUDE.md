# bsp-ps-zone-attestation-form

The Physical Security Zones Attestation form for the FCU Portal, as a
standalone, self-contained SharePoint part: one deployable folder (`src/`)
holding a renamed fork of the BSP Forms engine, the form config, and every
design-system file and library it loads.

A buildless SharePoint app. `docs/` is how it works and why (start at
`docs/README.md`); `STATE.md` is where things stand.

## Work in progress — read before anything else

`state/` holds one dated file per live thread of work. The procedure is the
**`project-state` skill** — read it at the start of any session in this repo. It
is not `xo-handoff` and `.xo-handoffs/`; don't cross-file them.

- **Read every file in `state/` before the first edit**, then ask: pick a thread
  up, or work on something else? Ask even if the user opened with a request.
- **Any session that changed anything updates its thread's file before
  reporting completion**, and commits it with the work.
- **Check `git log -3 -- state/` and re-read the file before editing it.** More
  than one session may be in this repo; a file that contradicts the user in chat
  is stale.
- **A finished thread's file is deleted** once what outlives it has been promoted.

## Hard rules

1. **Standalone means standalone.** At runtime the form loads only files from
   its own deployed folder (`src/` → `Code/ps-zone-attestation/`). Never point
   it back at the shared `Code/bsp-design/`, `Code/lib/` or `Code/bsp-forms/`,
   and never add a dependency on another repo. `tests/smoke.cjs` fails if a
   request leaves `src/`.
2. **Nothing shared by name with BSP Forms.** Globals, attributes, classes and
   settings are `PSZoneForm`, `PSZ_FORM_SETTINGS`, `data-psz-*` and `.psz-*`.
   A `bspf`/`BSPForms`/`data-bsp-form` identifier reappearing (a pasted
   upstream patch, say) would let the shared engine grab or skip this form.
3. **Buildless, CDN-free, self-hosted.** What's in `src/` is what runs: classic
   scripts, no modules, no bundler, no CDN. ES5-style source (`var`,
   `function`) is the settled house idiom. Match it.
4. **Vendored files are copied, never edited.** `src/design/` and `src/lib/`
   are byte copies with recorded hashes (`docs/04-vendoring.md`). Change them
   only by re-vendoring from the source and updating that table. Style fixes
   go in `ps-zone-attestation.css`, scoped to `.psz`, built from tokens. Never
   redefine `:root`, never restyle base BSP classes.
5. **Zone values are data, labels are display.** Saved values stay English
   (`Public`, `Public Plus`, `Standards`, `Secure Restricted`,
   `High Security`) in every language, and `CurrentZone` must hold exactly
   those. Translate `label`s only.
6. **Every SharePoint read/write stays in `makeAdapter`**, with the mock twin
   `dev/mock-sp.js` keeping the same method names. Mock mode is opt-in
   (`PSZ_FORM_SETTINGS.mockSp`), never a fallback.
7. **Bump `?v=` and `VERSION` together** on every engine or CSS change. The
   config is fetched uncached and needs no bump.

## Layout

| Path | What it is |
| --- | --- |
| `src/ps-zone-attestation.js` | The engine, a renamed fork of BSP Forms 0.5.1. Banner-commented sections: settings → assets → adapter → config → rules → markup → Alpine instance → doctor → boot. |
| `src/ps-zone-attestation.css` | The `.psz-*` layer (cards, combo, dialog, done screen, doctor). |
| `src/ps-zone-attestation.json` | The form. Hand-formatted: `dev/live/live-deploy.ps1` swaps exact lines, so never re-serialize it. |
| `src/design/` | Vendored BSP subset: tokens, components, sprite, one icon, one illustration. |
| `src/lib/` | Vendored Alpine 3.15.2, pnpjs v2 bundle, intl.js 1.1.4. |
| `webpart/` | The snippet pasted into the page's Modern Script Editor web part. |
| `dev/index.html` + `mock-sp.js` | Harness: the real `src/` folder, SharePoint mocked. |
| `dev/live/` | Dev-tenant live test (needs the `sp-env` skill). Never run on prod. |
| `tests/smoke.cjs` | Playwright regression suite. See `tests/README.md`. |
| `tests/fixtures/bsp-forms-0.5.1/` | The real shared BSP Forms engine + CSS, for the coexistence checks only. Never deployed, never edited. |
| `docs/` | Durable reference. Start at `docs/README.md`. |

## Where things go

- **Generated documents** — reviews, analyses, plans — go in `.scratch/`
  (gitignored) and are **never committed**. They reach `docs/` only by
  explicit promotion, rewritten, with an index row.
- **What's left to do** goes in `STATE.md`, rewritten, never appended; a thread
  of work in progress gets its own file in `state/`.
- **What shipped** goes in `LOG.md`, appended, never rewritten.
- **No `.md` at the repo root** beyond README, CLAUDE, STATE and LOG.

## Tests

```
python -m http.server 8646        # from the repo root, once
node tests/smoke.cjs              # full suite, ~1.5 min, needs playwright
```

Playwright isn't installed here. Point `NODE_PATH` at any `node_modules`
that has it (`tests/README.md`). All checks must pass before a push. Live
tenant behaviour (permissions, cross-site writes) is a manual gate in
`STATE.md`, run with `dev/live/`.

---

Scaffolded from [projects-standard](https://github.com/whywhyjoe/projects-standard)
0.3.1, profile `sp-app`. This file wins over the shared method for
this repo.
