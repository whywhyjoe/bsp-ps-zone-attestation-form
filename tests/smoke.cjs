/*! PS Zone Attestation · tests/smoke.cjs — headless regression suite (dev-only) */
/*
 * Drives the dev harness (the real src/ folder, mock SharePoint) through
 * the attestation lifecycle and asserts the payload/behavior invariants
 * that manual clicking doesn't reliably catch, plus the standalone
 * guarantees: nothing loads from outside src/, every icon resolves, and a
 * shared BSP Forms engine on the page can't take the form over.
 * Ported from bsp-sp-parts/bsp-forms/dev/smoke.spec.js (zone section).
 * The deployed runtime stays buildless — this file never ships.
 *
 * Run (CommonJS on purpose, so NODE_PATH can point at any playwright):
 *   python -m http.server 8646        (from the repo root)
 *   node tests/smoke.cjs [baseUrl]
 *
 * baseUrl defaults to http://localhost:8646/dev/index.html
 * Set CHROMIUM=/path/to/chrome to pin the browser executable.
 */
'use strict';
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:8646/dev/index.html';

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  [' + detail + ']'));
  if (!ok) failures++;
}

async function launch() {
  return chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
}

/* Programmatic nav clicks: pointer-coordinate clicks flake when validation
   messages shift layout mid-click (see docs/00-overview.md). */
async function navClick(page, text) {
  await page.waitForTimeout(150);
  const ok = await page.evaluate((t) => {
    const btns = [...document.querySelectorAll('.psz button')]
      .filter(b => b.textContent.trim().startsWith(t) && b.offsetParent !== null);
    if (!btns.length) return false;
    btns[0].click();
    return true;
  }, text);
  if (!ok) throw new Error('navClick: no visible button "' + text + '"');
}

async function testEditMode(browser) {
  console.log('edit mode:');
  const page = await browser.newPage();
  await page.goto(BASE + '?Mode=Edit');
  await page.waitForTimeout(800);
  check('placeholder note is visible', await page.locator('.psz-editnote').isVisible());
  check('form is not rendered', (await page.locator('.psz').count()) === 0);
  await page.close();
}

/* Zone attestation: assignments rows from the mock source list, per-row
   save, submit confirmation, header card, current user, EN/FR. Mock rows:
   0 Concourse Podium (current High Security), 1 Tower 10 (current Public Plus),
   2 Tower 37 (no current zone: dropdown straight away). */
