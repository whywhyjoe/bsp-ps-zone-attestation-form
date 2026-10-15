/*! PS Zone Attestation · dev/mock-sp.js — dev-only SharePoint mock */
/* =====================================================================
   A stand-in for the pnpjs adapter so the form runs with zero network
   and zero tenant. Forked from BSP Forms' dev/mock-sp.js and trimmed to
   what the zone attestation calls. Load it before ps-zone-attestation.js
   and pass it via:

     window.PSZ_FORM_SETTINGS = { mockSp: window.PSZ_MOCK_SP, ... };

   Every write is recorded on window.__PSZ_MOCK_WRITES__ so a test (or
   you, in devtools) can assert exactly what would have hit SharePoint.
   Knobs (set before the page loads, or in devtools):
     PSZ_MOCK_FAIL = { addItem | getAssignments | getRowKeys | logError | … : true,
                       addItemAfter: n, addItemLostAfter: n }
     PSZ_MOCK_ASSIGNMENTS = [rows]   replaces the default rows below
     PSZ_MOCK_DONE = ['12', …]       keys already in the Responses list
     PSZ_MOCK_ADD_MS = ms            how long an add takes (default 500)
     PSZ_MOCK_KEYS_CAP = n           cut the earlier-responses read at n
     PSZ_MOCK_FIELDS = { listTitle: [field defs] }   doctor schema override
     PSZ_MOCK_ACCESS = [rows]        replaces the default access-list rows
     PSZ_MOCK_ACCESS_MORE = true     the access read reports itself cut off
   ===================================================================== */
