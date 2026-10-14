# Copilot instructions

The rules for this repo are in [`CLAUDE.md`](../CLAUDE.md); read it first. This file only points there.

- **Helping someone deploy:** follow [`docs/05-deploy-steps.md`](../docs/05-deploy-steps.md) one step at a time, run each step's check before moving on, and if a check fails, use its *If something goes wrong* table instead of changing code.
- **Never** suggest running anything in `dev/live/` (test tenant only), editing `src/design/` or `src/lib/` (vendored copies), or pointing the form at the shared `Code/bsp-design`, `Code/lib` or `Code/bsp-forms` folders.