const ZONE = '?suite=zone'; // the harness ignores it; opts.query appends &flags
const JOB_AID = 'https://example.com/job-aid';
async function openZone(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1600 } });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.route('**/ps-zone-attestation.json', async route => {
    const cfg = await (await route.fetch()).json();
    if (opts.mutate) opts.mutate(cfg);
    await route.fulfill({ json: cfg });
  });
  await page.addInitScript(o => {
    if (o.fail) window.PSZ_MOCK_FAIL = o.fail;
    if (o.done) window.PSZ_MOCK_DONE = o.done;
    if (o.rows) window.PSZ_MOCK_ASSIGNMENTS = o.rows;
    if (o.addMs != null) window.PSZ_MOCK_ADD_MS = o.addMs;
    if (o.keysCap != null) window.PSZ_MOCK_KEYS_CAP = o.keysCap;
  }, { fail: opts.fail || null, done: opts.done || null, rows: opts.rows || null, addMs: opts.addMs == null ? null : opts.addMs,
    keysCap: opts.keysCap == null ? null : opts.keysCap });
  await page.goto(BASE + ZONE + (opts.query || ''));
  await page.waitForTimeout(1200);
  // wait for the assignments load to leave idle/loading; tolerant on purpose:
  // config-error and doctor pages never settle, and the checks after it still fail loudly
  await page.waitForFunction(() => {
    var el = document.querySelector('[data-psz-uid]');
    var d = el && window.Alpine && window.Alpine.$data(el);
    return !d || !d.asg || (d.asg.state !== 'idle' && d.asg.state !== 'loading');
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(100); // let Alpine's next tick paint rows and done screens
  return { ctx, page };
}
// pick a zone by its label; a row showing confirm / change is switched to
// "change" first (that opens its menu)
async function zonePick(page, row, label) {
  await page.evaluate(async ({ row, label }) => {
    const r = document.querySelectorAll('.psz-asg__row')[row];
    const vis = el => el && getComputedStyle(el).display !== 'none';
    if (vis(r.querySelector('.psz-asg__confirm'))) r.querySelector('.psz-asg__confirm button').click();
    else r.querySelector('[role="combobox"]').click();
    await new Promise(x => setTimeout(x, 60));
    [...r.querySelectorAll('.psz-combo__option')].find(b => b.innerText.trim() === label).click();
  }, { row, label });
  await page.waitForTimeout(80);
}
async function zoneConfirm(page, row) {
  await page.locator('.psz-asg__row').nth(row).locator('.psz-asg__confirm input').check();
  await page.waitForTimeout(80);
}
const L = {
  pub: 'Public - General Access', plus: 'Public Plus - Authorized Entry', std: 'Standards - Restricted Operation',
  sec: 'Secure Restricted', high: 'High Security'
};
const zoneAdds = page => page.evaluate(() => window.__PSZ_MOCK_WRITES__.filter(w => w.op === 'addItem').map(w => w.payload));

async function testZoneAttestation(browser) {
  console.log('zone attestation (assignments):');
  let { ctx, page } = await openZone(browser, { query: '&validate' });

  // load: the user's rows only (case-insensitive email), sorted by area
  const labels = await page.$$eval('.psz-asg__label', els => els.map(e => e.textContent));
  check('3 rows, the other user\'s row filtered out, sorted',
    JSON.stringify(labels) === JSON.stringify(['FCP - Concourse Podium', 'FCP - Tower 10', 'FCP - Tower 37']), JSON.stringify(labels));
  check('current user card shows name + email',
    (await page.locator('.psz-who__name').textContent()) === 'Dev Tester' &&
    (await page.locator('.psz-who__mail').textContent()) === 'dev.tester@example.com');
  // the job aid moved to the resources panel (1.1.0): no header card, and
  // the intro takes the whole header width
  const head = await page.evaluate(() => {
    const intro = document.querySelector('.psz__intro'), headEl = document.querySelector('.psz__head');
    return { cards: document.querySelectorAll('[data-psz-form] .psz-tipcard').length, maxW: getComputedStyle(intro).maxWidth,
      introW: intro.getBoundingClientRect().width, headW: headEl.getBoundingClientRect().width };
  });
  check('no job aid card on the form; the intro spans the header',
    head.cards === 0 && head.maxW === 'none' && head.introW > head.headW * 0.8, JSON.stringify(head));
  await page.waitForFunction(() => document.querySelector('.psz-doctor tbody tr'), null, { timeout: 15000 });
  const doctor = await page.$$eval('.psz-doctor tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.innerText.trim())));
  check('doctor: every target + source column OK', doctor.length >= 12 && doctor.every(r => r[4] === 'OK'),
    doctor.filter(r => r[4] !== 'OK').map(r => r.join('|')).join('; '));

  // empty submit: every row + the checkbox flagged, no dialog, nothing saved
  await navClick(page, 'Submit attestation');
  await page.waitForTimeout(200);
  check('empty submit → an error on every row', (await page.locator('.psz-asg__row.is-error').count()) === 3);
  const rowErrs = await page.$$eval('.psz-asg__row .psz-asg__foot > .field__error', ps => ps.map(p => p.textContent));
  check('row errors: "confirm or choose" where there is a current zone, "choose" where there is none',
    JSON.stringify(rowErrs) === JSON.stringify(['Confirm this zone or choose a new one.', 'Confirm this zone or choose a new one.', 'Choose a zone for this area.']),
    JSON.stringify(rowErrs));
  check('empty submit → checkbox error', await page.locator('[data-psz-field="attestation"] .field__error').isVisible());
  check('empty submit → no dialog, nothing saved', !(await page.locator('.psz-dialog').isVisible()) && (await zoneAdds(page)).length === 0);

  // pick, clear, re-pick; the progress meter follows
  await zonePick(page, 0, L.plus);
  check('a pick clears that row\'s error', (await page.locator('.psz-asg__row.is-error').count()) === 2);
  await page.locator('.psz-asg__row').nth(0).locator('.psz-combo__clear').click();
  await page.waitForTimeout(80);
  check('the × clears the selection', (await page.locator('.psz-asg__row').nth(0).locator('.psz-combo__placeholder:visible').textContent()) === 'Select a new zone');
  await zonePick(page, 0, L.sec);
  await page.evaluate(async () => {
    const r = document.querySelectorAll('.psz-asg__row')[0];
    r.querySelector('[role="combobox"]').click();
    await new Promise(x => setTimeout(x, 60));
    r.querySelector('.psz-combo__option--clear').click();
  });
  await page.waitForTimeout(80);
  check('the menu\'s "Clear selection" clears it too',
    await page.evaluate(() => { const d = Object.values(PSZoneForm._defs).pop(); return d.store.state.values.zones[0].value === ''; }));
  await zonePick(page, 0, L.sec);
  await zonePick(page, 1, L.pub);
  await zonePick(page, 2, L.high);
  check('progress reads 3 of 3', /3 of 3/.test(await page.locator('.psz-asg__progress').textContent()));
  await page.locator('[data-psz-field="attestation"] input').check();

  // confirmation: Escape goes back; Confirm saves one item per row
  await navClick(page, 'Submit attestation');
  await page.waitForTimeout(250);
  check('submit → confirmation dialog with the warning text',
    await page.locator('.psz-dialog').isVisible() && /will not be able to return and change them/.test(await page.locator('.psz-dialog').textContent()));
  check('focus starts on "Go back"', (await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim())) === 'Go back');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape → dialog closed, nothing saved', !(await page.locator('.psz-dialog').isVisible()) && (await zoneAdds(page)).length === 0);
  await navClick(page, 'Submit attestation');
  await page.waitForTimeout(250);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 15000 });
  const adds = await zoneAdds(page);
  const byId = Object.fromEntries(adds.map(p => [p.LookupID, p]));
  check('one item per row', adds.length === 3, adds.length);
  check('row columns copied (LookupID / AreaName / UserDescription)',
    byId[12] && byId[12].AreaName === 'FCP - Concourse Podium' && byId[12].UserDescription === 'Branch manager' && typeof byId[12].LookupID === 'number');
  check('each row saves its own zone', byId[12].ZoneSelection === 'Secure Restricted' && byId[11].ZoneSelection === 'Public' && byId[13].ZoneSelection === 'High Security');
  check('changed rows: PreviousZone = the current zone, ZoneChanged = true',
    byId[12].PreviousZone === 'High Security' && byId[12].ZoneChanged === true &&
    byId[11].PreviousZone === 'Public Plus' && byId[11].ZoneChanged === true);
  check('a row with no current zone: no PreviousZone, ZoneChanged = true',
    !('PreviousZone' in byId[13]) && byId[13].ZoneChanged === true, JSON.stringify(byId[13]));
  check('UserName / UserEmail / Attestation set on every row',
    adds.every(p => p.UserName === 'Dev Tester' && p.UserEmail === 'dev.tester@example.com' && p.Attestation === 'Confirmed'));
  check('AttestationTime: one ISO instant shared by the rows',
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(adds[0].AttestationTime) && adds.every(p => p.AttestationTime === adds[0].AttestationTime));
  check('Title per row from {row:AreaName}', byId[13].Title === 'FCP - Tower 37 — dev.tester@example.com', byId[13].Title);
  check('no "submit another" button', (await page.locator('.psz-done button').count()) === 0);
  check('no page errors', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // confirm / change / keep: a row with a current zone
  ({ ctx, page } = await openZone(browser));
  const row0 = page.locator('.psz-asg__row').nth(0);
  check('a current zone shows its name, description, confirm + Change; no dropdown',
    (await row0.locator('.psz-asg__eyebrow:visible').textContent()) === 'Current zone' &&
    (await row0.locator('.psz-asg__zone:visible').textContent()) === L.high &&
    /^\[Placeholder\] Critical assets such as vaults/.test(await row0.locator('.psz-asg__desc:visible').textContent()) &&
    await row0.locator('.psz-asg__confirm input').isVisible() && await row0.locator('.psz-asg__confirm button').isVisible() &&
    await row0.locator('.psz-asg__pick').isHidden());
  check('the card wears its current zone\'s hue, the row with no current zone none',
    /psz-asg__row--red/.test(await row0.getAttribute('class')) &&
    !/has-hue/.test(await page.locator('.psz-asg__row').nth(2).getAttribute('class')));
  check('no current zone → the dropdown straight away, no Keep',
    await page.locator('.psz-asg__row').nth(2).locator('.psz-asg__pick').isVisible() &&
    await page.locator('.psz-asg__row').nth(2).locator('.psz-asg__keep').isHidden());
  await zoneConfirm(page, 0);
  const zst = () => page.evaluate(() => Object.values(PSZoneForm._defs).pop().store.state.values.zones.map(r => [r.mode, r.value, r.open]));
  check('confirm → the row\'s answer is its current zone, status "Confirmed"',
    JSON.stringify((await zst())[0]) === '["confirm","High Security",false]' &&
    (await row0.locator('.psz-asg__status').textContent()).trim() === 'Confirmed');
  await row0.locator('.psz-asg__confirm button').click();
  await page.waitForTimeout(120);
  check('Change → unconfirms, opens the dropdown, focus in it, Change gone',
    JSON.stringify((await zst())[0]) === '["change","",true]' &&
    await row0.locator('.psz-combo__menu').isVisible() && await row0.locator('.psz-asg__confirm').isHidden() &&
    (await page.evaluate(() => document.activeElement.getAttribute('role'))) === 'combobox');
  const offered = await row0.locator('.psz-combo__option:visible').allTextContents();
  check('the dropdown leaves the current zone out', offered.map(t => t.trim()).join('|') === [L.pub, L.plus, L.std, L.sec].join('|'), offered.join('|'));
  await row0.locator('.psz-combo__option', { hasText: L.std }).click();
  await page.waitForTimeout(100);
  check('a new zone → the current one greys out, the new one + its description show, status "Changed"',
    (await row0.locator('.psz-asg__zone.is-replaced:visible').textContent()) === L.high &&
    (await row0.locator('.psz-asg__zone:not(.is-replaced):visible').textContent()) === L.std &&
    (await row0.locator('.psz-asg__desc:visible').count()) === 1 &&
    /psz-asg__row--berry/.test(await row0.getAttribute('class')) &&
    (await row0.locator('.psz-asg__status').textContent()).trim() === 'Changed');
  await row0.locator('.psz-asg__keep').click();
  await page.waitForTimeout(120);
  check('Keep current zone → back to unconfirmed confirm / change, focus on Change',
    JSON.stringify((await zst())[0]) === '["confirm","",false]' &&
    !(await row0.locator('.psz-asg__confirm input').isChecked()) && await row0.locator('.psz-asg__pick').isHidden() &&
    (await row0.locator('.psz-asg__zone.is-replaced:visible').count()) === 0 &&
    (await page.evaluate(() => document.activeElement.textContent.trim())) === 'Change zone');
  // validation focus: rows 0-1 answered, row 1 switched to "change" and left empty,
  // row 2 (pick) empty → focus lands on row 1's visible dropdown, and only visible
  // controls carry aria-invalid
  await zoneConfirm(page, 0);
  await page.locator('.psz-asg__row').nth(1).locator('.psz-asg__confirm button').click();
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape');
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation');
  await page.waitForTimeout(300);
  const inv = await page.evaluate(() => {
    const vis = el => !!el.offsetParent;
    const all = [...document.querySelectorAll('[data-psz-field="zones"] [aria-invalid="true"]')];
    const a = document.activeElement;
    return { n: all.length, allVisible: all.every(vis), activeRole: a && a.getAttribute('role'),
      activeRow: [...document.querySelectorAll('.psz-asg__row')].findIndex(r => r.contains(a)) };
  });
  check('validation: focus on the first unanswered row\'s visible dropdown; aria-invalid only on visible controls',
    inv.n === 2 && inv.allVisible && inv.activeRole === 'combobox' && inv.activeRow === 1, JSON.stringify(inv));
  await page.locator('.psz-asg__row').nth(1).locator('.psz-asg__keep').click();
  await page.waitForTimeout(80);
  await zoneConfirm(page, 1); await zonePick(page, 2, L.sec);
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(250);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 15000 });
  const cAdds = Object.fromEntries((await zoneAdds(page)).map(p => [p.LookupID, p]));
  check('confirmed rows save the current zone, PreviousZone = it, ZoneChanged = false',
    cAdds[12].ZoneSelection === 'High Security' && cAdds[12].PreviousZone === 'High Security' && cAdds[12].ZoneChanged === false &&
    cAdds[11].ZoneSelection === 'Public Plus' && cAdds[11].PreviousZone === 'Public Plus' && cAdds[11].ZoneChanged === false,
    JSON.stringify([cAdds[12], cAdds[11]]));
  check('no page errors (confirm / change)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
  // previousColumn named Title wins over target.titleTemplate (it isn't overwritten)
  ({ ctx, page } = await openZone(browser, { mutate: cfg => { cfg.pages[0].sections[1].fields[0].previousColumn = 'Title'; } }));
  await zoneConfirm(page, 0); await zoneConfirm(page, 1); await zonePick(page, 2, L.sec);
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(250);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 15000 });
  const tAdds = Object.fromEntries((await zoneAdds(page)).map(p => [p.LookupID, p]));
  check('previousColumn = Title keeps the previous zone; a row with none falls back to titleTemplate',
    tAdds[12].Title === 'High Security' && tAdds[13].Title === 'FCP - Tower 37 — dev.tester@example.com',
    JSON.stringify([tAdds[12].Title, tAdds[13].Title]));
  await ctx.close();
  // a CurrentZone that isn't a choice value → treated as none
  ({ ctx, page } = await openZone(browser, {
    rows: [{ ID: 31, UserEmail: 'dev.tester@example.com', UserDescription: 'x', AreaName: 'Old wing', CurrentZone: 'Green' }]
  }));
  check('unknown CurrentZone → no current zone, the dropdown straight away',
    await page.locator('.psz-asg__row .psz-asg__pick').isVisible() && await page.locator('.psz-asg__row .psz-asg__confirm').isHidden());
  await ctx.close();

  // a failure mid-save: saved rows are kept and never saved twice
  ({ ctx, page } = await openZone(browser, { fail: { addItemAfter: 1 } }));
  await zonePick(page, 0, L.pub); await zonePick(page, 1, L.pub); await zonePick(page, 2, L.plus);
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz__pageerror', { state: 'visible', timeout: 15000 });
  check('partial save → "1 of 3 areas are confirmed saved" message', /1 of 3 areas are confirmed saved/.test(await page.locator('.psz__pageerror').textContent()));
  check('the saved row is locked', (await page.locator('.psz-asg__row.is-saved').count()) === 1 &&
    (await page.locator('.psz-asg__row.is-saved .psz-combo__clear').isHidden()) &&
    (await page.locator('.psz-asg__row.is-saved .psz-asg__keep').isHidden()) &&
    (await page.locator('.psz-asg__row.is-saved .psz-asg__status').textContent()).trim() === 'Saved');
  await page.evaluate(() => { window.PSZ_MOCK_FAIL = {}; });
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 15000 });
  const ids = (await zoneAdds(page)).map(p => p.LookupID).sort();
  check('retry saves only the rest — 3 items, no duplicates', JSON.stringify(ids) === '[11,12,13]', JSON.stringify(ids));
  await ctx.close();

  // rows already answered (responses list) aren't shown again
  ({ ctx, page } = await openZone(browser, { done: ['12'] }));
  check('one row already submitted → 2 rows + a note', (await page.locator('.psz-asg__row').count()) === 2 &&
    /1 of your areas were already attested/.test(await page.locator('[data-psz-field="zones"]').textContent()));
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { done: ['11', '12', '13'] }));
  check('everything submitted → "already submitted" screen, no form',
    await page.locator('.psz-done--allDone').isVisible() && !(await page.locator('form.psz__body').isVisible()));
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { rows: [] }));
  check('nothing assigned → "No areas assigned" screen', await page.locator('.psz-done--empty:has-text("No areas assigned")').isVisible());
  await ctx.close();

  // load failure: a message + Try again, and submit is blocked meanwhile
  ({ ctx, page } = await openZone(browser, { fail: { getAssignments: true } }));
  check('load failure → message + Try again', await page.locator('[data-psz-field="zones"] .msgbar--danger:has-text("couldn\'t be loaded")').isVisible());
  await page.evaluate(() => { window.PSZ_MOCK_FAIL = {}; });
  await page.locator('[data-psz-field="zones"] .msgbar button').click();
  await page.waitForTimeout(800);
  check('Try again → rows load', (await page.locator('.psz-asg__row').count()) === 3);
  await ctx.close();

  // French: config pairs + engine strings; switching keeps answers; values stay English
  ({ ctx, page } = await openZone(browser, { query: '&lang=fr' }));
  check('?lang=fr → French title, labels, button',
    (await page.locator('.psz__title').textContent()) === 'Attestation des zones de sécurité physique' &&
    (await page.locator('.psz-asg__row').nth(0).locator('.psz-asg__eyebrow:visible').textContent()) === 'Zone actuelle' &&
    (await page.locator('.psz-asg__row').nth(0).locator('.psz-asg__zone:visible').textContent()) === 'Haute sécurité' &&
    (await page.locator('.psz-asg__row').nth(0).locator('.psz-asg__confirm').textContent()).includes('Je confirme que c\'est la bonne zone') &&
    await page.locator('button[type="submit"]:has-text("Soumettre l\'attestation")').isVisible());
  check('form root lang="fr" (lang-keep)', (await page.getAttribute('.psz', 'lang')) === 'fr' &&
    (await page.getAttribute('.psz', 'class')).includes('lang-keep'));
  await zonePick(page, 0, 'Public - Accès général');
  await page.evaluate(() => window.intl.setLang('en'));
  await page.waitForTimeout(500);
  check('switch to EN keeps the change (Accès général → General Access, still "change")',
    (await page.locator('.psz-asg__row').nth(0).locator('.psz-zone:visible').textContent()).trim() === L.pub &&
    (await page.locator('.psz-asg__row').nth(0).locator('.psz-asg__zone.is-replaced:visible').textContent()) === L.high &&
    await page.locator('.psz-asg__row').nth(0).locator('.psz-asg__keep').isVisible() &&
    (await page.locator('.psz__title').textContent()) === 'Physical Security Zones Attestation');
  await page.evaluate(() => window.intl.setLang('fr'));
  await page.waitForTimeout(500);
  await zonePick(page, 1, 'Normes - Fonctionnement restreint'); await zonePick(page, 2, 'Haute sécurité');
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Soumettre'); await page.waitForTimeout(200);
  check('French confirmation dialog', /Une fois soumises/.test(await page.locator('.psz-dialog').textContent()));
  await navClick(page, 'Confirmer');
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 15000 });
  const frZones = (await zoneAdds(page)).map(p => p.ZoneSelection).sort();
  check('French submit saves English zone values', JSON.stringify(frZones) === '["High Security","Public","Standards"]', JSON.stringify(frZones));
  check('no page errors (French)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // answers are frozen once confirmed: a slow save, edits attempted mid-save
  ({ ctx, page } = await openZone(browser, { addMs: 900 }));
  await zonePick(page, 0, L.sec); await zonePick(page, 1, L.pub); await zonePick(page, 2, L.high);
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForTimeout(250); // row 1 is saving
  const mid = await page.evaluate(() => {
    const st = Object.values(PSZoneForm._defs).pop().store.state;
    const r3 = document.querySelectorAll('.psz-asg__row')[2];
    const clear = r3.querySelector('.psz-combo__clear');
    if (clear) clear.click();                       // UI path: guarded
    st.rowPick('zones', st.values.zones[2], '');    // method path: guarded
    st.rowKeep('zones', st.values.zones[0]);        // guarded too
    st.rowChange('zones', st.values.zones[0]);
    const cb = document.querySelector('[data-psz-field="attestation"] input');
    const cbDisabled = cb.matches(':disabled'); cb.click(); // disabled via the fieldset: ignores the click
    const busy = st.busy;
    st.values.zones[1].value = '';                  // bypass every guard: the snapshot must win
    st.values.attestation = false;
    return { busy, cbDisabled, fieldset: document.querySelector('fieldset.psz__lock').disabled, r3: st.values.zones[2].value,
      r1: [st.values.zones[0].mode, st.values.zones[0].value] };
  });
  check('mid-save: busy, fieldset + checkbox disabled', mid.busy && mid.fieldset && mid.cbDisabled, JSON.stringify(mid));
  check('mid-save: clearing a row is refused', mid.r3 === 'High Security', mid.r3);
  check('mid-save: keep / change are refused', JSON.stringify(mid.r1) === '["change","Secure Restricted"]', JSON.stringify(mid.r1));
  // the saving overlay: a full-page scrim with a spinner and a don't-leave
  // message, focused; leaving the page asks first
  const leaveGuard = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  const scrim = await page.evaluate(() => {
    const s = document.querySelector('.psz-saving'), r = s.getBoundingClientRect();
    return { shown: getComputedStyle(s).display !== 'none', covers: r.top <= 0 && r.left <= 0 && r.bottom >= innerHeight - 1 && r.right >= innerWidth - 20,
      text: s.textContent, spinner: !!s.querySelector('.spinner'), focused: document.activeElement === s.querySelector('.psz-saving__card') };
  });
  check('mid-save: a full-page scrim with a spinner says "Submitting your attestation…" and not to leave; it has focus',
    scrim.shown && scrim.covers && scrim.spinner && /Submitting your attestation…/.test(scrim.text) && /Don’t close this page, refresh it or go back/.test(scrim.text) && scrim.focused,
    JSON.stringify(scrim));
  check('mid-save: leaving the page asks first (beforeunload)', await leaveGuard());
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 8000 });
  check('saved: the scrim is gone and leaving no longer asks',
    (await page.evaluate(() => getComputedStyle(document.querySelector('.psz-saving')).display === 'none')) && !(await leaveGuard()));
  let saved = await zoneAdds(page);
  const zb = Object.fromEntries(saved.map(p => [p.LookupID, p]));
  check('saved what was confirmed, not what changed mid-save',
    saved.length === 3 && zb[12].ZoneSelection === 'Secure Restricted' && zb[11].ZoneSelection === 'Public' && zb[13].ZoneSelection === 'High Security' &&
    saved.every(p => p.Attestation === 'Confirmed'), JSON.stringify(saved.map(p => [p.LookupID, p.ZoneSelection, p.Attestation])));
  await ctx.close();

  // an add that LANDS but whose reply is lost: the retry checks the list first
  ({ ctx, page } = await openZone(browser, { fail: { addItemLostAfter: 1 } }));
  await zonePick(page, 0, L.pub); await zonePick(page, 1, L.std); await zonePick(page, 2, L.high);
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz__pageerror', { state: 'visible', timeout: 15000 });
  check('lost reply → "1 of 3 areas are confirmed saved" (the rest only "may not be")',
    /1 of 3 areas are confirmed saved; the rest may not be/.test(await page.locator('.psz__pageerror').textContent()));
  await page.evaluate(() => { window.PSZ_MOCK_FAIL = {}; });
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 15000 });
  const lostWrites = await page.evaluate(() => window.__PSZ_MOCK_WRITES__);
  const lostIds = lostWrites.filter(w => w.op === 'addItem').map(w => w.payload.LookupID).sort();
  check('retry asked the list about exactly the unsaved rows first',
    JSON.stringify((lostWrites.find(w => w.op === 'getRowKeysFor') || {}).values) === '[11,13]',
    JSON.stringify(lostWrites.filter(w => w.op === 'getRowKeysFor')));
  check('the landed-but-lost row is not saved again — 3 items, no duplicates', JSON.stringify(lostIds) === '[11,12,13]', JSON.stringify(lostIds));
  await ctx.close();
  // the same, with the earlier-responses read capped at 0: the retry's exact
  // check must still find the landed row (the cap doesn't apply to it)
  ({ ctx, page } = await openZone(browser, { fail: { addItemLostAfter: 1 }, keysCap: 0 }));
  await zonePick(page, 0, L.pub); await zonePick(page, 1, L.std); await zonePick(page, 2, L.high);
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz__pageerror', { state: 'visible', timeout: 15000 });
  await page.evaluate(() => { window.PSZ_MOCK_FAIL = {}; });
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 15000 });
  const capIds = (await zoneAdds(page)).map(p => p.LookupID).sort();
  check('capped earlier-responses read: retry still saves no duplicate', JSON.stringify(capIds) === '[11,12,13]', JSON.stringify(capIds));
  await ctx.close();
  // lost on the very first add: no "nothing was saved" promise
  ({ ctx, page } = await openZone(browser, { fail: { addItemLostAfter: 0 } }));
  await zonePick(page, 0, L.pub); await zonePick(page, 1, L.pub); await zonePick(page, 2, L.pub);
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz__pageerror', { state: 'visible', timeout: 15000 });
  const firstLost = await page.locator('.psz__pageerror').textContent();
  check('first add lost → "Not every area could be saved", never "nothing was saved"',
    /Not every area could be saved/.test(firstLost) && !/nothing was saved/.test(firstLost), firstLost);
  await ctx.close();

  // hostile text in list data and in a choice: shown literally, saved exactly, never run
  const EVIL_AREA = '<img src=x onerror="window.__xss=1">Lobby & "vault"';
  const EVIL_ZONE = 'O"Brien\'s <b>zone</b> {{x}}';
  ({ ctx, page } = await openZone(browser, {
    rows: [{ ID: 21, UserEmail: 'dev.tester@example.com', UserDescription: '<script>window.__xss=2</script>', AreaName: EVIL_AREA }],
    mutate: cfg => { cfg.pages[0].sections[1].fields[0].choices.push({ value: EVIL_ZONE, label: EVIL_ZONE, color: 'blue' }); }
  }));
  check('hostile area name shown as text', (await page.locator('.psz-asg__label').textContent()) === EVIL_AREA);
  await zonePick(page, 0, EVIL_ZONE);
  check('hostile choice shown as text in the control', (await page.locator('.psz-asg__row .psz-zone:visible').textContent()).trim() === EVIL_ZONE);
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz-done:not(.psz-done--empty):not(.psz-done--allDone)', { state: 'visible', timeout: 15000 });
  saved = await zoneAdds(page);
  check('hostile values saved exactly', saved.length === 1 && saved[0].ZoneSelection === EVIL_ZONE && saved[0].AreaName === EVIL_AREA &&
    saved[0].UserDescription === '<script>window.__xss=2</script>');
  check('no script ran, no page errors', (await page.evaluate(() => window.__xss)) === undefined && page.__errors.length === 0,
    page.__errors.join(' | '));
  await ctx.close();

  // cut-off reads are said out loud
  ({ ctx, page } = await openZone(browser, { mutate: cfg => { cfg.pages[0].sections[1].fields[0].source.top = 2; } }));
  check('more rows than source.top → 2 rows + "Only the first 2" warning',
    (await page.locator('.psz-asg__row').count()) === 2 && await page.locator('.psz-asg__warn:has-text("Only the first 2")').isVisible());
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { done: ['12', '11'], mutate: cfg => { cfg.pages[0].sections[1].fields[0].source.top = 2; } }));
  check('first page all done but more exist → a warning, not "already submitted"',
    !(await page.locator('.psz-done--allDone').isVisible()) &&
    await page.locator('[data-psz-field="zones"] .msgbar--danger:has-text("Only the first 2")').isVisible());
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { done: ['12'], keysCap: 0 }));
  check('earlier-responses read cut off → warning; unconfirmed rows still shown',
    (await page.locator('.psz-asg__row').count()) === 3 && await page.locator('.psz-asg__warn:has-text("More than 5000 earlier responses")').isVisible());
  await ctx.close();
  ({ ctx, page } = await openZone(browser, { done: ['11', '12', '13', '99'], keysCap: 3 }));
  check('every row done but the responses read was cut off → a warning, not "already submitted"',
    !(await page.locator('.psz-done--allDone').isVisible()) &&
    await page.locator('[data-psz-field="zones"] .msgbar--danger:has-text("More than 5000 earlier responses")').isVisible());
  await ctx.close();

  // config errors
  for (const [name, mutate] of [
    ['assignments without source.userColumn → error card', cfg => { delete cfg.pages[0].sections[1].fields[0].source.userColumn; }],
    ['responses.keyColumn not in rowColumns → error card', cfg => { cfg.pages[0].sections[1].fields[0].responses.keyColumn = 'Nope'; }],
    ['two assignments fields → error card', cfg => {
      const f = JSON.parse(JSON.stringify(cfg.pages[0].sections[1].fields[0])); f.id = 'zones2';
      cfg.pages[0].sections[1].fields.push(f);
    }],
    ['form.languages ["de"] → error card', cfg => { cfg.form.languages = ['de']; }],
    ['previousColumn without source.currentColumn → error card', cfg => { delete cfg.pages[0].sections[1].fields[0].source.currentColumn; }],
    ['previousColumn = column → error card', cfg => { cfg.pages[0].sections[1].fields[0].previousColumn = 'ZoneSelection'; }],
    ['changedColumn = a rowColumns target → error card', cfg => { cfg.pages[0].sections[1].fields[0].changedColumn = 'AreaName'; }]
  ]) {
    ({ ctx, page } = await openZone(browser, { mutate }));
    const state = await page.getAttribute('[data-psz-form]', 'data-psz-state');
    check(name, state === 'error' && await page.locator('[data-psz-fatal]').isVisible(), 'state=' + state);
    await ctx.close();
  }
}

