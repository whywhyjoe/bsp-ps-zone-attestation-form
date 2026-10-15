# Deploying to production, step by step

This page is for a developer who hasn't seen this project before, and for
Copilot helping them. Follow it top to bottom. Every step says what to do and
how to know it worked. If a check fails, **stop** and use *If something goes
wrong* at the end.

## What you're deploying

A form that asks each employee to confirm the security zone of each area
assigned to them. It saves one answer per area to a SharePoint list.

Three places in SharePoint are involved:

| Where | What goes there |
| --- | --- |
| `/teams/FCUWebDatastores` | Two lists: the assignments (who answers which area) and the responses (the answers). |
| `/sites/FCUPortal/Code/ps-zone-attestation/` | The form's files: everything in this repo's `src/` folder. |
| `/sites/FCUPortal`, a new page | The page people open. It has two web parts: the form, and a resources panel beside it. |

Nothing else is needed: no build, no install, no other library. The form
loads only its own files.

## See it first, on your own computer (optional)

You can run the whole page locally before touching SharePoint: the form and
its resources panel, with sample data. It needs no SharePoint and no
internet, because SharePoint is replaced by a stand-in (`dev/mock-sp.js`) and
every other file is in the repo.

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
Answers go to the stand-in, not SharePoint, and a reload starts fresh.

| Add to the address | To see |
| --- | --- |
| `?lang=fr` | French (the EN / FR buttons in the top bar also switch) |
| `?Mode=Edit` | What the web parts show while a SharePoint page is being edited |

`dev/index.html` is the form alone. Add `?validate` to it to see the
*Form configuration check* table from step 7.

## Before you start

- [ ] You're a **site owner** on both `/teams/FCUWebDatastores` and
      `/sites/FCUPortal`.
- [ ] You have the latest code: `git pull` in this repo.
- [ ] You know the tenant host, e.g. `contoso.sharepoint.com`. It's called
      `TENANT` below.
- [ ] Confirm the folder location with the project owner. This guide uses
      `/sites/FCUPortal/Code/ps-zone-attestation/`. If yours differs, use
      yours everywhere below.

**Never** run anything in `dev/live/`. Those scripts are for the test tenant.

## Shortcut for steps 1 and 3: the DCSPad setup script

