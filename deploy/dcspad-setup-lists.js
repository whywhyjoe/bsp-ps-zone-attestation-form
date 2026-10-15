/* =====================================================================
   PS Zone Attestation — create the three SharePoint lists (assignments,
   responses, error log) and add test data.

   Run it in DCSPad: paste this whole file into the JS pane and press Run
   (or File > Load project: ps-zone-attestation-list-setup.dcspad.json).
   No framework needs to be ticked; it uses plain SharePoint REST calls with
   your own sign-in. You need to be a site owner on SITE below.

   It is safe to run more than once: lists, columns and rows that already
   exist are left alone and reported as "exists".

   1. Edit the SETTINGS block (the email addresses especially).
   2. Run with DRY_RUN = true. Read the console: it lists what it WOULD do.
   3. Set DRY_RUN = false and run again to do it.
   4. Before go-live, set MODE = "remove-test-data" and run it (dry run
      first) to delete every test row from both lists.

   It does NOT set permissions or the error log's email rule. Do
   docs/05-deploy-steps.md step 2 by hand.
   ===================================================================== */
(async () => {
  // ------------------------------- SETTINGS -------------------------------
  const SITE = "/teams/FCUWebDatastores"; // the site the lists live on
  const DRY_RUN = true;                    // true = report only, change nothing
  const MODE = "setup";                    // "setup" or "remove-test-data"

  // Four test attesters. "me" means whoever runs this script (so you can
  // test straight away). Replace the other three with real test accounts'
  // work emails; rows for an address nobody signs in with are harmless, but
  // nobody can test them.
  const USERS = {
    A: "me",
    B: "test.attester.b@example.com",
    C: "test.attester.c@example.com",
    D: "test.attester.d@example.com",
  };
  // ------------------------------------------------------------------------

  // Every test row's area name starts with this, so remove-test-data can
  // find exactly those rows and nothing else.
  const TEST_PREFIX = "TEST - ";
  const ASSIGNMENTS = "PS_Zone-Attestation-Assignments";
  const RESPONSES = "PS_Zone-Attestation-Responses";
  const ERRORS = "PS_Zone-Attestation-Errors";

  // What each test attester sees. CurrentZone "" = no zone set yet: the form
  // shows a dropdown instead of confirm / change.
  const TEST_ROWS = [
    // A: a mix: two zones to confirm or change, one with no zone set
    { user: "A", area: "Concourse Podium", zone: "High Security" },
    { user: "A", area: "Tower 10", zone: "Public Plus" },
    { user: "A", area: "Tower 37", zone: "" },
    // B: every zone once, to see all five colours and descriptions
    { user: "B", area: "Main Lobby", zone: "Public" },
    { user: "B", area: "Client Lounge", zone: "Public Plus" },
    { user: "B", area: "Operations Floor", zone: "Standards" },
    { user: "B", area: "Records Room", zone: "Secure Restricted" },
    { user: "B", area: "Vault", zone: "High Security" },
    // C: no zone set on any area: only dropdowns
    { user: "C", area: "Annex Storage", zone: "" },
    { user: "C", area: "Parking Level P2", zone: "" },
    // D: edge cases
    { user: "D", area: "Server Room", zone: "Green",
      note: "not a real zone, so the form treats it as no zone set" },
    { user: "D", area: "Mail Room", zone: "Standards", upperCaseEmail: true,
      note: "email stored in capitals; the form must still match it" },
    { user: "D", area: "Training Centre", zone: "Public", answered: true,
      note: "already answered: hidden, with an 'already attested' note" },
  ];

  // The columns the form needs. Names are exact: the form reads these.
  const text = (name, extra = "") =>
    `<Field Type="Text" Name="${name}" StaticName="${name}" DisplayName="${name}" MaxLength="255" ${extra} />`;
  const LISTS = {
    [ASSIGNMENTS]: {
      titleOptional: true,
      fields: {
        UserEmail: { type: "Text", xml: text("UserEmail", 'Indexed="TRUE"') },
        UserDescription: { type: "Text", xml: text("UserDescription") },
        AreaName: { type: "Text", xml: text("AreaName", 'Indexed="TRUE" EnforceUniqueValues="TRUE"') },
        CurrentZone: { type: "Text", xml: text("CurrentZone") },
      },
    },
    [RESPONSES]: {
      // List settings > Advanced: read and edit only your own items
      settings: { ReadSecurity: 2, WriteSecurity: 2 },
      fields: {
        LookupID: { type: "Number", xml: '<Field Type="Number" Name="LookupID" StaticName="LookupID" DisplayName="LookupID" Decimals="0" />' },
        UserName: { type: "Text", xml: text("UserName") },
        UserEmail: { type: "Text", xml: text("UserEmail", 'Indexed="TRUE"') },
        UserDescription: { type: "Text", xml: text("UserDescription") },
        AreaName: { type: "Text", xml: text("AreaName") },
        ZoneSelection: { type: "Text", xml: text("ZoneSelection") },
        PreviousZone: { type: "Text", xml: text("PreviousZone") },
        ZoneChanged: { type: "Boolean", xml: '<Field Type="Boolean" Name="ZoneChanged" StaticName="ZoneChanged" DisplayName="ZoneChanged" />' },
        Attestation: { type: "Text", xml: text("Attestation") },
        AttestationTime: { type: "DateTime", xml: '<Field Type="DateTime" Name="AttestationTime" StaticName="AttestationTime" DisplayName="AttestationTime" Format="DateTime" />' },
      },
    },
    // the error log (config errorLog): one item per failure a user hits; a
    // list rule on it emails the admin (docs/05-deploy-steps.md, step 2b)
    [ERRORS]: {
      settings: { ReadSecurity: 2, WriteSecurity: 2 },
      fields: {
        ErrorKind: { type: "Text", xml: text("ErrorKind") },
        Message: { type: "Note", xml: '<Field Type="Note" Name="Message" StaticName="Message" DisplayName="Message" NumLines="6" RichText="FALSE" />' },
        Detail: { type: "Note", xml: '<Field Type="Note" Name="Detail" StaticName="Detail" DisplayName="Detail" NumLines="10" RichText="FALSE" />' },
        UserEmail: { type: "Text", xml: text("UserEmail") },
        EngineVersion: { type: "Text", xml: text("EngineVersion") },
      },
    },
  };

  // ------------------------------ plumbing -------------------------------
  const ctx = window._spPageContextInfo;
  const origin = new URL(ctx && ctx.webAbsoluteUrl ? ctx.webAbsoluteUrl : document.baseURI).origin;
  const web = origin + SITE.replace(/\/$/, "");
  const J = "application/json;odata=nometadata";
  const tag = DRY_RUN ? "[dry run] would" : "";
  const report = [];
  const note = (what, result) => { report.push({ what, result }); console.log(`${what}: ${result}`); };

  let digest = null;
  async function call(method, path, body, extraHeaders) {
    const headers = Object.assign({ accept: J }, extraHeaders || {});
    if (method !== "GET") {
      if (!digest) {
        const r = await fetch(web + "/_api/contextinfo", { method: "POST", headers: { accept: J } });
        if (!r.ok) throw new Error(`Can't get a request digest for ${web} (HTTP ${r.status}). Is SITE right, and are you an owner there?`);
        digest = (await r.json()).FormDigestValue;
      }
      headers["X-RequestDigest"] = digest;
      if (body !== undefined) headers["content-type"] = J;
    }
    const r = await fetch(web + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 404 && method === "GET") return null;
    if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const merge = (path, body) => call("POST", path, body, { "X-HTTP-Method": "MERGE", "IF-MATCH": "*" });
  const listPath = (title) => `/_api/web/lists/getbytitle('${encodeURIComponent(title.replace(/'/g, "''"))}')`;

  async function allItems(title, select) {
    let next = `${listPath(title)}/items?$select=${select}&$top=500`;
    const out = [];
    while (next) {
      const page = await call("GET", next);
      out.push(...((page && page.value) || []));
      next = page && page["odata.nextLink"] ? page["odata.nextLink"].replace(web, "") : null;
    }
    return out;
  }

  // ------------------------------- checks --------------------------------
  if (MODE !== "setup" && MODE !== "remove-test-data") throw new Error(`MODE must be "setup" or "remove-test-data", not "${MODE}".`);
  const site = await call("GET", "/_api/web?$select=Title,Url");
  if (!site) throw new Error(`No site at ${web}. Check SITE.`);
  console.log(`${DRY_RUN ? "DRY RUN on" : "Working on"} ${site.Url} (${site.Title}), mode: ${MODE}`);

  // ------------------------- remove-test-data mode ------------------------
  if (MODE === "remove-test-data") {
    for (const title of [ASSIGNMENTS, RESPONSES]) {
      if (!(await call("GET", `${listPath(title)}?$select=Id`))) { note(title, "list not found, nothing to remove"); continue; }
      const rows = (await allItems(title, "Id,AreaName")).filter((i) => String(i.AreaName || "").startsWith(TEST_PREFIX));
      for (const row of rows) {
        if (!DRY_RUN) await call("POST", `${listPath(title)}/items(${row.Id})`, undefined, { "X-HTTP-Method": "DELETE", "IF-MATCH": "*" });
        note(`${title} #${row.Id} ${row.AreaName}`, DRY_RUN ? `${tag} delete` : "deleted");
      }
      if (!rows.length) note(title, `no rows starting "${TEST_PREFIX}"`);
    }
    console.table(report);
    console.log(DRY_RUN ? "Dry run only. Set DRY_RUN = false to delete." : "Test data removed.");
    return;
  }

  // ----------------------------- setup mode ------------------------------
  // the lists and their columns
  for (const [title, spec] of Object.entries(LISTS)) {
    let list = await call("GET", `${listPath(title)}?$select=Id`);
    if (list) note(title, "list exists");
    else if (DRY_RUN) note(title, `${tag} create the list`);
    else {
      await call("POST", "/_api/web/lists", { Title: title, BaseTemplate: 100 });
      list = await call("GET", `${listPath(title)}?$select=Id`);
      note(title, "list created");
    }

    const have = list ? ((await call("GET", `${listPath(title)}/fields?$select=InternalName,TypeAsString`)).value) : [];
    for (const [name, f] of Object.entries(spec.fields)) {
      const found = have.find((x) => x.InternalName === name);
      if (found && found.TypeAsString !== f.type) {
        note(`${title}.${name}`, `EXISTS AS ${found.TypeAsString}, expected ${f.type}: fix by hand, the form needs ${f.type}`);
      } else if (found) note(`${title}.${name}`, "column exists");
      else if (DRY_RUN) note(`${title}.${name}`, `${tag} add ${f.type} column`);
      else {
        // 8 = keep this exact internal name; 16 = show it in the default view
        await call("POST", `${listPath(title)}/fields/createfieldasxml`, { parameters: { SchemaXml: f.xml, Options: 8 | 16 } });
        note(`${title}.${name}`, `${f.type} column added`);
      }
    }
    if (spec.titleOptional) {
      if (DRY_RUN) note(`${title}.Title`, `${tag} make optional`);
      else if (list) { await merge(`${listPath(title)}/fields/getbyinternalnameortitle('Title')`, { Required: false }); note(`${title}.Title`, "made optional"); }
    }
    if (spec.settings) {
      if (DRY_RUN) note(`${title} settings`, `${tag} set read/edit to own items only`);
      else if (list) { await merge(listPath(title), spec.settings); note(`${title} settings`, "read/edit set to own items only"); }
    }
  }

  // who "me" is
  let me = null;
  if (Object.values(USERS).includes("me")) {
    me = await call("GET", "/_api/web/currentuser?$select=Title,Email");
    if (!me || !me.Email) throw new Error(`Couldn't read your email from ${web}. Replace "me" in USERS with your address.`);
  }
  const emailOf = (key) => (USERS[key] === "me" ? me.Email : USERS[key]);
  const nameOf = (key) => (USERS[key] === "me" ? me.Title : `Test attester ${key}`);
  for (const [key, email] of Object.entries(USERS)) {
    if (/@example\.com$/i.test(email)) console.warn(`USERS.${key} is still the placeholder ${email}: its rows are created, but nobody can sign in as it.`);
  }

  // the test rows
  const existing = (await call("GET", `${listPath(ASSIGNMENTS)}?$select=Id`)) ? await allItems(ASSIGNMENTS, "Id,AreaName,UserEmail") : [];
  const answered = (await call("GET", `${listPath(RESPONSES)}?$select=Id`)) ? await allItems(RESPONSES, "Id,LookupID") : [];
  for (const row of TEST_ROWS) {
    const area = `${TEST_PREFIX}${row.user} - ${row.area}`;
    const email = row.upperCaseEmail ? emailOf(row.user).toUpperCase() : emailOf(row.user);
    const label = `${area} → ${email}, zone ${row.zone || "(none)"}`;
    let item = existing.find((x) => x.AreaName === area);
    if (item) note(label, "row exists");
    else if (DRY_RUN) note(label, `${tag} add${row.note ? " (" + row.note + ")" : ""}`);
    else {
      // odata=nometadata: SharePoint uses the list's own item type, so no
      // __metadata (and none of PnPjs' cached-type trouble with same-titled lists)
      item = await call("POST", `${listPath(ASSIGNMENTS)}/items`, {
        Title: area, AreaName: area, UserEmail: email,
        UserDescription: `Placeholder test data (attester ${row.user})`, CurrentZone: row.zone,
      });
      note(label, "row added");
    }
    // an already-answered area also gets a response, as if submitted earlier
    if (row.answered) {
      const has = item && answered.some((r) => Number(r.LookupID) === Number(item.Id));
      if (has) note(`${area} response`, "response exists");
      else if (DRY_RUN) note(`${area} response`, `${tag} add a response (zone ${row.zone})`);
      else {
        await call("POST", `${listPath(RESPONSES)}/items`, {
          Title: `${area} — ${email}`, LookupID: item.Id, UserName: nameOf(row.user), UserEmail: email,
          UserDescription: `Placeholder test data (attester ${row.user})`, AreaName: area,
          ZoneSelection: row.zone, PreviousZone: row.zone, ZoneChanged: false,
          Attestation: "Confirmed", AttestationTime: new Date().toISOString(),
        });
        note(`${area} response`, "response added (counts as already answered)");
      }
    }
  }

  console.table(report);
  console.log(DRY_RUN
    ? "Dry run only: nothing was changed. Set DRY_RUN = false and run again."
    : "Done. Now set permissions by hand (docs/05-deploy-steps.md, step 2).");
})().catch((e) => console.error("Setup stopped:", e && e.message ? e.message : e));
