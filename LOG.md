# LOG — bsp-ps-zone-attestation-form

**Append-only.** One entry per ship or merge — not per session. Current state
is in `STATE.md`.

Newest first.

---

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