[`deploy/dcspad-setup-lists.js`](../deploy/dcspad-setup-lists.js) creates
both lists with every column (step 1) and adds **test data** for four test
attesters (step 3's rows, for testing only). It doesn't set permissions:
step 2 is still by hand.

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

What each test attester sees (every area name starts with `TEST - `):

| Attester | Areas | What it tests |
| --- | --- | --- |
| A (you) | 3 | Two zones to confirm or change, **one with no zone set** |
| B | 5 | Every zone once: all five colours and descriptions |
| C | 2 | **No zone set on any area**: only dropdowns |
| D | 3 | A zone that isn't real ("Green", treated as **no zone**), an email stored in capitals, and one area **already answered** (hidden, with an "already attested" note) |

Anyone else sees "No areas assigned".

**Before go-live, remove the test data:** set `MODE = "remove-test-data"`,
dry-run it, then run it with `DRY_RUN = false`. It deletes only rows whose
area name starts with `TEST - `, from both lists, including any test
answers. Then add the real assignments (step 3).

If you use the script, skip to step 2, then come back to step 3 for the
real rows.

## Step 1 — Create the two lists

On `/teams/FCUWebDatastores`, create two **custom lists** with these exact
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

✅ **Check:** both lists exist, with every column named exactly as above.

## Step 2 — Set permissions

**Assignments list:** everyone who takes the attestation needs **Read**.

**Responses list:**
1. List settings → Permissions → *Stop inheriting permissions*.
2. Give the attesters a permission level with **View Items, Add Items, Open,
   View Pages**, and **no** Edit or Delete. If no such level exists, create
   one (Site settings → Site permissions → Permission levels), e.g. "View and
   Add".
3. List settings → Advanced settings:
   - Read access: **Read items that were created by the user**
   - Create and Edit access: **Create items and edit items that were created
     by the user**

✅ **Check:** an ordinary attester can open both lists, can't edit the
assignments, and sees only their own responses.

## Step 3 — Fill in the assignments

One row per person × area in `PS_Zone-Attestation-Assignments`:

- `UserEmail`: the person's work email.
- `AreaName`: the area's name, shown on the form.
- `UserDescription`: any short description, copied into each answer.
- `CurrentZone`: the area's zone today, spelled **exactly** as one of
  `Public`, `Public Plus`, `Standards`, `Secure Restricted`, `High Security`.
  Leave it empty if unknown (the person then picks one).

Add a row for yourself too, so you can test in step 7.

## Step 4 — Fill in the side panel's links and text (optional)

The page's right-hand column shows a **resources panel**: the job aid,
document links, some information text and a contact. Its content is in
`src/ps-zone-attestation.resources.json`, and it ships with placeholders.

- For each link, put its address between the quotes of its `"url": ""`.
  While a `url` is empty the item still shows, just not as a link.
- Replace the `[Placeholder]` texts and the contact's `name` and `email`.

You can also do this later, in the uploaded copy. `docs/03-config.md`
(*The resources panel*) describes every key.

In the form's own file, `src/ps-zone-attestation.json`, change nothing
unless the project owner asks. In particular, never change a zone's
`"value"`.

## Step 5 — Upload the form's files

Upload the **contents** of `src/` (not the `src` folder itself) to
`/sites/FCUPortal/Code/ps-zone-attestation/`, keeping the two subfolders.
Create the folder if needed. Browser upload (drag the files and the two
folders in) or the library's OneDrive-synced folder both work.

The folder must end up exactly like this, 12 files:

```
ps-zone-attestation/
├─ ps-zone-attestation.js
├─ ps-zone-attestation.css
├─ ps-zone-attestation.json
├─ ps-zone-attestation.resources.json
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

✅ **Check:** the folder holds those 12 files in those places.

## Step 6 — Create the page

1. On `/sites/FCUPortal`, create a new page for the attestation. Use **a page
   of its own**: no script web parts on it other than these two.
2. Give it a section with **two columns, two-thirds left and one-third
   right** (*Add section* → the ⅔ + ⅓ layout; ¾ + ¼ also works).
3. **Left column, the form:** add a **Modern Script Editor** web part (the
   one already used on the portal) and paste this, with `TENANT` replaced by
   your tenant host:

   ```html
   <div data-psz-form data-validate data-config="/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.json"></div>
   <script src="https://TENANT.sharepoint.com/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.js?v=1.1.0"></script>
   ```

   It's the snippet in `webpart/ps-zone-attestation.webpart.html`, plus
   `data-validate`, which turns on a setup check for step 7.
4. **Right column, the resources panel:** add a second Modern Script Editor
   web part and paste this (same `TENANT`, same `?v=`):

   ```html
   <div data-psz-resources data-config="/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.resources.json"></div>
   <script src="https://TENANT.sharepoint.com/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.js?v=1.1.0"></script>
   ```

   It's `webpart/ps-zone-attestation-resources.webpart.html`. Both web parts
   load the same script, but it only runs once.
5. Publish.

While you edit the page, both web parts show a grey note ("PS Zone
Attestation — renders in view mode"). That's expected. The form and the
panel appear once the page is published or you leave edit mode.

## Step 7 — Check it works

Open the published page.

1. **Setup check:** a table titled *Form configuration check* is above the
   form. Every row must say **OK**. A **Problem** row names the column to
   fix (go back to step 1).
2. **Files:** press F12 → Network, reload. Every request for the form's files
   goes to `…/Code/ps-zone-attestation/…`. None goes to `Code/bsp-design`,
   `Code/lib` or `Code/bsp-forms`. In the Console, no red `[PS Zone Form]`
   errors.
3. Edit the page, **remove `data-validate`** from the snippet, republish.
4. **Test submit:** as a test attester with rows (or yourself), confirm or
   change each area, tick the attestation box, press *Submit attestation*,
   then *Confirm*. Check the Responses list: one new item per area, with
   `ZoneSelection`, `Attestation = Confirmed` and the time.
5. Reload the page: it says the attestation was already submitted.
6. Add `?lang=fr` to the page URL: the form and the side panel are in
   French.
7. **Side panel:** each link you filled in (step 4) opens in a new tab.
8. Delete your test responses from the Responses list (otherwise those areas
   count as done). If you used the setup script, its `remove-test-data` mode
   does this and removes the test assignments too.

When all of that passes, the deploy is done. Tell the project owner, and note
the date and `?v=` you deployed in `STATE.md`.

## Later changes

- **Wording or zones:** edit the uploaded `ps-zone-attestation.json`.
  **Side panel links, text or contact:** edit the uploaded
  `ps-zone-attestation.resources.json`. Make the same edit in this repo.
  It takes effect on the next page load; nothing else to do.
- **A new version of the form's code** (`ps-zone-attestation.js` or `.css`):
  1. Download the two deployed files first (for rollback).
  2. Upload the new ones over them.
  3. In **both** web parts, change `?v=1.1.0` to the new version (the
     `VERSION` line near the top of `ps-zone-attestation.js`). Without this,
     browsers may keep the old code.
  4. Repeat step 7's checks 2, 4 and 5.
  - **Rollback:** upload the saved files and put the old `?v=` back.
- **A new attestation round:** archive or clear the Responses list. Anyone
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
| Old behaviour after uploading new code | Browser cache | Bump `?v=` in both web parts |
| "This form couldn't be loaded" in the **side panel** only | Its `data-config` path is wrong, or the resources JSON is broken | Check the path; undo your last edit of `ps-zone-attestation.resources.json` |
| A side panel item that isn't clickable | Its `url` is empty, or isn't an `https://…` or `/sites/…` address | Fix the `url` (step 4) |

Still stuck: don't change the code. Note what you see (screenshot, Console
errors) and contact the project owner.

## Don'ts

- Don't run anything in `dev/live/` (test tenant only).
- Don't edit files in `design/` or `lib/`.
- Don't point the form at the shared `Code/bsp-design`, `Code/lib` or
  `Code/bsp-forms` folders.
- Don't put the form on a page with other script web parts (the side
  panel is the one exception: it's the same engine).
- Don't change a zone's `"value"` in the JSON (labels are fine).
