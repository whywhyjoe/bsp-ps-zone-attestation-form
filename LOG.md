# LOG — bsp-ps-zone-attestation-form

**Append-only.** One entry per ship or merge — not per session. Current state
is in `STATE.md`.

Newest first.

---

## 2026-10-14 — Codex review fixes (xo turns 1–2)

Codex reviewed main (turn 1) and the fixes (turn 2). Test and doc changes
only; `src/` untouched. The request-boundary check allows exactly the
harness page and mock. The coexistence checks load the real BSP Forms 0.5.1
(`tests/fixtures/`, dev-only) before and after this engine, and compare every
computed style of the zone form against the form alone. Config asset paths
must resolve inside `design/`. The overview's CSS claims are corrected
(*Page-wide CSS*, the shared `[x-cloak]` rule). Each new check was shown to
fail on its breakage. Suite 100/100.

## 2026-10-14 — merged crew/zone-split-review (`9a416c3`)

An xo crew experiment ran review → fix → re-review → fix on the split. Its
reviewer found two real defects: the suite's pnp check bypassed the engine's
loader, and `live-deploy.ps1` uploaded files and recycled the page before
validating the config and template. Both fixed, plus load-state waits for
the flaky zone checks and corrected cache docs. Suite 93/93. Nothing under
`src/` changed. The crew's plan files (`docs/plans/`) were removed after the
merge; git history has them.

## 2026-10-14 — split out of bsp-sp-parts; scaffolded

Started from [projects-standard](https://github.com/whywhyjoe/projects-standard)
0.3.1, profile `sp-app`. Made standalone from `bsp-sp-parts` `fe5c040`:
the BSP Forms 0.5.1 engine and CSS forked and renamed (`PSZoneForm`,
`data-psz-form`, `.psz-*`) as engine 1.0.0; the zone config copied as is;
the BSP design-system subset (tokens, components, sprite, two images) and
Alpine 3.15.2, pnpjs v2 and intl.js 1.1.4 vendored into `src/` with their
provenance in `docs/04-vendoring.md`. Harness and the zone half of the smoke
suite ported, plus standalone checks: 90/90 green. Dev live scripts ported
and not yet run. Nothing deployed.
