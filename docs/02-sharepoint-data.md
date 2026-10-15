# SharePoint data

All four lists live on `/teams/FCUWebDatastores`; the pages are on
`/sites/FCUPortal`. The engine addresses them by title (`siteUrl` +
`listTitle` in the config). Every read and write goes through `makeAdapter`
in the engine (pnpjs v2, `lib/pnp2.bundle.js`). The mock twin is
`dev/mock-sp.js`.

## The lists

This section says what each column means. To create the lists and set
permissions, follow [`05-deploy-steps.md`](05-deploy-steps.md) steps 1–2.
That page repeats the names and types as a setup checklist, and
`deploy/dcspad-setup-lists.js` creates them (as do `dev/live/live-zone-lists.js`
on the dev tenant), so change all of them if a column changes.

Create each column with **exactly** this name first. The name you type
becomes the internal name the form uses, and the display name can change
afterwards.

**PS_Zone-Attestation-Assignments** (the source, one row per person × area):

| Column | Type | Notes |
| --- | --- | --- |
| `UserEmail` | Single line of text | **Indexed.** The assignee's email, any case. |
| `UserDescription` | Single line of text | Copied into each response. |
| `AreaName` | Single line of text | **Enforce unique values** (this indexes it). The card's name. |
| `CurrentZone` | Single line of text (or Choice) | Exactly one of `Public`, `Public Plus`, `Standards`, `Secure Restricted`, `High Security`, or empty (the user then picks one). Any other text counts as empty. |

`Title` is unused: make it optional (List settings → Title → Required: No)
or put the area name in it.

**PS_Zone-Attestation-Responses** (the save-back, one item per row answered):

| Column | Type | Notes |
| --- | --- | --- |
| `LookupID` | Number, 0 decimals | The assignment item's ID. Also how answered rows are recognised. |
| `UserName` | Single line of text | |
| `UserEmail` | Single line of text | **Indexed.** |
| `UserDescription` | Single line of text | |
| `AreaName` | Single line of text | |
| `ZoneSelection` | Single line of text (or Choice) | The confirmed zone, always the English value. |
| `PreviousZone` | Single line of text (or Choice) | The area's `CurrentZone` when answered; empty if none. |
| `ZoneChanged` | Yes/No | Yes when `ZoneSelection` ≠ `PreviousZone` (or there was none). |
| `Attestation` | Single line of text | `Confirmed` (`target.set`: submitting is the confirmation). The column names keep "Attestation"; only the page's wording moved to "confirmation" (1.3.0). |
| `AttestationTime` | Date and Time, **include time** | Shown in the site's time zone. |

The form fills `Title` itself (`<area> — <email>`).

**PS_Zone-Attestation-Errors** (the error log, config `errorLog`; one item
per failure a user hits):

| Column | Type | Notes |
| --- | --- | --- |
| `Title` | Single line of text | `[kind] message`, filled by the form. |
| `ErrorKind` | Single line of text | `init` (couldn't start), `load` (couldn't load the user's areas), `save` (couldn't save), `access` (the access list page couldn't load). |
| `Message` | Multiple lines, plain text | The error's message. |
| `Detail` | Multiple lines, plain text | One `label: value` per line: when, user, page, engine and language, browser, the list involved, rows saved. |
| `UserEmail` | Single line of text | The user who hit it, when known. |
| `EngineVersion` | Single line of text | The engine's `VERSION`. |

`Created` says when. **The email to the admin is a SharePoint list rule**
on this list ("A new item is created" → send an email), set by hand in the
list UI (*Automate → Rules*). There's no flow. The engine writes the item
with plain REST and a request digest, not pnpjs, so a failed pnp load can
still be reported. It's fire-and-forget: a write that fails only warns in
the console. At most one report per kind and 5 per page load.

**PS_Zone-Attestation-Access** (the employee access list page, config
`ps-zone-attestation.access.json`; one row per employee × area):

| Column | Type | Notes |
| --- | --- | --- |
| `AreaName` | Single line of text | **Indexed.** The area, as in the Assignments list's `AreaName` (matched ignoring case and outer spaces). |
| `EmployeeName` | Single line of text | Shown, sorted by. |
| `EmployeeEmail` | Single line of text | Shown as a mailto link when it's an address. |

`Title` is unused: make it optional. An area with no rows shows "No
employees are listed for this area". The page never writes here.

## Permissions

- **Assignments:** Read for everyone who takes the confirmation.
- **Access:** Read for the same people. The page shows each user only their
  own areas, but Read covers the whole list: anyone could query who has
  access to which area over REST. If that's not acceptable, the list needs
  item-level permissions (the same flow as for Assignments, below, keyed on
  a per-row user column the page doesn't have today).
- **Responses:** stop inheriting. Users get a custom level with **View
  Items, Add Items, Open, View Pages** and no Edit or Delete (dev calls it
  "View and Add"). Advanced settings: **Read items that were created by the
  user** and **Create items and edit items that were created by the user**.
- **Errors:** set up like Responses: users can **add** (or a failure
  they hit can't be logged) and read only their own items. The admin who
  owns the email rule needs to read everything.
- Owners keep Full Control. Granting on the lists gives Limited Access to
  the site automatically.

**The user filter is not security.** The form asks for
`UserEmail eq <you>` in the browser, but anyone with read on the
Assignments list can read all of it over REST. If people mustn't see each
other's assignments, break inheritance on that list too and grant each item
**Read** to the person in its `UserEmail`. A standard-connector flow can do
it: "When an item is created" → "Grant access to an item or a folder",
recipient = `UserEmail`, role = Read, notify = no. The form keeps working
unchanged. If "can't change their answers" must be enforced, the custom
level without Edit Items is what does it, not the form.

## Reads

- Assignments: `$filter` on `UserEmail` (each of the user's addresses),
  `$select` of the needed columns, `$orderby AreaName`, `$top` = config `top`
  + 1 so a cut-off is detected and shown.
- Earlier responses: the user's `LookupID`s, up to 5,000 (+1 to detect a
  cut-off). Before a retry, an exact check for just the unsaved rows' IDs
  (chunks of 20, number keys unquoted), which the cap doesn't apply to.
- Access (the access list page): `$filter` on `AreaName` for the user's
  areas, 20 areas per request, `$select` of the three columns, up to 2,000
  rows per request (+1 to detect a cut-off, shown as a warning).
- Lists over 5,000 items need `UserEmail` indexed in Assignments and
  Responses, and `AreaName` in Access, or the filtered reads hit the list
  view threshold.

## Writes

- One `items.add` per row, in order, carrying the item type read from the
  target list itself (never pnp's cached guess; see the gotcha in
  `00-overview.md`).
- The current user's name and email come from `_spPageContextInfo` or, on
  modern pages without it, `/_api/web/currentuser`. No `ensureUser` is
  needed: the form has no person columns.
- pnp handles the request digest.

## Verified only in a real tenant

Add-only rights, own-items read, cross-site writes, and a non-admin not
seeing others' responses can't be tested in the harness. They're manual
gates in `STATE.md`, run with `dev/live/` (`live-zone.js --as <profile>` adds
the non-admin checks).