/* Error reporting: a failure the user hits writes one item to the errorLog
   list (a SharePoint list rule there emails the admin) and shows a mailto
   link to errorContact with a subject and the diagnostic lines. */
const logWrites = page => page.evaluate(() => window.__PSZ_MOCK_WRITES__.filter(w => w.op === 'logError'));
function parseMail(href) {
  if (!href) return null;
  const m = /^mailto:([^?]+)\?subject=([^&]*)&body=(.*)$/.exec(href);
  return m ? { to: m[1], subject: decodeURIComponent(m[2]), body: decodeURIComponent(m[3]) } : { bad: href };
}
async function testErrorReporting(browser) {
  console.log('error reporting:');
  const mailIn = (page, sel) => page.evaluate(s => { const a = document.querySelector(s); return a && a.offsetParent !== null ? a.getAttribute('href') : null; }, sel);

  // a failed load: one list item, and the email link in the error bar
  let { ctx, page } = await openZone(browser, { fail: { getAssignments: true } });
  const ver = await page.evaluate(() => window.PSZoneForm.version);
  let logs = await logWrites(page);
  check('failed load → one error-log item (list, kind, title, message, user, version)',
    logs.length === 1 && logs[0].list === 'PS_Zone-Attestation-Errors' && logs[0].item.ErrorKind === 'load' &&
    /^\[load\] mock getAssignments failure/.test(logs[0].item.Title) && /getAssignments/.test(logs[0].item.Message) &&
    logs[0].item.UserEmail === 'dev.tester@example.com' && logs[0].item.EngineVersion === ver, JSON.stringify(logs));
  check('…its Detail carries the diagnostics (engine, page, browser, list)',
    logs[0].item.Detail.includes('engine: ' + ver) && /page: http/.test(logs[0].item.Detail) &&
    /browser: /.test(logs[0].item.Detail) && /list: PS_Zone-Attestation-Assignments/.test(logs[0].item.Detail), logs[0].item.Detail);
  let mail = parseMail(await mailIn(page, '[data-psz-field="zones"] .psz-errmail'));
  check('failed load → mailto link to the contact, with the configured subject',
    mail && mail.to === 'form.admin@example.com' && mail.subject === 'PS Zone Attestation: problem report', JSON.stringify(mail));
  check('…and a body asking what happened, then the diagnostics',
    /^What were you doing/.test(mail.body) && /error: load: mock getAssignments failure/.test(mail.body) &&
    /user: dev\.tester@example\.com/.test(mail.body) && mail.body.includes('engine: ' + ver + ' (en)') && mail.body.length < 1600, mail.body);
  await page.locator('[data-psz-field="zones"] .msgbar button').click();   // Try again, still failing
  await page.waitForTimeout(900);
  check('failing again → no second report of the same kind; link still offered',
    (await logWrites(page)).length === 1 && !!(await mailIn(page, '[data-psz-field="zones"] .psz-errmail')));
  check('no page errors (error reporting, load)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // a failed save: a report and the link in the page error; a validation
  // message in the same bar never carries the link
  ({ ctx, page } = await openZone(browser, { fail: { addItem: true } }));
  await zonePick(page, 0, L.pub); await zonePick(page, 1, L.pub); await zonePick(page, 2, L.plus);
  await page.locator('[data-psz-field="attestation"] input').check();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(200);
  await navClick(page, 'Confirm');
  await page.waitForSelector('.psz__pageerror', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(300);
  logs = await logWrites(page);
  mail = parseMail(await mailIn(page, '.psz__pageerror .psz-errmail'));
  check('failed save → a "save" report, rows saved in the detail',
    logs.length === 1 && logs[0].item.ErrorKind === 'save' && /rows saved: 0 of 3/.test(logs[0].item.Detail), JSON.stringify(logs.map(l => l.item.Detail)));
  check('failed save → the page error offers the email link', !!mail && /error: save: /.test(mail.body), JSON.stringify(mail));
  await page.locator('[data-psz-field="attestation"] input').uncheck();
  await navClick(page, 'Submit attestation'); await page.waitForTimeout(250);
  check('a validation message in the same bar → no email link',
    await page.locator('.psz__pageerror').isVisible() && !(await mailIn(page, '.psz__pageerror .psz-errmail')));
  await ctx.close();

  // a start-up failure (here a bad config): the error card has the link, and it's reported
  ({ ctx, page } = await openZone(browser, { mutate: cfg => { cfg.form.languages = ['de']; } }));
  logs = await logWrites(page);
  mail = parseMail(await mailIn(page, '[data-psz-fatal] .psz-errmail'));
  check('start-up failure → "init" report + email link on the error card',
    logs.length === 1 && logs[0].item.ErrorKind === 'init' && !!mail && /error: init: /.test(mail.body), JSON.stringify([logs.length, mail]));
  await ctx.close();

  // French: link text and subject follow the language
  ({ ctx, page } = await openZone(browser, { fail: { getAssignments: true }, query: '&lang=fr' }));
  mail = parseMail(await mailIn(page, '[data-psz-field="zones"] .psz-errmail'));
  check('French: link text, subject and body in French',
    (await page.locator('[data-psz-field="zones"] .psz-errmail').textContent()).startsWith('Envoyer un courriel') &&
    /^Attestation des zones/.test(mail.subject) && /^Que faisiez-vous/.test(mail.body) && /\(fr\)/.test(mail.body), JSON.stringify(mail));
  await ctx.close();

  // a report that itself fails never breaks the form
  ({ ctx, page } = await openZone(browser, { fail: { getAssignments: true, logError: true } }));
  check('error-log write fails → the error and link still show, no page errors',
    await page.locator('[data-psz-field="zones"] .msgbar--danger').isVisible() &&
    !!(await mailIn(page, '[data-psz-field="zones"] .psz-errmail')) && page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // neither configured: no report, no link
  ({ ctx, page } = await openZone(browser, { fail: { getAssignments: true }, mutate: cfg => { delete cfg.errorLog; delete cfg.errorContact; } }));
  check('no errorLog / errorContact → no report, no link',
    (await logWrites(page)).length === 0 && !(await mailIn(page, '[data-psz-field="zones"] .psz-errmail')));
  await ctx.close();

  // config errors
  for (const [name, mutate] of [
    ['errorLog without listTitle → error card', cfg => { delete cfg.errorLog.listTitle; }],
    ['errorContact with a bad email → error card', cfg => { cfg.errorContact.email = 'not an address'; }]
  ]) {
    ({ ctx, page } = await openZone(browser, { mutate }));
    const state = await page.getAttribute('[data-psz-form]', 'data-psz-state');
    check(name, state === 'error' && await page.locator('[data-psz-fatal]').isVisible(), 'state=' + state);
    await ctx.close();
  }
}

/* The standalone guarantees: the form runs from its own folder and
   nothing else. SRC is the deploy folder as the harness serves it. */
const SRC = new URL('../src/', BASE).href;
// the whole-page harness: the form and the resources panel, two web parts
const PAGE = new URL('page.html', BASE).href;
// the only non-src/ files a run may load: the harness pages and their mock
const HARNESS_FILES = [new URL(BASE).origin + new URL(BASE).pathname, PAGE, new URL('mock-sp.js', BASE).href];
const inBounds = u => u.startsWith(SRC) || HARNESS_FILES.includes(u.split(/[?#]/)[0]) || /^(data|about|blob):/.test(u);
const FIXTURE = new URL('../tests/fixtures/bsp-forms-0.5.1/', BASE).href;
async function testStandalone(browser) {
  console.log('standalone:');
  // everything the whole page (form + resources panel) loads comes from
  // src/ or the harness; French + a job aid URL, so intl.js and the card
  // icon load too
  let { ctx, page } = await (async () => {
    const c = await browser.newContext({ viewport: { width: 1400, height: 1600 } });
    const p = await c.newPage();
    p.__errors = [];
    p.on('pageerror', e => p.__errors.push(e.message));
    p.__urls = [];
    p.on('request', r => p.__urls.push(r.url()));
    await p.route('**/ps-zone-attestation.resources.json', async route => {
      const cfg = await (await route.fetch()).json();
      cfg.sections[0].items[0].url = JOB_AID;
      await route.fulfill({ json: cfg });
    });
    await p.goto(PAGE + '?lang=fr');
    await p.waitForSelector('.psz-asg__row', { timeout: 8000 });
    await p.waitForSelector('[data-psz-resources][data-psz-state="ready"]', { timeout: 8000 });
    await p.waitForTimeout(600);
    return { ctx: c, page: p };
  })();
  const outside = page.__urls.filter(u => !inBounds(u));
  check('every request stays inside src/ (beyond the harness page + mock)', outside.length === 0, outside.join(' '));
  const loaded = new Set(page.__urls.filter(u => u.startsWith(SRC)).map(u => u.slice(SRC.length).split('?')[0]));
  const expected = ['ps-zone-attestation.js', 'ps-zone-attestation.css', 'ps-zone-attestation.json',
    'ps-zone-attestation.resources.json', 'design/colors_and_type.css',
    'design/components.css', 'design/fluent-basic-icons.svg', 'design/abacus-icons/light-bulb-48.svg', 'lib/alpine.js', 'lib/intl.js'];
  check('loads its own engine, layer, config, design subset, Alpine and intl.js',
    expected.every(p => loaded.has(p)), expected.filter(p => !loaded.has(p)).join(', '));
  const look = await page.evaluate(() => {
    const uses = [...document.querySelectorAll('.psz use, .psz-res use')].map(u => (u.getAttribute('href') || u.getAttribute('xlink:href') || '').slice(1));
    const icon = document.querySelector('.psz-res .psz-tipcard img');
    return {
      uses: uses.length, missing: uses.filter(id => !document.getElementById(id)),
      container: getComputedStyle(document.querySelector('.psz')).containerName,
      icon: icon ? icon.complete && icon.naturalWidth > 0 : null,
      stray: document.querySelectorAll('[class*="bspf"], [data-bsp-form]').length
    };
  });
  check('every <use href="#…"> resolves against the vendored sprite', look.uses > 0 && look.missing.length === 0,
    look.uses + ' uses; missing: ' + look.missing.join(', '));
  check('its own CSS layer is applied (.psz is the "psz" container)', /\bpsz\b/.test(look.container), look.container);
  check('job aid icon renders from design/', look.icon === true, String(look.icon));
  check('no BSP Forms markup on the page', look.stray === 0, look.stray);
  // the files nothing on this screen loads: the thank-you art and pnp
  const files = await page.evaluate(async src => {
    const r = await fetch(src + 'design/spot-illustrations/shield-checkmark-xs.svg');
    return { art: r.ok && /<svg/.test(await r.text()) };
  }, SRC);
  check('thank-you illustration is in design/', files.art);
  // an absolute or server-relative asset path in the config would load from
  // outside the folder with no setting involved (resolveAsset passes it
  // through), and a relative one can climb out with ../. So: relative, AND
  // resolved against design/ exactly as the engine does, it stays inside.
  const assetPaths = await page.evaluate(async src => {
    const c = await (await fetch(src + 'ps-zone-attestation.json')).json();
    const r = await (await fetch(src + 'ps-zone-attestation.resources.json')).json();
    // resources icons: only asset paths (a sprite name like "document" isn't a file)
    const resIcons = r.sections.flatMap(s => s.items).map(i => i.icon).filter(i => i && /[./]/.test(i));
    return [c.form.headerCard && c.form.headerCard.icon, c.form.appearance && c.form.appearance.icon,
      c.confirmation && c.confirmation.illustration, ...resIcons].filter(Boolean);
  }, SRC);
  const assetOut = assetPaths.filter(p => /^(\/|[a-z][\w+.-]*:)/i.test(p) ||
    !new URL(p, SRC + 'design/').href.startsWith(SRC + 'design/'));
  check('config asset paths are relative and resolve inside design/',
    assetPaths.length > 0 && assetOut.length === 0, 'outside: ' + assetOut.join(', '));
  await page.addScriptTag({ url: SRC + 'lib/pnp2.bundle.js' });
  check('lib/pnp2.bundle.js is a working pnp bundle (direct load)', await page.evaluate(() => !!(window.pnp && window.pnp.sp && window.pnp.sp.web)));
  check('no page errors (standalone)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // the real (non-mock) loader: mock-sp.js is blanked so PSZ_MOCK_SP is undefined and the engine
  // runs its real adapter, which loads pnp itself; /_api/ gets a local 404 (no SharePoint here)
  ctx = await browser.newContext({ viewport: { width: 1100, height: 1600 } });
  page = await ctx.newPage();
  const realUrls = [];
  page.on('request', r => realUrls.push(r.url()));
  await page.route('**/dev/mock-sp.js', r => r.fulfill({ contentType: 'application/javascript', body: '/* mock off: real adapter */' }));
  await page.route('**/_api/**', r => r.fulfill({ status: 404, body: '' }));
  await page.goto(BASE);
  await page.waitForSelector('script[data-psz-script="pnp"]', { state: 'attached', timeout: 8000 });
  await page.waitForFunction(() => !!(window.pnp && window.pnp.sp), null, { timeout: 8000 }).catch(() => {});
  const pnpTag = await page.evaluate(() => {
    const s = document.querySelector('script[data-psz-script="pnp"]');
    return s ? s.src.split('?')[0] : null;
  });
  check('real loader requests pnp from src/lib/',
    pnpTag === SRC + 'lib/pnp2.bundle.js' && realUrls.some(u => u.split('?')[0] === SRC + 'lib/pnp2.bundle.js'), String(pnpTag));
  check('real loader: window.pnp.sp is defined', await page.evaluate(() => !!(window.pnp && window.pnp.sp)));
  // same-origin /_api/ URLs are SharePoint REST calls the route answered with 404, not asset loads
  const realOutside = realUrls.filter(u => !inBounds(u) &&
    !(u.startsWith(new URL('/', BASE).href) && u.includes('/_api/')));
  check('real loader: no asset request leaves src/', realOutside.length === 0, realOutside.join(' '));
  await ctx.close();

  // served by VS Code Live Server: it injects its reload script before
  // EVERY "</svg>" in an .svg (event-stream replace), including the example
  // one in the sprite's header comment, whose own "<!-- … -->" then ends that
  // comment early. Reproduced here exactly; the icons must still resolve.
  ctx = await browser.newContext({ viewport: { width: 1100, height: 1600 } });
  page = await ctx.newPage();
  const warns = [];
  page.on('console', m => { if (m.type() === 'warning') warns.push(m.text()); });
  await page.route('**/fluent-basic-icons.svg', async route => {
    const svg = await (await route.fetch()).text();
    const INJECTED = '<!-- Code injected by live-server -->\n<script>\n\t// <![CDATA[  <-- For SVG support\n' +
      "\tif ('WebSocket' in window) { (function () { for (var i = 0; i < 1; ++i) {} })(); }\n\t// ]]>\n</script>";
    await route.fulfill({ contentType: 'image/svg+xml', body: svg.split('</svg>').join(INJECTED + '</svg>') });
  });
  await page.goto(BASE);
  await page.waitForSelector('.psz-asg__row', { timeout: 15000 });
  await page.waitForTimeout(400);
  const ls = await page.evaluate(() => {
    const uses = [...document.querySelectorAll('.psz use')].map(u => (u.getAttribute('href') || '').slice(1));
    const sprite = document.querySelector('svg[data-psz="sprite"]');
    return { uses: uses.length, missing: uses.filter(id => !document.getElementById(id)).length,
      symbols: sprite ? sprite.querySelectorAll('symbol').length : -1, scripts: sprite ? sprite.querySelectorAll('script').length : -1 };
  });
  check('Live Server-rewritten sprite: every icon still resolves (its injected script stripped)',
    ls.uses > 0 && ls.missing === 0 && ls.symbols > 40 && ls.scripts === 0 && !warns.some(w => /sprite/.test(w)), JSON.stringify(ls));
  await ctx.close();

  await testCoexistence(browser);
}

/* The real shared engine on the same page: BSP Forms 0.5.1 (bsp-forms.js +
   bsp-forms.css, a dev-only fixture in tests/fixtures/, never deployed) with
   a one-field form of its own, loaded before this engine and after it. Its
   design-system base points at the same vendored files, so this tests the
   two ENGINES and their layers, not two design-system versions (a newer
   shared design system restyling shared classes is the documented reason the
   form gets its own page, docs/00-overview.md). Alpine is put on the page
   first: two engines loading it at once would both inject it. */
const BSP_MOUNT = '<div data-bsp-form><script type="application/json" data-bspf-config>' +
  '{"form":{"title":"Shared engine form"},"target":{"listTitle":"Other-List"},' +
  '"pages":[{"sections":[{"fields":[{"id":"who","type":"text","label":"Name","column":"Title"}]}]}]}</script></div>';
const bspSettings = () => '<script>window.BSP_FORMS_SETTINGS = { mockSp: window.PSZ_MOCK_SP, designBase: ' +
  JSON.stringify(SRC + 'design/') + ', alpineUrl: ' + JSON.stringify(SRC + 'lib/alpine.js') + ' };</script>';
// The zone form's whole computed look: every property of every element in
// its mount, plus ::before/::after, hashed per element (animations finished
// first, so the rows' rise animation can't make two pages differ). `rows`
// lets a comparison refuse a form that didn't render: two empty mounts
// would otherwise look identical.
async function zoneLook(page) {
  return page.evaluate(() => {
    document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { /* infinite: leave it */ } });
    const mount = document.querySelector('[data-psz-form]');
    if (!mount) return { rows: 0, els: [] };
    const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
    // sorted: Chromium lists custom properties (--tokens) in the order their
    // stylesheets happened to load, which varies from one page load to the next.
    // An absolute/fixed element reports its offsets (top, inset-block-start…)
    // as resolved pixels from its containing block, so they move when another
    // form sits above this one; those are layout, not style, and are skipped.
    // Everywhere else offsets compare as declared.
    const OFFSETS = /^(top|right|bottom|left|inset(-(block|inline)(-(start|end))?)?)$/;
    const sig = (el, pseudo) => {
      const cs = getComputedStyle(el, pseudo);
      const placed = cs.position === 'absolute' || cs.position === 'fixed';
      return [...cs].filter(p => !(placed && OFFSETS.test(p))).sort().map(p => p + ':' + cs.getPropertyValue(p)).join(';');
    };
    const els = [mount, ...mount.querySelectorAll('*')].map(el => {
      const name = el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].join('.') : '');
      return name + ' ' + fnv(sig(el, null) + '|' + sig(el, '::before') + '|' + sig(el, '::after'));
    });
    return { rows: mount.querySelectorAll('.psz-asg__row').length, els };
  });
}
// '' when two looks match (and both are a fully rendered form), else why not
function lookDiff(a, b) {
  if (a.rows !== 3 || b.rows !== 3) return 'form not rendered (rows ' + a.rows + ' / ' + b.rows + ')';
  if (a.els.length !== b.els.length) return 'element count ' + a.els.length + ' vs ' + b.els.length;
  const diff = a.els.map((e, i) => e === b.els[i] ? null : i + ': ' + b.els[i].split(' ')[0]).filter(Boolean);
  return diff.length ? diff.length + ' element(s) differ, e.g. ' + diff.slice(0, 3).join(', ') : '';
}
async function bothMounted(page) {
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-bsp-form]'), z = document.querySelector('[data-psz-form]');
    return b && z && b.getAttribute('data-bspf-state') === 'ready' && z.getAttribute('data-psz-state') === 'ready' &&
      z.querySelectorAll('.psz-asg__row').length === 3;
  }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const b = document.querySelector('[data-bsp-form]'), z = document.querySelector('[data-psz-form]');
    const has = (root, re) => [root, ...root.querySelectorAll('*')].some(el =>
      [...el.attributes].some(a => re.test(a.name) || (a.name === 'class' && re.test(a.value))));
    return {
      bsp: b.getAttribute('data-bspf-state'), zone: z.getAttribute('data-psz-state'),
      rows: z.querySelectorAll('.psz-asg__row').length, bspForm: !!b.querySelector('.bspf'),
      defs: [Object.keys(window.BSPForms._defs).length, Object.keys(window.PSZoneForm._defs).length],
      // two separate namespaces, and PSZoneForm still this engine's (a shared
      // engine assigning it would make both _defs counts read 1 off one object)
      ownNs: window.PSZoneForm !== window.BSPForms && window.PSZoneForm.version !== window.BSPForms.version,
      zoneHasBsp: has(z, /bspf|bsp-form/), bspHasZone: has(b, /psz/)
    };
  });
}
async function testCoexistence(browser) {
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1600 } });
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    return { ctx, page };
  };
  // baseline: the zone form alone
  let { ctx, page } = await open();
  await page.goto(BASE);
  await page.waitForSelector('.psz-asg__row', { timeout: 15000 });
  await page.waitForTimeout(300);
  const alone = await zoneLook(page);
  await ctx.close();

  // BSP Forms first: the shared engine and its form come before this one in the page
  ({ ctx, page } = await open());
  await page.route('**/dev/index.html*', async route => {
    const html = await (await route.fetch()).text();
    const before = '<script src="' + SRC + 'lib/alpine.js"></script>';
    const after = bspSettings() + BSP_MOUNT + '<script src="' + FIXTURE + 'bsp-forms.js?v=fixture"></script>';
    await route.fulfill({ contentType: 'text/html',
      body: html.replace('<script src="mock-sp.js"></script>', before + '<script src="mock-sp.js"></script>' + after) });
  });
  await page.goto(BASE);
  let st = await bothMounted(page);
  check('BSP Forms first: both forms mount, each engine only its own',
    st.bsp === 'ready' && st.zone === 'ready' && st.rows === 3 && st.bspForm && st.defs.join() === '1,1' && st.ownNs, JSON.stringify(st));
  check('BSP Forms first: no class or attribute crosses between the two forms', !st.zoneHasBsp && !st.bspHasZone, JSON.stringify(st));
  let diff = lookDiff(alone, await zoneLook(page));
  check('BSP Forms first: every computed style in the zone form matches the form alone', diff === '', diff);
  check('no page errors (BSP Forms first)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // BSP Forms later: added to a page where the zone form is already running
  ({ ctx, page } = await open());
  await page.goto(BASE);
  await page.waitForSelector('.psz-asg__row', { timeout: 15000 });
  await page.evaluate(({ settings, mount, src }) => {
    const host = document.createElement('div');
    host.innerHTML = mount;
    document.body.appendChild(host.firstChild);
    window.BSP_FORMS_SETTINGS = JSON.parse(settings);
    window.BSP_FORMS_SETTINGS.mockSp = window.PSZ_MOCK_SP;
    const s = document.createElement('script');
    s.src = src;
    document.head.appendChild(s);
  }, { settings: JSON.stringify({ designBase: SRC + 'design/', alpineUrl: SRC + 'lib/alpine.js' }), mount: BSP_MOUNT,
    src: FIXTURE + 'bsp-forms.js?v=fixture' });
  st = await bothMounted(page);
  check('BSP Forms later: it mounts its own form and leaves the zone form alone',
    st.bsp === 'ready' && st.zone === 'ready' && st.rows === 3 && st.bspForm && st.defs.join() === '1,1' && st.ownNs &&
    !st.zoneHasBsp && !st.bspHasZone, JSON.stringify(st));
  const bspCss = await page.evaluate(() => [...document.styleSheets].some(s => /bsp-forms\.css/.test(s.href || '')));
  diff = lookDiff(alone, await zoneLook(page));
  check('BSP Forms later: bsp-forms.css changes no computed style in the zone form',
    bspCss && diff === '', bspCss ? diff : 'bsp-forms.css not loaded');
  check('no page errors (BSP Forms later)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();
}

/* The resources panel ([data-psz-resources], dev/page.html): the side-column
   web part beside the form. Mutations go through its config route. */
async function openPage(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1600 } });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.route('**/ps-zone-attestation.resources.json', async route => {
    const cfg = await (await route.fetch()).json();
    if (opts.mutate) opts.mutate(cfg);
    await route.fulfill({ json: cfg });
  });
  await page.goto(PAGE + (opts.query || ''));
  if (!opts.noWait) {
    await page.waitForFunction(() => {
      const m = document.querySelector('[data-psz-resources]');
      return m && /ready|error/.test(m.getAttribute('data-psz-state') || '');
    }, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  return { ctx, page };
}
async function testResources(browser) {
  console.log('resources panel:');
  const res = page => page.evaluate(() => {
    const r = document.querySelector('.psz-res');
    if (!r) return null;
    const items = [...r.querySelectorAll('.psz-res__item')];
    return {
      lang: r.getAttribute('lang'), keep: r.classList.contains('lang-keep'),
      headings: [...r.querySelectorAll('.psz-res__heading')].map(h => h.textContent),
      types: items.map(i => [...i.classList].find(c => c.startsWith('psz-res__item--')).replace('psz-res__item--', '')),
      links: [...r.querySelectorAll('a.psz-tipcard, a.psz-res__link')].map(a => [a.textContent.trim().split('\n')[0], a.getAttribute('href'), a.target, a.rel]),
      unlinked: r.querySelectorAll('.is-unlinked').length,
      descs: r.querySelectorAll('.psz-res__desc').length,
      subheads: [...r.querySelectorAll('.psz-res__subhead')].map(h => h.textContent),
      texts: r.querySelectorAll('.psz-res__text').length,
      avatar: (r.querySelector('.psz-res__contact .avatar') || {}).textContent,
      contact: (r.querySelector('.psz-res__contact-name') || {}).textContent,
      mail: (r.querySelector('.psz-res__contact-mail') || { getAttribute: () => null }).getAttribute('href'),
      featureLooksLikeJobAid: !!r.querySelector('.psz-res__item--feature .psz-tipcard .psz-tipcard__icon img')
    };
  });

  // as shipped: placeholders, no urls yet
  let { ctx, page } = await openPage(browser);
  await page.waitForSelector('.psz-asg__row', { timeout: 15000 });
  let r = await res(page);
  check('panel renders both groups beside the form',
    r && JSON.stringify(r.headings) === '["Resources and guides","Information"]' &&
    (await page.locator('.psz-asg__row').count()) === 3, JSON.stringify(r && r.headings));
  check('resources: job aid card (as on the form), two document links; information: two texts, a contact',
    JSON.stringify(r.types) === '["feature","link","link","text","text","contact"]' && r.featureLooksLikeJobAid &&
    r.descs === 3 && r.texts === 2, JSON.stringify(r.types));
  check('empty urls → placeholders shown, not linked', r.unlinked === 3 && r.links.length === 0, JSON.stringify(r));
  check('contact card: initials skip the [Placeholder] tag, email is a mailto link',
    r.avatar === 'CN' && /Contact Name$/.test(r.contact) && r.mail === 'mailto:contact.name@example.com', JSON.stringify([r.avatar, r.mail]));
  check('no page errors (resources)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // real urls link out in a new tab; an unsafe one stays unlinked; a bad email isn't a mailto
  ({ ctx, page } = await openPage(browser, { mutate: cfg => {
    cfg.sections[0].items[0].url = JOB_AID;
    cfg.sections[0].items[1].url = '/sites/FCUPortal/Shared Documents/standards.pdf';
    cfg.sections[0].items[2].url = 'javascript:alert(1)';
    cfg.sections[1].items[2].email = 'not an email';
  } }));
  r = await res(page);
  check('job aid + document link open in a new tab (noopener); spaces in a path are encoded',
    r.links.length === 2 && r.links[0][1] === JOB_AID && r.links[1][1] === '/sites/FCUPortal/Shared%20Documents/standards.pdf' &&
    r.links.every(l => l[2] === '_blank' && /noopener/.test(l[3])), JSON.stringify(r.links));
  check('javascript: url → not linked', r.unlinked === 1 && !(await page.evaluate(() => /javascript:/i.test(document.querySelector('.psz-res').innerHTML))));
  check('invalid contact email → shown without a mailto link', r.mail === null, String(r.mail));
  await ctx.close();

  // bilingual: ?lang=fr, then a switch re-renders in place
  ({ ctx, page } = await openPage(browser, { query: '?lang=fr' }));
  r = await res(page);
  check('?lang=fr → French panel, lang="fr" + lang-keep',
    r.lang === 'fr' && r.keep && r.headings[0] === 'Ressources et guides' && r.subheads.includes('Des questions?'), JSON.stringify(r.headings));
  await page.evaluate(() => window.intl.setLang('en'));
  await page.waitForTimeout(400);
  r = await res(page);
  check('intl.setLang("en") → panel and form both switch back',
    r.lang === 'en' && r.headings[0] === 'Resources and guides' &&
    (await page.locator('.psz__title').textContent()) === 'Physical Security Zones Attestation', JSON.stringify(r.headings));
  check('no page errors (resources, FR/EN)', page.__errors.length === 0, page.__errors.join(' | '));
  await ctx.close();

  // edit mode: both web parts show their placeholder, nothing renders
  ({ ctx, page } = await openPage(browser, { query: '?Mode=Edit', noWait: true }));
  await page.waitForTimeout(800);
  const edit = await page.evaluate(() => ({
    notes: [...document.querySelectorAll('.psz-editnote')].filter(n => n.offsetParent !== null).length,
    res: document.querySelectorAll('.psz-res').length, form: document.querySelectorAll('.psz').length
  }));
  check('edit mode: both web parts show their placeholder, neither renders', edit.notes === 2 && edit.res === 0 && edit.form === 0, JSON.stringify(edit));
  await ctx.close();

  // a broken resources config: its own error card; the form is unaffected
  for (const [name, mutate] of [
    ['unknown item type → error card', cfg => { cfg.sections[0].items[0].type = 'banner'; }],
    ['link without a title → error card', cfg => { delete cfg.sections[0].items[1].title; }],
    ['no sections → error card', cfg => { cfg.sections = []; }]
  ]) {
    ({ ctx, page } = await openPage(browser, { mutate }));
    const st = await page.evaluate(() => [document.querySelector('[data-psz-resources]').getAttribute('data-psz-state'),
      !!document.querySelector('[data-psz-resources] [data-psz-fatal]'), document.querySelector('[data-psz-form]').getAttribute('data-psz-state')]);
    check('resources: ' + name + ', the form still loads', st[0] === 'error' && st[1] && st[2] === 'ready', JSON.stringify(st));
    await ctx.close();
  }
}

(async () => {
  const browser = await launch();
  try {
    await testEditMode(browser);
    await testZoneAttestation(browser);
    await testErrorReporting(browser);
    await testStandalone(browser);
    await testResources(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? '\nFAILED: ' + failures + ' check(s)' : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
