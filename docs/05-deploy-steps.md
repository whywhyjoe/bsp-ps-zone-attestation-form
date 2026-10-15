# Deploying to production, step by step

This page is for a developer who hasn't seen this project before, and for
Copilot helping them. Follow it top to bottom. Every step says what to do and
how to know it worked. If a check fails, **stop** and use *If something goes
wrong* at the end.

## What you're deploying

The **Physical Security Work Zone Confirmation**: a form that asks each
employee to confirm the security zone of each area assigned to them. It
saves one answer per area to a SharePoint list. A second page, the
**employee access list**, shows each person which employees have access to
their areas. The form links to it (it opens in a new tab).

Three places in SharePoint are involved:

| Where | What goes there |
| --- | --- |
| `/teams/FCUWebDatastores` | Four lists: the assignments (who answers which area), the responses (the answers), the error log, and the employee access list. |
| `/sites/FCUPortal/Code/ps-zone-attestation/` | The form's files: everything in this repo's `src/` folder. |
| `/sites/FCUPortal`, two new pages | The **form page** (the form and a resources panel beside it) and the **access list page**. |

Nothing else is needed: no build, no install, no other library. The pages
load only their own files.

## See it first, on your own computer (optional)

You can run all of it locally before touching SharePoint, with sample data.
It needs no SharePoint and no internet, because SharePoint is replaced by a
stand-in (`dev/mock-sp.js`) and every other file is in the repo.

1. Get the repo. It's private on GitHub
   (`whywhyjoe/bsp-ps-zone-attestation-form`): either sign in to GitHub and
   clone it, or download it from the repo page (*Code → Download ZIP*) and
   unzip it.
2. In that folder, start a local web server. With Python:

   ```bash
   python -m http.server 8646
   ```

   No Python? Any static web server pointed at the folder works, for example
   VS Code's *Live Server* extension, or `npx http-server -p 8646` if Node is
   installed. (Double-clicking the HTML file doesn't work: the browser blocks
   the files the page loads.)
3. Open `http://localhost:8646/dev/page.html`.

What you'll see: "Dev Tester" with three sample areas, and the resources
panel on the right. You can click through everything, including submitting.
The *Employee access list* button near the top opens `dev/access.html` in a new
tab. Answers go to the stand-in, not SharePoint, and a reload starts fresh.

| Add to the address | To see |
| --- | --- |
| `?lang=fr` | French (the EN / FR buttons in the top bar also switch) |
| `?Mode=Edit` | What the web parts show while a SharePoint page is being edited |

`dev/index.html` is the form alone. Add `?validate` to it to see the
*Form configuration check* table from step 7. `dev/access.html` is the
access list page. Links in each page's top bar move between them.

VS Code's *Live Server* works too, from engine 1.2.1 on. It rewrites `.svg`
files to add its reload script, which broke the icons in earlier versions;
the engine now strips that script.

## Before you start

- [ ] You're a **site owner** on both `/teams/FCUWebDatastores` and
      `/sites/FCUPortal`.
- [ ] You have the latest code: `git pull` in this repo.
- [ ] You know the tenant host, e.g. `contoso.sharepoint.com`. It's called
      `TENANT` below.
- [ ] Confirm the folder location with the project owner. This guide uses
      `/sites/FCUPortal/Code/ps-zone-attestation/`. If yours differs, use
      yours everywhere below.
- [ ] Confirm the two page names. This guide uses
      `PS-Work-Zone-Confirmation.aspx` (the form) and
      `PS-Work-Zone-Access.aspx` (the access list); the configs already
      point at those. Other names mean one edit each in step 4.

**Never** run anything in `dev/live/`. Those scripts are for the test tenant.

## Shortcut for steps 1 and 3: the DCSPad setup script

