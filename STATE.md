# STATE — bsp-ps-zone-attestation-form

**Rewritten, never appended.** History lives in `LOG.md`. Cap: 150 lines — if
it is growing, something belongs in `LOG.md` or `docs/`.

Threads of work in progress: [`state/`](state/), one file per thread, kept by
the `project-state` skill.

## Where things stand

| | |
| --- | --- |
| **Version** | engine 1.3.2 (fork of BSP Forms 0.5.1, plus the resources panel, error reporting, saving overlay, and in 1.3.0 the "Work Zone Confirmation" wording, notices and the employee access list page; 1.3.1 the header who card + review callout and the access feature callout; 1.3.2 the Codex review fixes) |
| **Deployed** | **Dev** (2026-10-15, `?v=1.3.2`, four lists; admin live run 32/32): `/sites/NewNerve/FCUPortal/Code/ps-zone-attestation/`, pages `SitePages/ps-zone-attestation-test.aspx` and `ps-zone-attestation-access-test.aspx`, lists on the tenant root. **Prod:** not yet. |
| **Last shipped** | — (repo created 2026-10-14; harness suite 178/178 green) |

## Next committed step

Non-admin dev run: `node dev/live/live-zone-perms.js` (now includes the
Access list), then `node dev/live/live-zone.js --as <profile>`. Then try
`deploy/dcspad-setup-lists.js` on dev before prod.

## Blocking

- [ ] Non-admin dev run green (above).
- [ ] The contact in the form's bottom notice (`contactNotice` in the form
      JSON: name and email, both languages; a placeholder today).
- [ ] The real Access list rows, and the business owner's OK that everyone
      with Read on that list can query all of it
      (`docs/02-sharepoint-data.md`, *Permissions*).
- [ ] The two prod page names, if not `PS-Work-Zone-Confirmation.aspx` and
      `PS-Work-Zone-Access.aspx` (`vars` in the two configs).
- [ ] French for the new 1.3.0 texts (title, notices, access list): drafts.
- [ ] Real zone descriptions and the official French zone names (form JSON
      only; today they're `[Placeholder]` drafts).
- [ ] The real admin address for `errorContact.email` in the form and access configs
      (a placeholder, `form.admin@example.com`, today), the Errors list on
      prod, and its email rule (`docs/05-deploy-steps.md`, step 2b).
- [ ] Resources panel content (`src/ps-zone-attestation.resources.json`): the
      job aid and standards document URLs, the information text, the contact.
      All placeholders today.

## Manual gates

- [ ] Prod install per `docs/01-hosting-and-deploy.md`: lists, columns,
      permissions, `CurrentZone` filled, folder uploaded, page built, the
      doctor all OK, Network shows nothing outside
      `Code/ps-zone-attestation/`.
- [ ] One prod submit as an ordinary user: one item per area, reload
      says already submitted, and the user can't see others' responses.
- [ ] On prod, the access list link opens a new tab (the form stays), and
      Back closes it.
- [ ] `?lang=fr` on prod renders French.

## Deferred by design

- **Trimming the engine** to the zone form's features. It would shrink the
  attack surface, but it's a rewrite of tested code. Revisit only if the
  unused paths cause a real problem.
- **A fast (pure, no-DOM) test tier.** The engine is one IIFE with no
  importable pure module. Extracting one is a refactor for later.
- **Tracking upstream BSP Forms.** It's a frozen fork. Fixes are ported
  deliberately (`docs/04-vendoring.md`).
- **Real language detection.** It's intl.js's placeholder (`?lang=fr`) until
  `bilingual/intl.js` ships detection and it's re-vendored here.

## Open questions

- Where on prod does the folder live? The docs assume
  `/sites/FCUPortal/Code/ps-zone-attestation/`. Settle it at deploy time and
  update the web part snippet's default.
- Should the item-level Read flow on the Assignments list (privacy of
  others' assignments) be in place before go-live? It's the business
  owner's call (`docs/02-sharepoint-data.md`).
