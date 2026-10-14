# bsp-ps-zone-attestation-form — docs index

Read `00` first, then the one or two topics your task actually touches. Each
file is sized to be read whole.

**No file exists in `docs/` without a row here.**

| Doc | Read it when |
| --- | --- |
| [`00-overview.md`](00-overview.md) | **Always first.** What the form is, why it's standalone, how the pieces fit, decisions, paid-for gotchas. |
| [`01-hosting-and-deploy.md`](01-hosting-and-deploy.md) | You're deploying, changing how it loads, or debugging "blank / stale after deploy / loads the wrong copy". |
| [`02-sharepoint-data.md`](02-sharepoint-data.md) | You're touching the two lists, their columns or permissions, or anything in the adapter. |
| [`03-config.md`](03-config.md) | You're changing wording, zones, the job aid, or list names in `src/ps-zone-attestation.json`. |
| [`04-vendoring.md`](04-vendoring.md) | You're refreshing a vendored file or porting a fix from BSP Forms. Holds the provenance and hash table. |

**Known gaps:** [`../STATE.md`](../STATE.md) is the register of deferred work
and decisions awaiting a human. Check there before assuming an oversight.