[`deploy/dcspad-setup-lists.js`](../deploy/dcspad-setup-lists.js) creates
all four lists with every column (step 1) and adds **test data** for four test
users (step 3's rows, for testing only). It doesn't set permissions or
the email rule: steps 2 and 2b are still by hand.

1. Open DCSPad on the portal. Either **File → Load project** and pick
   [`deploy/ps-zone-attestation-list-setup.dcspad.json`](../deploy/ps-zone-attestation-list-setup.dcspad.json),
   or paste the whole `.js` file into the **JS** pane. Both hold the same
   script. No framework needs to be ticked.
2. At the top, in `SETTINGS`, put three test accounts' work emails in
   `USERS.B`, `USERS.C` and `USERS.D`. `USERS.A` is `"me"`, the person
   running it.
3. Run it as is (`DRY_RUN = true`). The console lists what it **would** do
   and changes nothing.
4. Set `DRY_RUN = false` and run again. It's safe to rerun: anything that
   exists is left alone.

What each test user sees (every area name starts with `TEST - `):

| User | Areas | What it tests |
| --- | --- | --- |
| A (you) | 3 | Two zones to confirm or change, **one with no zone set**; on the access list, two areas with employees and one with **nobody listed** |
| B | 5 | Every zone once: all five colours and descriptions |
| C | 2 | **No zone set on any area**: only dropdowns |
| D | 3 | A zone that isn't real ("Green", treated as **no zone**), an email stored in capitals, and one area **already answered** (hidden, with an "already confirmed" note) |

Anyone else sees "No areas assigned".

**Before go-live, remove the test data:** set `MODE = "remove-test-data"`,
dry-run it, then run it with `DRY_RUN = false`. It deletes only rows whose
area name starts with `TEST - `, from the assignments, responses and access
lists, including any test answers. Then add the real rows (step 3).

If you use the script, skip to step 2, then come back to step 3 for the
real rows. Step 3 also uses it once more, in its read-only
`MODE = "audit-access"`, to check the access list's area names.

## Step 1 — Create the four lists

On `/teams/FCUWebDatastores`, create four **custom lists** with these exact
names. For each column: *Add column* → the type shown → type the name
**exactly** as written (capitals, no spaces). The name you type first is the
one the form uses. Rename the display name afterwards if you like.

**List 1: `PS_Zone-Attestation-Assignments`**

| Column | Type | Settings |
| --- | --- | --- |
| `UserEmail` | Single line of text | Indexed (List settings → Indexed columns) |
| `UserDescription` | Single line of text | |
| `AreaName` | Single line of text | Enforce unique values: Yes |
| `CurrentZone` | Single line of text | |

Then List settings → `Title` column → Required: **No**.

**List 2: `PS_Zone-Attestation-Responses`**

| Column | Type | Settings |
| --- | --- | --- |
| `LookupID` | Number | 0 decimal places |
| `UserName` | Single line of text | |
| `UserEmail` | Single line of text | Indexed |
| `UserDescription` | Single line of text | |
| `AreaName` | Single line of text | |
| `ZoneSelection` | Single line of text | |
| `PreviousZone` | Single line of text | |
| `ZoneChanged` | Yes/No | |
| `Attestation` | Single line of text | |
| `AttestationTime` | Date and Time | Include time: **Yes** |

(The column names keep the old word "attestation"; only the wording on the
page changed. Submitting saves `Attestation = Confirmed`.)

**List 3: `PS_Zone-Attestation-Errors`** (the error log: one item per
failure a user hits; step 2b makes it email you)

| Column | Type | Settings |
| --- | --- | --- |
| `ErrorKind` | Single line of text | `init`, `load`, `save` or `access` |
| `Message` | Multiple lines of text | Plain text |
| `Detail` | Multiple lines of text | Plain text |
| `UserEmail` | Single line of text | |
| `EngineVersion` | Single line of text | |

The form fills `Title` itself (`[kind] message`).

**List 4: `PS_Zone-Attestation-Access`** (the employee access list: one row
per employee per area)

| Column | Type | Settings |
| --- | --- | --- |
| `AreaName` | Single line of text | Indexed |
| `EmployeeName` | Single line of text | |
| `EmployeeEmail` | Single line of text | |

Then List settings → `Title` column → Required: **No**.

✅ **Check:** all four lists exist, with every column named exactly as
above.

## Step 2 — Set permissions

**Assignments list:** everyone who takes the confirmation needs **Read**.

**Responses list:**
1. List settings → Permissions → *Stop inheriting permissions*.
2. Give the users a permission level with **View Items, Add Items, Open,
   View Pages**, and **no** Edit or Delete. If no such level exists, create
   one (Site settings → Site permissions → Permission levels), e.g. "View and
   Add".
3. List settings → Advanced settings:
   - Read access: **Read items that were created by the user**
   - Create and Edit access: **Create items and edit items that were created
     by the user**

**Errors list:** same as the Responses list (stop inheriting; users get
the "View and Add" level; Advanced settings: read and edit only their own
items). Users must be able to **add** here, or a failure they hit can't
be logged.

**Access list:** everyone who takes the confirmation needs **Read**.
⚠️ Read means read **all** of it: the page shows each person only their own
areas, but anyone with Read could query the whole list (who has access to
which area) with SharePoint's own tools. Confirm with the project owner that
this is acceptable before filling it in.

✅ **Check:** an ordinary user can open the lists, can't edit the
assignments or the access list, and sees only their own responses.

## Step 2b — Have errors emailed to you

On the **Errors** list: *Automate* (top bar) → *Rules* → *Create a rule* →
**A new item is created** → set *send an email to* **you** (or the admin
group) → *Create*.

That's all. No Power Automate. Each failure a user hits (the form couldn't
start, couldn't load their areas, couldn't save, or the access list
couldn't load) adds one item, and the rule emails you. A page sends at most
one report per kind of failure, so a broken list can't flood your inbox.

Then set who the **users** can email. When something fails, the page shows
the user the error with an *Email the form administrator about this
problem* link. That link opens their mail program with a subject and the
diagnostic details already filled in. Put that address in `errorContact.email`
in **both** `src/ps-zone-attestation.json` and
`src/ps-zone-attestation.access.json` (each ships as the placeholder
`form.admin@example.com`). The subject is `errorContact.subject`, in both
languages.

✅ **Check:** add a test item to the Errors list by hand: the rule's email
arrives. Delete the test item.

## Step 3 — Fill in the assignments and the access list

**Assignments:** one row per person × area in
`PS_Zone-Attestation-Assignments`:

- `UserEmail`: the person's work email.
- `AreaName`: the area's name, shown on the form.
- `UserDescription`: any short description, copied into each answer.
- `CurrentZone`: the area's zone today, spelled **exactly** as one of
  `Public`, `Public Plus`, `Standards`, `Secure Restricted`, `High Security`.
  Leave it empty if unknown (the person then picks one).

Add a row for yourself too, so you can test in step 7.

**Access list:** one row per employee × area in
`PS_Zone-Attestation-Access`:

- `AreaName`: the area, spelled **exactly** as in the Assignments list
  (capitals don't matter; anything else does, **including a space at either end**, which is easy to paste in from Excel).
- `EmployeeName`, `EmployeeEmail`: the employee with access.

An area with no rows shows "No employees are listed for this area".

✅ **Check the area names:** run the DCSPad setup script with
`MODE = "audit-access"` (it changes nothing). It lists every access row
that will **never show**: a space at either end of `AreaName`, a blank
`AreaName`, a row with neither `EmployeeName` nor `EmployeeEmail`, or an
area that isn't in the Assignments list (a typo). Fix
those rows in the list and run it again until it reports 0. It also lists
the assigned areas with nobody listed, in case that's a gap. Run it again
whenever the access list is reloaded.

## Step 4 — Fill in the wording, links and contacts

Three files in `src/` hold everything you may need to fill in. They ship
with `[Placeholder]` texts.

**The form, `src/ps-zone-attestation.json`:**

- The contact at the bottom of the form: the `contactNotice` text, in both
  languages. Replace `[Placeholder] Contact Name` and both copies of
  `contact.name@example.com` (the link text and the `mailto:`).
- `form.vars.accessListUrl`: the access list page. Change it only if your
  page isn't `/sites/FCUPortal/SitePages/PS-Work-Zone-Access.aspx`.
- Change nothing else unless the project owner asks. In particular, never
  change a zone's `"value"`.

**The access list, `src/ps-zone-attestation.access.json`:**

- `vars.formUrl`: the form page, for the *Back to confirmation form* link.
  Change it only if your page isn't
  `/sites/FCUPortal/SitePages/PS-Work-Zone-Confirmation.aspx`.

**The side panel, `src/ps-zone-attestation.resources.json`** (the job aid,
document links, information text and a contact):

- For each link, put its address between the quotes of its `"url": ""`.
  While a `url` is empty the item still shows, just not as a link.
- Replace the `[Placeholder]` texts and the contact's `name` and `email`.

To have someone else supply the wording, send them
[`PS-Work-Zone-Confirmation-wording.docx`](PS-Work-Zone-Confirmation-wording.docx):
every string in English and French with blank columns for new text, and the
location in these files for whoever applies it.

You can also do all of this later, in the uploaded copies.
`docs/03-config.md` describes every key.

## Step 5 — Upload the form's files

Upload the **contents** of `src/` (not the `src` folder itself) to
`/sites/FCUPortal/Code/ps-zone-attestation/`, keeping the two subfolders.
Create the folder if needed. Browser upload (drag the files and the two
folders in) or the library's OneDrive-synced folder both work.

The folder must end up exactly like this, 13 files:

```
ps-zone-attestation/
├─ ps-zone-attestation.js
├─ ps-zone-attestation.css
├─ ps-zone-attestation.json
├─ ps-zone-attestation.resources.json
├─ ps-zone-attestation.access.json
├─ design/
│  ├─ colors_and_type.css
│  ├─ components.css
│  ├─ fluent-basic-icons.svg
│  ├─ abacus-icons/light-bulb-48.svg
│  └─ spot-illustrations/shield-checkmark-xs.svg
└─ lib/
   ├─ alpine.js
   ├─ intl.js
   └─ pnp2.bundle.js
```

Upload nothing from outside `src/`.

✅ **Check:** the folder holds those 13 files in those places.

## Step 6 — Create the two pages

**The form page** (`PS-Work-Zone-Confirmation.aspx`):

1. On `/sites/FCUPortal`, create a new page. Use **a page of its own**: no
   script web parts on it other than these two.
2. Give it a section with **two columns, two-thirds left and one-third
   right** (*Add section* → the ⅔ + ⅓ layout; ¾ + ¼ also works).
3. **Left column, the form:** add a **Modern Script Editor** web part (the
   one already used on the portal) and paste this, with `TENANT` replaced by
   your tenant host:

   ```html
   <div data-psz-form data-validate data-config="/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.json"></div>
   <script src="https://TENANT.sharepoint.com/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.js?v=1.4.2"></script>
   ```

   It's the snippet in `webpart/ps-zone-attestation.webpart.html`, plus
   `data-validate`, which turns on a setup check for step 7.
4. **Right column, the resources panel:** add a second Modern Script Editor
   web part and paste this (same `TENANT`, same `?v=`):

   ```html
   <div data-psz-resources data-config="/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.resources.json"></div>
   <script src="https://TENANT.sharepoint.com/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.js?v=1.4.2"></script>
   ```

   It's `webpart/ps-zone-attestation-resources.webpart.html`. Both web parts
   load the same script, but it only runs once.
5. Publish.

**The access list page** (`PS-Work-Zone-Access.aspx`):

1. Create another new page, again a page of its own, with one full-width
   section.
2. Add a Modern Script Editor web part and paste this (same `TENANT`, same
   `?v=`):

   ```html
   <div data-psz-access data-config="/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.access.json"></div>
   <script src="https://TENANT.sharepoint.com/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.js?v=1.4.2"></script>
   ```

   It's `webpart/ps-zone-attestation-access.webpart.html`.
3. Publish. You don't need to add this page to the site's navigation:
   people reach it from the form.

While you edit a page, its web parts show a grey note ("PS Zone
Attestation — renders in view mode"). That's expected. They appear once the
page is published or you leave edit mode.

## Step 7 — Check it works

Open the published form page.

1. **Setup check:** a table titled *Form configuration check* is above the
   form. Every row must say **OK**. A **Problem** row names the column to
   fix (go back to step 1).
2. **Files:** press F12 → Network, reload. Every request for the form's files
   goes to `…/Code/ps-zone-attestation/…`. None goes to `Code/bsp-design`,
   `Code/lib` or `Code/bsp-forms`. In the Console, no red `[PS Zone Form]`
   errors.
3. Edit the page, **remove `data-validate`** from the snippet, republish.
4. **The header and notices:** in the blue header band, the "changes will
   be reviewed" box under the intro, and *Confirmation by:* with your name on
   the right. Below the header, the *Who has access to your areas?* box with
   its *Employee access list* button. At the bottom, the contact message.
   Change one zone: a "You changed at least one zone…" box appears at the
   bottom; *Keep current zone* hides it again.
5. **The access list:** click *Employee access list*. It opens **in a new
   tab**, and the form stays in its own tab with your answers. The new tab
   lists your areas, all expanded, with each area's employees. *Back to
   confirmation form* closes that tab.
6. **Test submit:** as a test user with rows (or yourself), confirm or
   change each area, press *Submit confirmations*, then *Confirm*. Check the
   Responses list: one new item per area, with `ZoneSelection`,
   `Attestation = Confirmed` and the time.
7. Reload the page: it says the confirmation was already submitted.
8. Add `?lang=fr` to each page's URL: the form, the side panel and the access
   list are in French.
9. **Side panel:** each link you filled in (step 4) opens in a new tab.
10. Delete your test responses from the Responses list (otherwise those areas
    count as done). If you used the setup script, its `remove-test-data` mode
    does this and removes the test assignments and access rows too.

When all of that passes, the deploy is done. Tell the project owner, and note
the date and `?v=` you deployed in `STATE.md`.

## Later changes

- **Wording or zones:** edit the uploaded `ps-zone-attestation.json`.
  **Side panel links, text or contact:** edit the uploaded
  `ps-zone-attestation.resources.json`. **Access list wording:** edit the
  uploaded `ps-zone-attestation.access.json`. Make the same edit in this
  repo. It takes effect on the next page load; nothing else to do.
- **Who has access to what:** edit the Access list. Live on the next page
  load.
- **A new version of the form's code** (`ps-zone-attestation.js` or `.css`):
  1. Download the two deployed files first (for rollback).
  2. Upload the new ones over them.
  3. In **all three** web parts (two on the form page, one on the access
     list page), change `?v=1.4.2` to the new version (the `VERSION` line
     near the top of `ps-zone-attestation.js`). Without this, browsers may
     keep the old code.
  4. Repeat step 7's checks 2, 5, 6 and 7.
  - **Rollback:** upload the saved files and put the old `?v=` back.
- **A new confirmation round:** archive or clear the Responses list. Anyone
  with a response for an area won't be asked about it again.

## If something goes wrong

| You see | Likely cause | Fix |
| --- | --- | --- |
| A grey "renders in view mode" note | The page is in edit mode | Publish, or leave edit mode |
| "This form couldn't be loaded" | The `data-config` path is wrong, or the JSON is broken | Check the path in the snippet; undo your last JSON edit |
| Nothing at all where the form should be | The `<script src>` URL is wrong, or the files aren't uploaded | Check the URL and step 5's folder layout |
| A **Problem** row in the setup check | A column is missing or misnamed | Fix it in the list (step 1); names must match exactly |
| "No areas assigned" | No assignment row has this person's email | Check `UserEmail` in the Assignments list (step 3) |
| "Your assigned areas couldn't be loaded" | No read access to the Assignments list | Step 2 |
| Submit fails with an error | No add access to the Responses list | Step 2 |
| Broken image for the job aid icon or thank-you art | A `design/` file is missing | Re-upload `design/` (step 5) |
| Old behaviour after uploading new code | Browser cache | Bump `?v=` in all three web parts |
| "This form couldn't be loaded" in the **side panel** only | Its `data-config` path is wrong, or the resources JSON is broken | Check the path; undo your last edit of `ps-zone-attestation.resources.json` |
| No email when an error is logged | The Errors list has no rule, or users can't add to it | Step 2b (the rule) and step 2 (Add rights on the Errors list) |
| The error's email link goes to `form.admin@example.com` | `errorContact.email` still holds the placeholder | Step 2b |
| A side panel item that isn't clickable | Its `url` is empty, or isn't an `https://…` or `/sites/…` address | Fix the `url` (step 4) |
| The *Employee access list* button goes to a missing page | The page name differs from `form.vars.accessListUrl` | Step 4 |
| The access list replaces the form **in the same tab** | An engine older than 1.3.0 is still cached | Bump `?v=`; the link must carry `data-interception="off"` (F12 → Elements) |
| "The access list couldn't be loaded" | No read access to the Access list, or it's missing a column | Steps 1 and 2 |
| An area says "No employees are listed" but has rows | `AreaName` in the Access list doesn't match the Assignments list (a typo, or a space at either end) | Run the setup script with `MODE = "audit-access"` (step 3); fix the rows it lists |
| *Back to confirmation form* goes to a missing page | The page name differs from `vars.formUrl` | Step 4 |

Still stuck: don't change the code. Note what you see (screenshot, Console
errors) and contact the project owner.

## Don'ts

- Don't run anything in `dev/live/` (test tenant only).
- Don't edit files in `design/` or `lib/`.
- Don't point the form at the shared `Code/bsp-design`, `Code/lib` or
  `Code/bsp-forms` folders.
- Don't put the form or the access list on a page with other script web
  parts (the side panel is the one exception: it's the same engine).
- Don't change a zone's `"value"` in the JSON (labels are fine).