(function () {
  'use strict';

  var writes = window.__PSZ_MOCK_WRITES__ = [];
  var nextId = 100;
  function delay(v, ms) {
    return new Promise(function (res) { setTimeout(function () { res(v); }, ms == null ? 250 : ms); });
  }
  function maybeFail(op) {
    var f = window.PSZ_MOCK_FAIL || {};
    if (f[op]) return Promise.reject(new Error('mock ' + op + ' failure (PSZ_MOCK_FAIL.' + op + ')'));
    return null;
  }

  // what the dev tester is assigned (plus a row for someone else, which the
  // user filter must drop). Two rows have a current zone (confirm / change);
  // Tower 37 has none, so it gets the dropdown straight away.
  var ASSIGNMENTS = [
    { ID: 11, UserEmail: 'Dev.Tester@example.com', UserDescription: 'Branch manager', AreaName: 'FCP - Tower 10', CurrentZone: 'Public Plus' },
    { ID: 12, UserEmail: 'dev.tester@example.com', UserDescription: 'Branch manager', AreaName: 'FCP - Concourse Podium', CurrentZone: 'High Security' },
    { ID: 13, UserEmail: 'dev.tester@example.com', UserDescription: 'Branch manager', AreaName: 'FCP - Tower 37', CurrentZone: '' },
    { ID: 14, UserEmail: 'someone.else@example.com', UserDescription: 'Facilities', AreaName: 'Data centre — Hall B', CurrentZone: 'Public' }
  ];
  // the access list: who can enter each area. Tower 10 has five people
  // (an odd count, for the two-column layout), the Podium two (one listed
  // with different case and outer spaces in its area name, which must still
  // match), Tower 37 none, and Hall B — someone else's area — one, which
  // must never show.
  var ACCESS = [
    { AreaName: 'FCP - Tower 10', EmployeeName: 'Morgan Lee', EmployeeEmail: 'morgan.lee@example.com' },
    { AreaName: 'FCP - Tower 10', EmployeeName: 'Ana Diaz', EmployeeEmail: 'ana.diaz@example.com' },
    { AreaName: 'FCP - Tower 10', EmployeeName: 'Sam Okafor', EmployeeEmail: 'sam.okafor@example.com' },
    { AreaName: 'FCP - Tower 10', EmployeeName: 'Priya Natarajan', EmployeeEmail: 'priya.natarajan@example.com' },
    { AreaName: 'FCP - Tower 10', EmployeeName: 'Jordan Tremblay', EmployeeEmail: 'jordan.tremblay@example.com' },
    { AreaName: 'FCP - Concourse Podium', EmployeeName: 'Chris Wong', EmployeeEmail: 'chris.wong@example.com' },
    { AreaName: ' fcp - concourse podium ', EmployeeName: 'Alex Martin', EmployeeEmail: 'alex.martin@example.com' },
    { AreaName: 'Data centre — Hall B', EmployeeName: 'Not Yours', EmployeeEmail: 'not.yours@example.com' }
  ];
  // per-list schemas for the doctor (window.PSZ_MOCK_FIELDS[listTitle] wins)
  var TARGET = 'PS_Zone-Attestation-Responses';
  var ZONE_FIELDS = {
    'PS_Zone-Attestation-Assignments': ['UserEmail:Text', 'UserDescription:Text', 'AreaName:Text', 'CurrentZone:Text'],
    'PS_Zone-Attestation-Responses': ['Title:Text', 'LookupID:Number', 'UserName:Text', 'UserEmail:Text', 'UserDescription:Text',
      'AreaName:Text', 'ZoneSelection:Text', 'PreviousZone:Text', 'ZoneChanged:Boolean', 'Attestation:Text', 'AttestationTime:DateTime']
  };
  function fieldsOf(defs) {
    return defs.map(function (d) {
      var p = d.split(':');
      return { InternalName: p[0], Title: p[0], TypeAsString: p[1], Required: p[0] === 'Title', ReadOnlyField: false };
    });
  }
  function savedKeys(keyColumn) {
    var keys = (window.PSZ_MOCK_DONE || []).map(String);
    writes.forEach(function (w) {
      if (w.op === 'addItem' && w.payload[keyColumn] != null) keys.push(String(w.payload[keyColumn]));
    });
    return keys;
  }

  window.PSZ_MOCK_SP = {
    isMock: true,
    webUrl: function () { return 'https://mock.local/sites/FCUPortal'; },
    ready: function () { return Promise.resolve(); },
    userInfo: function () { return { name: 'Dev Tester', email: 'dev.tester@example.com', login: 'i:0#.f|membership|dev.tester@example.com' }; },
    photoUrl: function () { return 'about:invalid'; }, // force the initials fallback
    // the zone form has no person, lookup or attachment fields; these stay
    // so the mock keeps the real adapter's method names
    searchPeople: function () { return maybeFail('searchPeople') || delay([], 100); },
    ensureUser: function () { return delay(999, 50); },
    addAttachment: function () { return Promise.reject(new Error('mock: the zone form has no attachments')); },
    lookupValue: function () { return delay(null, 50); },
    getLookupItems: function () { return maybeFail('getLookupItems') || delay([], 100); },
    addItem: function (payload) {
      var fail = maybeFail('addItem');
      if (fail) return fail;
      // PSZ_MOCK_FAIL.addItemAfter = n: the first n adds succeed, then they fail
      var F = window.PSZ_MOCK_FAIL || {};
      var adds = writes.filter(function (w) { return w.op === 'addItem'; }).length;
      if (F.addItemAfter != null && adds >= F.addItemAfter) {
        return Promise.reject(new Error('mock addItem failure after ' + F.addItemAfter + ' (PSZ_MOCK_FAIL.addItemAfter)'));
      }
      // PSZ_MOCK_FAIL.addItemLostAfter = n: after n good adds, the next add
      // LANDS (it's recorded) but the browser never hears back — the
      // "committed, response lost" case
      if (F.addItemLostAfter != null && adds >= F.addItemLostAfter && !F.__lost) {
        F.__lost = true;
        writes.push({ op: 'addItem', id: ++nextId, payload: JSON.parse(JSON.stringify(payload)), lost: true });
        return delay(null, 200).then(function () { throw new Error('mock: response lost after the add landed (PSZ_MOCK_FAIL.addItemLostAfter)'); });
      }
      var id = ++nextId;
      writes.push({ op: 'addItem', id: id, payload: JSON.parse(JSON.stringify(payload)) });
      console.info('[mock-sp] addItem #' + id, payload);
      var ms = window.PSZ_MOCK_ADD_MS != null ? window.PSZ_MOCK_ADD_MS : 500;
      return delay({ id: id, item: { __mockItemId: id, attachmentFiles: { add: function () { } } } }, ms);
    },
    // the error log (config errorLog): one item per reported failure.
    // PSZ_MOCK_FAIL.logError makes the report itself fail.
    logError: function (spec, item) {
      var fail = maybeFail('logError');
      if (fail) return fail;
      writes.push({ op: 'logError', list: spec.listTitle, site: spec.siteUrl || '', item: JSON.parse(JSON.stringify(item)) });
      return delay(null, 100);
    },
    getListFields: function (spec) {
      var name = spec ? (spec.listTitle || spec.listUrl) : TARGET;
      var custom = window.PSZ_MOCK_FIELDS && name && window.PSZ_MOCK_FIELDS[name];
      if (custom) return delay(custom, 200);
      return delay(ZONE_FIELDS[name] ? fieldsOf(ZONE_FIELDS[name]) : [], 200);
    },
    // assignments: PSZ_MOCK_ASSIGNMENTS (rows, each with ID + the source
    // columns and the user column) filtered like the real adapter —
    // userColumn equal to any of the user's addresses, case-insensitive
    getAssignments: function (src, emails) {
      var fail = maybeFail('getAssignments');
      if (fail) return fail;
      writes.push({ op: 'getAssignments', list: src.listUrl || src.listTitle, emails: emails.slice() });
      var max = src.top || 500;
      var rows = (window.PSZ_MOCK_ASSIGNMENTS || ASSIGNMENTS).filter(function (r) {
        return emails.indexOf(String(r[src.userColumn] || '').toLowerCase()) > -1;
      }).map(function (r) {
        var o = { ID: r.ID };
        src._cols.forEach(function (c) { o[c] = r[c] == null ? '' : r[c]; });
        return o;
      }).sort(function (a, b) {
        var c = src.orderBy || src.labelColumn;
        return String(a[c]).localeCompare(String(b[c]));
      });
      // same shape as the real adapter: cut at max, say if there were more
      return delay({ rows: rows.slice(0, max), more: rows.length > max }, 450);
    },
    // the access list: PSZ_MOCK_ACCESS (rows with the spec's area, name and
    // email columns) for these areas. SharePoint's eq ignores case but not
    // outer spaces; the mock is more forgiving so the engine's own matching
    // (case- and trim-blind) is what's tested.
    getAccess: function (spec, areas) {
      var fail = maybeFail('getAccess');
      if (fail) return fail;
      writes.push({ op: 'getAccess', list: spec.listUrl || spec.listTitle, areas: areas.slice() });
      var want = areas.map(function (a) { return String(a).trim().toLowerCase(); });
      var rows = (window.PSZ_MOCK_ACCESS || ACCESS).filter(function (r) {
        return want.indexOf(String(r[spec.areaColumn] || '').trim().toLowerCase()) > -1;
      }).map(function (r) {
        return { area: String(r[spec.areaColumn] || ''), name: String(r[spec.nameColumn] || ''), email: String(r[spec.emailColumn] || '') };
      });
      return delay({ rows: rows, more: !!window.PSZ_MOCK_ACCESS_MORE }, 350);
    },
    // keys already saved for this user: PSZ_MOCK_DONE plus every row this
    // page has saved through addItem (including a "lost" one).
    // PSZ_MOCK_KEYS_CAP = n: the read returns only the first n keys and
    // reports itself cut off — like the real adapter past ROW_KEYS_MAX.
    getRowKeys: function (rk) {
      var fail = maybeFail('getRowKeys');
      if (fail) return fail;
      var keys = savedKeys(rk.keyColumn);
      writes.push({ op: 'getRowKeys' });
      var cap = window.PSZ_MOCK_KEYS_CAP;
      return delay(cap != null && keys.length > cap ? { keys: keys.slice(0, cap), more: true } : { keys: keys, more: false }, 200);
    },
    // the exact check for a few keys (no cap), as the real adapter does
    getRowKeysFor: function (rk, emails, values) {
      var fail = maybeFail('getRowKeysFor');
      if (fail) return fail;
      writes.push({ op: 'getRowKeysFor', values: values.slice() });
      var keys = savedKeys(rk.keyColumn);
      var want = values.map(String);
      return delay(keys.filter(function (k) { return want.indexOf(k) > -1; }), 150);
    }
  };
})();
