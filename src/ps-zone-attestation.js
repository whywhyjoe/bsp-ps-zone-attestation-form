/*! PS Zone Attestation · v1.3.3 · ps-zone-attestation.js */
/* =====================================================================
   Physical Security Zones Attestation — standalone form engine.

   A frozen, renamed fork of the BSP Forms engine 0.5.1
   (bsp-sp-parts/bsp-forms/bsp-forms.js @ fe5c040). It shares nothing at
   runtime with BSP Forms or the shared Code/bsp-design + Code/lib
   folders: every file it loads sits in its own deployed folder.

     ps-zone-attestation/            ← one folder, deployed whole
       ps-zone-attestation.js        this engine
       ps-zone-attestation.css       its layer
       ps-zone-attestation.json      the form config
       ps-zone-attestation.resources.json   the side panel's config
       design/                       vendored BSP subset (css, sprite, art)
       lib/                          alpine.js · pnp2.bundle.js · intl.js

   The web part insert (see webpart/ps-zone-attestation.webpart.html):

     <div data-psz-form data-config="/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.json"></div>
     <script src="https://…/sites/FCUPortal/Code/ps-zone-attestation/ps-zone-attestation.js?v=1.3.3"></script>

   The same engine also mounts the resources side panel (1.1.0), a second
   web part with `data-psz-resources` in place of `data-psz-form` and the
   resources config (webpart/ps-zone-attestation-resources.webpart.html).
   1.2.0 adds error reporting (errorLog list + errorContact mailto) and the
   full-page saving overlay.

   Every global, attribute, class and storage key is renamed (PSZoneForm,
   PSZ_FORM_SETTINGS, data-psz-*, .psz-*), so the shared BSP Forms engine
   on the same page can never mount, skip or restyle this form.

   The engine:
   - is a classic script (no modules, no build step), idempotent per mount,
     safe to evaluate more than once on one page (web parts re-run scripts);
   - injects the BSP CSS + its own layer, the icon sprite, Alpine and the
     self-hosted pnpjs 2 bundle if the page doesn't already have them;
   - renders the form from the JSON config, and writes submissions to a
     SharePoint list via pnpjs v2 (`pnp.sp.setup` + fluent API);
   - honors SharePoint page edit mode (renders an inert note instead).

   Optional page-level overrides (set BEFORE this script):
     window.PSZ_FORM_SETTINGS = {
       designBase: '<engine folder>/design/', // vendored BSP css + sprite + art
       libBase:    '<engine folder>/lib/',    // alpine + pnp + intl
       alpineUrl:  null,   // full override of the Alpine url
       pnpUrl:     null,   // full override of the pnpjs 2 bundle url
       intlUrl:    null,   // full override of the bilingual intl.js url
                           // (loaded only by forms with form.languages)
       webUrl:     null,   // page web absolute url override
       mockSp:     null    // dev-only mock adapter (see dev/mock-sp.js)
     };
   Every key has a default derived from this script's own URL, so an
   ordinary deployment needs no configuration at all.
   ===================================================================== */
(function () {
  'use strict';

  var VERSION = '1.3.3';
  var NS = window.PSZoneForm = window.PSZoneForm || {};
  if (NS.__engineLoaded) { if (NS.scan) NS.scan(); return; }
  NS.__engineLoaded = true;
  NS.version = VERSION;
  NS._defs = {};

  /* ------------------------------------------------------------------
     Settings + base resolution
     ------------------------------------------------------------------ */
  var settings = window.PSZ_FORM_SETTINGS || {};
  var scriptEl = document.currentScript;
  var engineSrc = (scriptEl && scriptEl.src) || '';
  var engineBase = engineSrc ? engineSrc.slice(0, engineSrc.lastIndexOf('/') + 1) : '';
  var engineVer = (function () {
    var m = /[?&]v=([^&]+)/.exec(engineSrc);
    return m ? m[1] : '';
  })();

  function normPath(u) {
    // resolve ../ segments in an absolute-ish url or path
    try { return new URL(u, location.href).href; } catch (e) { return u; }
  }
  // everything lives inside the engine's own folder — never the shared
  // Code/bsp-design or Code/lib, so a change there can't reach this form
  var designBase = settings.designBase || (engineBase ? normPath(engineBase + 'design/') : '');
  var libBase = settings.libBase || (engineBase ? normPath(engineBase + 'lib/') : '');
  var alpineUrl = settings.alpineUrl || (libBase + 'alpine.js');
  var pnpUrl = settings.pnpUrl || (libBase + 'pnp2.bundle.js');
  var intlUrl = settings.intlUrl || (libBase + 'intl.js');

  var hostNonce = (scriptEl && scriptEl.nonce) ||
    (function () { var s = document.querySelector('script[nonce]'); return s ? s.nonce : ''; })();

  /* ------------------------------------------------------------------
     Small utilities
     ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // textarea -> rich-text Note column: escape, keep line breaks as <br>
  // (a rich-text column renders HTML, so raw newlines would collapse)
  function toRichText(s) {
    return '<div>' + esc(s).replace(/\r\n|\r|\n/g, '<br>') + '</div>';
  }
  function jstr(v) { return JSON.stringify(v); }
  function fmtStr(tpl, map) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) {
      return (map && k in map) ? map[k] : m;
    });
  }
  var uidSeq = 0;
  function nextUid() { return 'psz' + (++uidSeq) + '_' + Math.floor(Math.random() * 1e6).toString(36); }
  function safeKey(id) {
    var k = String(id || '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(k)) k = 'f_' + k;
    // names that collide with Object.prototype (or set the prototype) can't
    // be state keys — dot access and {}-map lookups would misbehave
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') k = 'f_' + k;
    return k;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  /* Date helpers — all comparisons are calendar-day based. */
  function parseDateVal(v) {
    // 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm' (native input values)
    if (!v || typeof v !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function today0() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // test seam: PSZoneForm.clock = function () { return <ms>; } pins "now"
  function nowMs() { return typeof NS.clock === 'function' ? NS.clock() : Date.now(); }

  /* Business time (form.businessHours) — counted on the business time
     zone's WALL CLOCK, so the viewer's own zone and DST never matter.
     A moment is { day: civil day number, min: minute of day }. Working
     time is the overlap with [start, end) on business weekdays; anything
     outside hours counts as the last close (6pm Tue == 5pm Tue). One
     "business day" = end - start working minutes. Holidays aren't modeled. */
  function hhmm(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function civilDay(y, mo, d) { return Math.round(Date.UTC(y, mo - 1, d) / 86400000); }
  function bizNow(bh, nowMs) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: bh.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(nowMs == null ? Date.now() : nowMs)).forEach(function (p) { parts[p.type] = p.value; });
    return { day: civilDay(+parts.year, +parts.month, +parts.day), min: (+parts.hour % 24) * 60 + (+parts.minute) };
  }
  function bizAtDate(bh, v) {
    // date-only value -> the moment it stands for (bh.dateAt: 'end' | 'start')
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v || '');
    if (!m) return null;
    if (m[4] != null) {
      // includeTime: the picker shows the VIEWER's wall clock, so convert to
      // an instant, then to the business zone's wall clock (a 2pm pick in
      // Vancouver is 5pm Eastern)
      var ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
      return isNaN(ms) ? null : bizNow(bh, ms);
    }
    return { day: civilDay(+m[1], +m[2], +m[3]), min: bh.dateAt === 'start' ? bh._start : bh._end };
  }
  function bizMinutes(bh, a, b) {
    if (b.day < a.day || (b.day === a.day && b.min <= a.min)) return 0;
    if (b.day - a.day > 366) return Infinity; // far future: never "within"
    var total = 0;
    for (var day = a.day; day <= b.day; day++) {
      if (bh.days.indexOf(new Date(day * 86400000).getUTCDay()) < 0) continue;
      var lo = Math.max(bh._start, day === a.day ? a.min : 0);
      var hi = Math.min(bh._end, day === b.day ? b.min : 1440);
      if (hi > lo) total += hi - lo;
    }
    return total;
  }
  // inclusive: a target exactly n business days away still counts as within
  function bizWithin(bh, v, n, nowMs) {
    var t = bizAtDate(bh, v), now = bizNow(bh, nowMs);
    // a day already gone is invalid input (blocked elsewhere), not "urgent" —
    // otherwise a half-typed year (0202-…) would trip locks and prompts
    if (!t || t.day < now.day) return false;
    return bizMinutes(bh, now, t) <= n * (bh._end - bh._start);
  }
  // earliest date (YYYY-MM-DD) that is at least n business days away
  function bizDateAfter(bh, n, nowMs) {
    var now = bizNow(bh, nowMs), need = n * (bh._end - bh._start);
    for (var day = now.day; day < now.day + 400; day++) {
      if (bizMinutes(bh, now, { day: day, min: bh.dateAt === 'start' ? bh._start : bh._end }) >= need) {
        return new Date(day * 86400000).toISOString().slice(0, 10);
      }
    }
    return null;
  }
  function bizToday(bh, nowMs) { return new Date(bizNow(bh, nowMs).day * 86400000).toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((a - b) / 86400000); }
  function fmtDate(d) { return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''; }

  /* ------------------------------------------------------------------
     Default UX / error strings — every user-visible string lives here
     and can be overridden per form via config.strings.
     ------------------------------------------------------------------ */
  var DEFAULT_STRINGS = {
    next: 'Next', back: 'Back', submit: 'Submit', submitting: 'Submitting…',
    requiredField: 'This field is required.',
    invalidEmail: 'Enter a valid email address (name@example.com).',
    invalidPhone: 'Enter a valid phone number.',
    invalidUrl: 'Enter a valid web address, starting with http:// or https://.',
    invalidNumber: 'Enter a number.',
    numberInteger: 'Enter a whole number.',
    numberMin: 'Must be at least {min}.',
    numberMax: 'Must be no more than {max}.',
    textMinLength: 'Must be at least {min} characters.',
    textMaxLength: 'Must be {max} characters or fewer.',
    patternMismatch: 'This doesn’t match the expected format.',
    choiceRequired: 'Choose an option.',
    multiMin: 'Choose at least {min} option(s).',
    multiMax: 'Choose no more than {max} option(s).',
    personRequired: 'Add at least one person.',
    personMax: 'Add no more than {max} people.',
    personPlaceholder: 'Type a name or email…',
    personSearching: 'Searching the directory…',
    personNoResults: 'No matching people found.',
    personResolveFailed: 'Couldn’t confirm {name} against the directory. Remove and re-add them.',
    dateAfter: 'Must be after {other}.',
    dateOnOrAfter: 'Must be on or after {other}.',
    dateBefore: 'Must be before {other}.',
    dateOnOrBefore: 'Must be on or before {other}.',
    todayLabel: 'today',
    comboPlaceholder: 'Select an option',
    comboPlaceholderMulti: 'Select one or more options',
    fillInPlaceholder: 'Or enter your own…',
    fillInAdd: 'Add',
    lookupLoading: 'Loading options…',
    lookupError: 'Couldn’t load the options for this field. Try again later.',
    linkUrlPlaceholder: 'https://…',
    linkDescPlaceholder: 'Display text (optional)',
    attachDrop: 'Drag files here, or click to browse',
    attachHint: '',
    attachTooLarge: '{name} is larger than the {max} MB limit.',
    attachTooMany: 'No more than {max} files can be attached.',
    attachBadType: '{name} isn’t an accepted file type. Accepted: {types}.',
    attachRequired: 'Attach at least one file.',
    attachRemove: 'Remove attachment',
    attachDone: 'Uploaded',
    pageError: 'Fix the highlighted fields to continue.',
    submitFailed: 'Your response wasn’t submitted — nothing was saved. Try again in a moment.',
    submitFailedDetail: 'Details: {detail}',
    attachPartialTitle: 'Response saved — attachments incomplete',
    attachPartial: 'Your answers were saved, but {n} attachment(s) failed to upload.',
    attachRetry: 'Retry failed uploads',
    attachSkip: 'Continue without them',
    confirmTitle: 'Thank you — your response was submitted.',
    promptTitle: 'Please confirm', promptOk: 'OK',
    redirectCountdown: 'Redirecting in {n} seconds…', redirectPaused: 'Copy the link first, then you’ll be redirected.',
    redirectNow: 'Go now',
    copyBlocked: 'Your browser didn’t allow copying automatically. Copy the link below to continue.',
    copyLabel: 'Original link', copyButton: 'Copy link',
    confirmMessage: '',
    confirmAnother: 'Submit another response',
    configLoadError: 'This form couldn’t be loaded. If this keeps happening, contact the form owner.',
    configLoadDetail: '(PS Zone Attestation: {detail})',
    noContext: 'No SharePoint connection was found on this page, so the form can’t submit.',
    editModeNote: 'PS Zone Attestation — renders in view mode. Config:',
    stepOf: 'Step {n} of {total}',
    doctorTitle: 'Form configuration check',
    doctorOk: 'OK', doctorWarn: 'Check', doctorError: 'Problem',
    // assignments rows, current user, submit confirmation, header card
    assignLoading: 'Loading the items assigned to you…',
    assignLoadError: 'The items assigned to you couldn’t be loaded. Try again in a moment.',
    assignNoUser: 'Your account couldn’t be identified, so the items assigned to you can’t be loaded.',
    assignRetry: 'Try again',
    assignRowRequired: 'Make a selection for this row.',
    assignRowConfirmRequired: 'Confirm this value or choose a new one.',
    assignAllRequired: 'Make a selection for every row.',
    assignProgress: '{n} of {total} complete',
    assignSomeDone: '{n} of your items were already submitted and aren’t shown.',
    assignClear: 'Clear selection',
    assignSaved: 'Saved',
    // rows with a current value (source.currentColumn): confirm it or change it
    assignCurrent: 'Current',
    assignConfirm: 'Confirm this is correct',
    assignChange: 'Change',
    assignKeep: 'Keep current',
    assignNewPlaceholder: 'Select a new value',
    assignConfirmed: 'Confirmed', assignChanged: 'Changed', assignSelected: 'Selected',
    savingTitle: 'Submitting…',
    savingMessage: 'Please wait. Don’t close this page, refresh it or go back until this is done.',
    errorMailLink: 'Email the form administrator about this problem',
    errorMailSubject: 'Problem with the form: {title}',
    errorMailAsk: 'What were you doing when this happened?',
    errorMailInfo: 'Diagnostic information (please leave this in the email):',
    assignEmptyTitle: 'Nothing to complete',
    assignEmptyMessage: 'There are no items assigned to you right now.',
    assignDoneTitle: 'Already submitted',
    assignDoneMessage: 'You’ve already submitted a response for everything assigned to you.',
    rowsPartial: '{n} of {total} rows are confirmed saved; the rest may not be. Select {submit} to finish — rows already saved are checked first and skipped.',
    rowsFailed: 'Not every row could be saved. Select {submit} to try again — rows that did save are checked first and skipped.',
    assignMore: 'Only the first {max} of your items are shown. Submit these, then reload the page to see the rest.',
    assignKeysMore: 'More than {max} earlier responses were found, so some items you already answered may show again.',
    submitConfirmTitle: 'Please confirm', submitConfirmOk: 'Confirm', submitConfirmCancel: 'Go back',
    userLoading: 'Identifying you…',
    opensNewTab: '(opens in a new tab)',
    // the access list ([data-psz-access])
    accessBack: 'Back',
    accessLoading: 'Loading your areas…',
    accessLoadError: 'The access list couldn’t be loaded. Try again in a moment.',
    accessNoUser: 'Your account couldn’t be identified, so your areas can’t be loaded.',
    accessEmptyTitle: 'No areas assigned',
    accessEmptyMessage: 'There are no areas assigned to you.',
    accessNoEmployees: 'No employees are listed for this area.',
    accessCount: '{n} employee(s)',
    accessExpandAll: 'Expand all',
    accessCollapseAll: 'Collapse all',
    accessMore: 'Only part of the list could be shown. Contact Physical Security for the full list.',
    accessPartialTitle: 'Your areas couldn’t all be loaded',
    accessPartialMessage: 'Only part of your assigned areas could be read, and none of them can be shown. Contact Physical Security for your access list.'
  };

  /* French defaults (form.languages includes "fr"). Same keys as above;
     a form's own strings override either set. */
  var DEFAULT_STRINGS_FR = {
    next: 'Suivant', back: 'Précédent', submit: 'Soumettre', submitting: 'Envoi en cours…',
    requiredField: 'Ce champ est obligatoire.',
    invalidEmail: 'Entrez une adresse courriel valide (nom@exemple.com).',
    invalidPhone: 'Entrez un numéro de téléphone valide.',
    invalidUrl: 'Entrez une adresse Web valide commençant par http:// ou https://.',
    invalidNumber: 'Entrez un nombre.',
    numberInteger: 'Entrez un nombre entier.',
    numberMin: 'La valeur doit être d’au moins {min}.',
    numberMax: 'La valeur ne doit pas dépasser {max}.',
    textMinLength: 'Entrez au moins {min} caractères.',
    textMaxLength: 'Entrez au plus {max} caractères.',
    patternMismatch: 'Le format ne correspond pas à celui attendu.',
    choiceRequired: 'Choisissez une option.',
    multiMin: 'Choisissez au moins {min} option(s).',
    multiMax: 'Choisissez au plus {max} option(s).',
    personRequired: 'Ajoutez au moins une personne.',
    personMax: 'Ajoutez au plus {max} personnes.',
    personPlaceholder: 'Tapez un nom ou une adresse courriel…',
    personSearching: 'Recherche dans l’annuaire…',
    personNoResults: 'Aucune personne correspondante.',
    personResolveFailed: 'Impossible de confirmer {name} dans l’annuaire. Retirez cette personne, puis ajoutez-la de nouveau.',
    dateAfter: 'La date doit être postérieure à {other}.',
    dateOnOrAfter: 'La date ne peut pas précéder {other}.',
    dateBefore: 'La date doit être antérieure à {other}.',
    dateOnOrBefore: 'La date ne peut pas dépasser {other}.',
    todayLabel: 'aujourd’hui',
    comboPlaceholder: 'Sélectionnez une option',
    comboPlaceholderMulti: 'Sélectionnez une ou plusieurs options',
    fillInPlaceholder: 'Ou entrez votre propre valeur…',
    fillInAdd: 'Ajouter',
    lookupLoading: 'Chargement des options…',
    lookupError: 'Impossible de charger les options de ce champ. Réessayez plus tard.',
    linkUrlPlaceholder: 'https://…',
    linkDescPlaceholder: 'Texte affiché (facultatif)',
    attachDrop: 'Glissez des fichiers ici ou cliquez pour parcourir',
    attachHint: '',
    attachTooLarge: '{name} dépasse la limite de {max} Mo.',
    attachTooMany: 'Vous pouvez joindre au plus {max} fichiers.',
    attachBadType: '{name} n’est pas un type de fichier accepté. Types acceptés : {types}.',
    attachRequired: 'Joignez au moins un fichier.',
    attachRemove: 'Retirer',
    attachDone: 'Téléversé',
    pageError: 'Corrigez les champs en surbrillance pour continuer.',
    submitFailed: 'Votre réponse n’a pas été soumise — rien n’a été enregistré. Réessayez dans un moment.',
    submitFailedDetail: 'Détails : {detail}',
    attachPartialTitle: 'Réponse enregistrée — pièces jointes incomplètes',
    attachPartial: 'Vos réponses ont été enregistrées, mais {n} pièce(s) jointe(s) n’ont pas pu être téléversée(s).',
    attachRetry: 'Réessayer les téléversements',
    attachSkip: 'Continuer sans elles',
    confirmTitle: 'Merci — votre réponse a été soumise.',
    promptTitle: 'Veuillez confirmer', promptOk: 'OK',
    redirectCountdown: 'Redirection dans {n} secondes…',
    redirectPaused: 'Copiez d’abord le lien; vous serez ensuite redirigé.',
    redirectNow: 'Y aller maintenant',
    copyBlocked: 'Votre navigateur n’a pas permis la copie automatique. Copiez le lien ci-dessous pour continuer.',
    copyLabel: 'Lien d’origine', copyButton: 'Copier le lien',
    confirmMessage: '',
    confirmAnother: 'Soumettre une autre réponse',
    configLoadError: 'Ce formulaire n’a pas pu être chargé. Si le problème persiste, communiquez avec le responsable du formulaire.',
    configLoadDetail: '(PS Zone Attestation : {detail})',
    noContext: 'Aucune connexion SharePoint n’a été trouvée sur cette page; le formulaire ne peut donc pas être soumis.',
    editModeNote: 'PS Zone Attestation — s’affiche en mode lecture. Configuration :',
    stepOf: 'Étape {n} de {total}',
    doctorTitle: 'Vérification de la configuration du formulaire',
    doctorOk: 'OK', doctorWarn: 'À vérifier', doctorError: 'Problème',
    assignLoading: 'Chargement des éléments qui vous sont attribués…',
    assignLoadError: 'Impossible de charger les éléments qui vous sont attribués. Réessayez dans un moment.',
    assignNoUser: 'Votre compte n’a pas pu être identifié; les éléments qui vous sont attribués ne peuvent donc pas être chargés.',
    assignRetry: 'Réessayer',
    assignRowRequired: 'Faites une sélection pour cette ligne.',
    assignRowConfirmRequired: 'Confirmez cette valeur ou choisissez-en une nouvelle.',
    assignAllRequired: 'Faites une sélection pour chaque ligne.',
    assignProgress: '{n} sur {total} terminé(s)',
    assignSomeDone: '{n} de vos éléments ont déjà été soumis et ne sont pas affichés.',
    assignClear: 'Effacer la sélection',
    savingTitle: 'Envoi en cours…',
    savingMessage: 'Veuillez patienter. Ne fermez pas cette page, ne l’actualisez pas et ne revenez pas en arrière avant la fin de l’envoi.',
    errorMailLink: 'Envoyer un courriel au responsable du formulaire au sujet de ce problème',
    errorMailSubject: 'Problème avec le formulaire : {title}',
    errorMailAsk: 'Que faisiez-vous quand le problème est survenu?',
    errorMailInfo: 'Renseignements de diagnostic (veuillez les laisser dans le courriel) :',
    assignSaved: 'Enregistré',
    assignCurrent: 'Valeur actuelle',
    assignConfirm: 'Je confirme que c’est exact',
    assignChange: 'Modifier',
    assignKeep: 'Conserver la valeur actuelle',
    assignNewPlaceholder: 'Sélectionnez une nouvelle valeur',
    assignConfirmed: 'Confirmé', assignChanged: 'Modifié', assignSelected: 'Sélectionné',
    assignEmptyTitle: 'Rien à remplir',
    assignEmptyMessage: 'Aucun élément ne vous est attribué pour le moment.',
    assignDoneTitle: 'Déjà soumis',
    assignDoneMessage: 'Vous avez déjà soumis une réponse pour tout ce qui vous est attribué.',
    rowsPartial: 'L’enregistrement de {n} ligne(s) sur {total} est confirmé; les autres ne le sont peut-être pas. Sélectionnez {submit} pour terminer — les lignes déjà enregistrées sont vérifiées, puis ignorées.',
    rowsFailed: 'Certaines lignes n’ont pas pu être enregistrées. Sélectionnez {submit} pour réessayer — les lignes déjà enregistrées sont vérifiées, puis ignorées.',
    assignMore: 'Seuls les {max} premiers éléments qui vous sont attribués sont affichés. Soumettez-les, puis rechargez la page pour voir les autres.',
    assignKeysMore: 'Plus de {max} réponses antérieures ont été trouvées; certains éléments auxquels vous avez déjà répondu pourraient donc réapparaître.',
    submitConfirmTitle: 'Veuillez confirmer', submitConfirmOk: 'Confirmer', submitConfirmCancel: 'Revenir',
    userLoading: 'Identification en cours…',
    opensNewTab: '(s’ouvre dans un nouvel onglet)',
    accessBack: 'Retour',
    accessLoading: 'Chargement de vos emplacements…',
    accessLoadError: 'Impossible de charger la liste des accès. Réessayez dans un moment.',
    accessNoUser: 'Votre compte n’a pas pu être identifié; vos emplacements ne peuvent donc pas être chargés.',
    accessEmptyTitle: 'Aucun emplacement attribué',
    accessEmptyMessage: 'Aucun emplacement ne vous est attribué.',
    accessNoEmployees: 'Aucun employé n’est inscrit pour cet emplacement.',
    accessCount: '{n} employé(s)',
    accessExpandAll: 'Tout développer',
    accessCollapseAll: 'Tout réduire',
    accessMore: 'Seule une partie de la liste a pu être affichée. Communiquez avec la sécurité physique pour obtenir la liste complète.',
    accessPartialTitle: 'Vos emplacements n’ont pas tous pu être chargés',
    accessPartialMessage: 'Seule une partie des emplacements qui vous sont attribués a pu être lue, et aucun ne peut être affiché. Communiquez avec la sécurité physique pour obtenir votre liste des accès.'
  };

  /* ------------------------------------------------------------------
     Bilingual configs (form.languages: ["en", "fr"]). Any author string
     may be an { "en": "…", "fr": "…" } pair; localize() resolves every
     pair to the active language before normalizing, falling back to
     English for a missing or empty translation (the intl library's rule).
     The language itself comes from the bilingual library (window.intl,
     bilingual/intl.js), which the engine loads for such forms; on
     intl.setLang() the form re-renders in place, keeping its state.
     ------------------------------------------------------------------ */
  var LANGS = ['en', 'fr'];
  function isLangPair(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    var keys = Object.keys(o);
    return keys.length > 0 && keys.every(function (k) {
      return LANGS.indexOf(k) > -1 && (o[k] == null || typeof o[k] === 'string');
    });
  }
  function localize(v, lang) {
    if (Array.isArray(v)) return v.map(function (x) { return localize(x, lang); });
    if (isLangPair(v)) return (v[lang] != null && v[lang] !== '') ? v[lang] : (v.en != null ? v.en : '');
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).forEach(function (k) {
        // an own "__proto__" key from JSON stays plain data
        Object.defineProperty(out, k, { value: localize(v[k], lang), enumerable: true, writable: true, configurable: true });
      });
      return out;
    }
    return v;
  }
  function formLangs(raw) {
    var l = raw && raw.form && raw.form.languages;
    return Array.isArray(l) && l.length ? l : null;
  }
  function activeLang(raw) {
    var langs = formLangs(raw) || ['en'];
    var cur = window.intl && typeof window.intl.getLang === 'function' ? window.intl.getLang() : null;
    if (langs.indexOf(cur) > -1) return cur;
    return LANGS.indexOf(langs[0]) > -1 ? langs[0] : 'en';
  }

  /* ------------------------------------------------------------------
     Asset loading — idempotent; every injected element carries a
     data-psz marker so re-evaluation never duplicates anything.
     ------------------------------------------------------------------ */
  function canonicalUrl(u) {
    try { return new URL(u, document.baseURI).href; } catch (e) { return u; }
  }
  function ensureCss(href, key) {
    if (document.querySelector('link[data-psz-css="' + key + '"]')) return;
    // dedupe by canonical URL (query-stripped), never by basename — an
    // unrelated stylesheet that happens to be called components.css must
    // not suppress the real one
    var wanted = canonicalUrl(href.split('?')[0]);
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var lh = (links[i].getAttribute('href') || '').split('?')[0];
      if (lh && canonicalUrl(lh) === wanted) return;
    }
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-psz-css', key);
    document.head.appendChild(l);
  }
  function ensureStyles() {
    ensureCss(designBase + 'colors_and_type.css', 'tokens');
    ensureCss(designBase + 'components.css', 'components');
    ensureCss(engineBase + 'ps-zone-attestation.css' +(engineVer ? '?v=' + engineVer : ''), 'psz');
  }

  var spritePromise = null;
  function ensureSprite() {
    if (document.getElementById('ic-fluent-checkmark-24-regular')) return Promise.resolve();
    if (spritePromise) return spritePromise;
    spritePromise = fetch(designBase + 'fluent-basic-icons.svg', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('sprite HTTP ' + r.status); return r.text(); })
      .then(function (text) {
        if (document.getElementById('ic-fluent-checkmark-24-regular')) return;
        // A live-reload dev server (VS Code Live Server) injects its script
        // into .svg files before EVERY "</svg>", including the example one
        // inside this sprite's header comment. The injected "<!-- … -->"
        // then ends that comment early, the example's </svg> closes the root
        // svg, and every symbol falls outside it: no icons. Strip it.
        text = String(text).replace(/<!-- Code injected by live-server -->\s*<script[\s\S]*?<\/script>/gi, '');
        var box = document.createElement('div');
        box.innerHTML = text;
        var svg = box.querySelector('svg');
        if (!svg) throw new Error('sprite parse failed');
        if (!svg.querySelector('symbol')) {
          console.warn('[PS Zone Form] icon sprite parsed without any icons. Is something (a dev server, a proxy) rewriting .svg files?');
        }
        svg.style.display = 'none';
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('data-psz', 'sprite');
        document.body.insertBefore(svg, document.body.firstChild);
      })
      .catch(function (e) { console.warn('[PS Zone Form] icon sprite unavailable:', e); });
    return spritePromise;
  }

  var scriptPromises = {};
  // hideAmd: modern SharePoint pages run an AMD loader, so a UMD bundle
  // injected late registers as an anonymous AMD module and never sets its
  // global (window.pnp stays undefined). Hide define.amd — not define
  // itself — for the load, and restore it on success AND failure.
  function loadScript(url, key, hideAmd) {
    if (scriptPromises[key]) return scriptPromises[key];
    scriptPromises[key] = new Promise(function (resolve, reject) {
      var amd = null;
      if (hideAmd && typeof window.define === 'function' && window.define.amd) {
        amd = window.define.amd;
        try { delete window.define.amd; } catch (e) { window.define.amd = undefined; }
      }
      function restore() { if (amd) { window.define.amd = amd; amd = null; } }
      var s = document.createElement('script');
      s.src = url;
      if (hostNonce) s.nonce = hostNonce;
      s.setAttribute('data-psz-script', key);
      s.onload = function () { restore(); resolve(); };
      s.onerror = function () { restore(); delete scriptPromises[key]; reject(new Error('Failed to load ' + url)); };
      document.head.appendChild(s);
    });
    return scriptPromises[key];
  }
  function whenPnp() {
    if (settings.mockSp) return Promise.resolve();
    if (window.pnp && window.pnp.sp) return Promise.resolve();
    return loadScript(pnpUrl, 'pnp', true).then(function () {
      if (!(window.pnp && window.pnp.sp)) throw new Error('pnpjs bundle loaded but window.pnp.sp is missing');
    });
  }
  function whenAlpine() {
    if (window.Alpine) return Promise.resolve();
    return loadScript(alpineUrl, 'alpine');
  }
  // the bilingual library, for forms that declare form.languages. A page
  // may already load it (its own strings.js etc.); otherwise it comes from
  // the shared lib folder. If it can't load, the form still renders, in
  // its first language.
  function whenIntl(raw) {
    var langs = formLangs(raw);
    if (!langs || langs.length < 2 || window.intl) return Promise.resolve();
    return loadScript(intlUrl, 'intl').catch(function (e) {
      console.warn('[PS Zone Form] intl.js unavailable — showing the form in "' + langs[0] + '":', e);
    });
  }
  var intlWired = false;
  function wireIntl() {
    if (intlWired || !window.intl || typeof window.intl.onChange !== 'function') return;
    intlWired = true;
    window.intl.onChange(function () {
      Object.keys(NS._defs).forEach(function (uid) { relocalize(NS._defs[uid]); });
      Object.keys(NS._res).forEach(function (uid) { relocalizeResources(NS._res[uid]); });
      Object.keys(NS._acc).forEach(function (uid) { relocalizeAccess(NS._acc[uid]); });
    });
  }

  /* ------------------------------------------------------------------
     SharePoint page context + user
     ------------------------------------------------------------------ */
  function probeContexts() {
    var out = [];
    [window, window.parent, window.top].forEach(function (w) {
      try { if (w && w.location.href && w._spPageContextInfo) out.push(w._spPageContextInfo); } catch (e) { /* cross-origin — expected */ }
    });
    return out;
  }
  function getPageWebUrl() {
    if (settings.webUrl) return settings.webUrl;
    var ctxs = probeContexts();
    return ctxs.length ? ctxs[0].webAbsoluteUrl : null;
  }
  // Modern pages don't reliably expose _spPageContextInfo (the custom-script
  // web part only injects it when its toggle is on). Without it, find the
  // page's web over REST: try <path>/_api/web from the page's folder upward —
  // a folder that isn't a web answers 404, so the first hit is the deepest
  // web holding the page. Resolved once per page and shared by every mount.
  var restUser = null;
  var pageWebPromise = null;
  function resolvePageWeb() {
    var known = getPageWebUrl();
    if (known) return Promise.resolve(known);
    if (pageWebPromise) return pageWebPromise;
    var parts = location.pathname.split('/').slice(1, -1); // drop the leading '' and the page file
    var cands = [];
    for (var n = parts.length; n >= 0; n--) cands.push('/' + parts.slice(0, n).join('/'));
    var opts = { credentials: 'same-origin', headers: { accept: 'application/json;odata=nometadata' } };
    function tryAt(i) {
      if (i >= cands.length) return Promise.resolve(null);
      var base = location.origin + cands[i].replace(/\/$/, '');
      return fetch(base + '/_api/web?$select=Url', opts)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (j) { return j && j.Url ? j.Url : tryAt(i + 1); });
    }
    pageWebPromise = tryAt(0).then(function (url) {
      if (!url) { pageWebPromise = null; return null; } // retryable
      return fetch(url + '/_api/web/currentuser?$select=Title,Email,LoginName', opts)
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (u) {
          if (u) restUser = { name: u.Title || '', email: u.Email || '', login: u.LoginName || '' };
          return url;
        });
    });
    return pageWebPromise;
  }
  function getUserInfo() {
    if (settings.mockSp && settings.mockSp.userInfo) return settings.mockSp.userInfo();
    var ctxs = probeContexts();
    if (!ctxs.length && restUser) return restUser;
    var c = ctxs[0] || {};
    return { name: c.userDisplayName || '', email: c.userEmail || '', login: c.userLoginName || '' };
  }
  // every address a user's rows may be keyed by: the profile email, plus
  // the UPN from the claims login (they differ for some accounts).
  // Lower-cased and de-duplicated; SharePoint compares text case-blind anyway.
  function userEmails(u) {
    var out = [];
    [u && u.email, u && u.login && String(u.login).split('|').pop()].forEach(function (a) {
      a = String(a || '').trim().toLowerCase();
      if (a.indexOf('@') > 0 && out.indexOf(a) < 0) out.push(a);
    });
    return out;
  }
  function absUrl(u) {
    if (!u) return u;
    if (/^https?:/i.test(u)) return u;
    if (u.charAt(0) === '/') return location.origin + u;
    return u;
  }
  function resolveAsset(p) {
    // config asset paths ("abacus-icons/x.svg") resolve against the deployed
    // design-system folder; absolute urls/paths pass through untouched.
    if (!p) return p;
    if (/^https?:/i.test(p) || p.charAt(0) === '/') return p;
    return designBase + p;
  }

  /* ------------------------------------------------------------------
     Error log — the config's errorLog { siteUrl?, listTitle } names a
     list; a failure the user hits (init, loading their areas, saving)
     adds one item there, and a SharePoint list rule on that list emails
     the admin (docs/02-sharepoint-data.md). Plain REST with a digest, NOT
     pnpjs: a pnp bundle that failed to load is itself worth reporting.
     Fire-and-forget: a report never throws, never blocks the form, and a
     failed report only warns in the console. At most one report per kind
     and ERRLOG_MAX per page load, so a broken list can't flood the inbox.
     The mock twin is settings.mockSp.logError (dev/mock-sp.js).
     ------------------------------------------------------------------ */
  var ERRLOG_MAX = 5;
  var errLogSent = { count: 0, kinds: {} };
  var MAIL_RE = /^[^\s@<>"?&]+@[^\s@<>"?&]+\.[^\s@<>"?&]+$/;
  // the same diagnostic lines go to the error list and into the email body
  function diagLines(kind, err, extra, lang) {
    var u = {};
    try { u = getUserInfo() || {}; } catch (e) { /* no user yet */ }
    var lines = [
      'error: ' + kind + ': ' + String(err && err.message ? err.message : err || 'unknown error'),
      'when: ' + new Date().toISOString(),
      'user: ' + (u.email || userEmails(u)[0] || '(unknown)'),
      'page: ' + location.href,
      'engine: ' + VERSION + (lang ? ' (' + lang + ')' : ''),
      'browser: ' + navigator.userAgent
    ];
    Object.keys(extra || {}).forEach(function (k) { lines.push(k + ': ' + extra[k]); });
    return lines;
  }
  /* The "email the administrator" link shown with an error (config
     errorContact { email, subject }): a mailto with the configured subject
     and a body that asks what the user was doing, then the diagnostic
     lines. '' when there's no (valid) contact. Kept under ~1800 characters:
     some mail clients cut longer mailto links. */
  function errorMailHref(contact, title, S, kind, err, extra, lang) {
    var email = contact && String(contact.email || '').trim();
    if (!email || !MAIL_RE.test(email)) return '';
    var subject = contact.subject || fmtStr(S.errorMailSubject, { title: title || '' });
    var body = [S.errorMailAsk, '', '', '', S.errorMailInfo].concat(diagLines(kind, err, extra, lang)).join('\r\n');
    if (body.length > 1500) body = body.slice(0, 1500) + '…';
    return 'mailto:' + email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }
  function logErrorItem(spec, item) {
    if (settings.mockSp) return settings.mockSp.logError ? settings.mockSp.logError(spec, item) : Promise.resolve();
    var web = absUrl(spec.siteUrl || '') || getPageWebUrl() || '';
    if (!web) return resolvePageWeb().then(function (u) { if (!u) throw new Error('no-context'); return logErrorItem({ siteUrl: u, listTitle: spec.listTitle }, item); });
    web = web.replace(/\/$/, '');
    var J = 'application/json;odata=nometadata';
    return fetch(web + '/_api/contextinfo', { method: 'POST', credentials: 'same-origin', headers: { accept: J } })
      .then(function (r) { if (!r.ok) throw new Error('contextinfo HTTP ' + r.status); return r.json(); })
      .then(function (ci) {
        // odata=nometadata: SharePoint uses the list's own item type (no
        // __metadata, none of pnp's cached-type trouble)
        return fetch(web + "/_api/web/lists/getbytitle('" + encodeURIComponent(String(spec.listTitle).replace(/'/g, "''")) + "')/items", {
          method: 'POST', credentials: 'same-origin',
          headers: { accept: J, 'content-type': J, 'X-RequestDigest': ci.FormDigestValue },
          body: JSON.stringify(item)
        });
      })
      .then(function (r) { if (!r.ok) throw new Error('error log HTTP ' + r.status); });
  }
  // kind: 'init' | 'load' | 'save'. extra: plain { label: value } lines for Detail.
  function reportError(errorLog, kind, err, extra) {
    if (!errorLog || !errorLog.listTitle) return;
    if (errLogSent.kinds[kind] || errLogSent.count >= ERRLOG_MAX) return;
    errLogSent.kinds[kind] = true;
    errLogSent.count++;
    var msg = String(err && err.message ? err.message : err || 'unknown error');
    var u = {};
    try { u = getUserInfo() || {}; } catch (e) { /* no user yet */ }
    var lines = diagLines(kind, err, extra);
    var item = {
      Title: ('[' + kind + '] ' + msg).slice(0, 255),
      ErrorKind: kind,
      Message: msg.slice(0, 4000),
      Detail: lines.join('\n').slice(0, 4000),
      UserEmail: (u.email || userEmails(u)[0] || '').slice(0, 255),
      EngineVersion: VERSION
    };
    try {
      Promise.resolve(logErrorItem(errorLog, item)).catch(function (e) {
        console.warn('[PS Zone Form] error log write failed (the error itself is above):', e);
      });
    } catch (e) { console.warn('[PS Zone Form] error log write failed:', e); }
  }

  /* ------------------------------------------------------------------
     SP adapter — one seam over pnpjs v2, replaceable by a mock.
     The mock (dev/mock-sp.js) implements the same method names.
     ------------------------------------------------------------------ */
  function makeAdapter(cfg) {
    if (settings.mockSp) return settings.mockSp;

    var pageWeb = getPageWebUrl();
    var targetWeb = cfg.target.siteUrl ? absUrl(cfg.target.siteUrl) : pageWeb;

    function requireCtx() {
      if (!targetWeb) throw new Error('no-context');
    }
    // target.listUrl: server-relative ("/sites/x/Lists/My List") or relative
    // to the target web ("Lists/My List"). Survives a list being renamed.
    function listServerRelUrl(u, webUrl) {
      if (u.charAt(0) === '/') return u;
      var w = webUrl || targetWeb;
      var base = w ? new URL(w, location.origin).pathname.replace(/\/$/, '') : '';
      return base + '/' + u.replace(/^\.?\//, '');
    }
    // any list by { siteUrl?, listUrl | listTitle } — same routing as the target list
    function listOf(spec) {
      var webUrl = spec.siteUrl ? absUrl(spec.siteUrl) : targetWeb;
      var w = spec.siteUrl ? web(webUrl) : web();
      return spec.listUrl ? w.getList(listServerRelUrl(spec.listUrl, webUrl)) : w.lists.getByTitle(spec.listTitle);
    }
    // OData string literal: a single quote is doubled (same rule as the
    // dcspad SPUtils esc helper)
    function odataStr(v) { return String(v).replace(/'/g, "''"); }
    function userFilter(col, emails) {
      return emails.map(function (e) { return col + " eq '" + odataStr(e) + "'"; }).join(' or ');
    }
    // pnp loaded + page web known (resolved over REST when the page has no
    // _spPageContextInfo). Every SharePoint call goes through this.
    function whenCtx() {
      return whenPnp().then(resolvePageWeb).then(function (url) {
        if (url) {
          pageWeb = pageWeb || url;
          targetWeb = targetWeb || url;
        }
        requireCtx();
      });
    }
    function setupFor(url) {
      // pnpjs v2 setup is global; re-assert the base before operations so
      // two forms targeting different webs on one page stay correct.
      window.pnp.sp.setup({ sp: { baseUrl: url } });
    }
    function web(url) {
      var p = window.pnp;
      var target = url || targetWeb;
      if (typeof p.Web === 'function') return p.Web(target);
      setupFor(target);
      return p.sp.web;
    }
    function list() {
      var w = web();
      if (cfg.target.listId) return w.lists.getById(cfg.target.listId);
      if (cfg.target.listUrl) return w.getList(listServerRelUrl(cfg.target.listUrl));
      return w.lists.getByTitle(cfg.target.listTitle);
    }
    // items.add without a type name looks it up through pnp's 5-day
    // localStorage cache, keyed by the list's RELATIVE url (this bundle has
    // no pnp.Web): same-titled lists on two webs share one entry tenant-wide,
    // and the add fails with "A type named SP.Data.… could not be resolved".
    // Ask the target list itself, uncached, once per adapter.
    var entityType = null;
    function listEntityType() {
      if (entityType) return Promise.resolve(entityType);
      return list().select('ListItemEntityTypeFullName').get().then(function (r) {
        entityType = r.ListItemEntityTypeFullName;
        return entityType;
      });
    }

    return {
      isMock: false,
      webUrl: function () { return targetWeb; },
      ready: function () {
        return whenCtx().then(function () {
          setupFor(targetWeb);
        });
      },
      userInfo: getUserInfo,
      searchPeople: function (q, max) {
        return whenCtx().then(function () {
          setupFor(pageWeb || targetWeb);
          return window.pnp.sp.profiles.clientPeoplePickerSearchUser({
            AllowEmailAddresses: false,
            AllowMultipleEntities: false,
            MaximumEntitySuggestions: max || 8,
            PrincipalSource: 15,   // all sources
            PrincipalType: 1,      // users only — no DLs, security/SP groups
            QueryString: q
          });
        }).then(function (entities) {
          return (entities || [])
            .filter(function (e) {
              if (e.EntityType && e.EntityType !== 'User') return false;
              if (e.IsResolved === false) return false;
              var mail = e.EntityData && (e.EntityData.Email || e.EntityData.SPUserID) ? e.EntityData.Email : (e.Description || '');
              // best-effort exclusion of system/room/service principals:
              // they typically resolve without a usable email.
              return !!mail;
            })
            .map(function (e) {
              return {
                key: e.Key,
                text: e.DisplayText,
                email: (e.EntityData && e.EntityData.Email) || e.Description || '',
                id: null
              };
            });
        });
      },
      ensureUser: function (key) {
        return whenCtx().then(function () {
          return web().ensureUser(key);
        }).then(function (r) { return r.data.Id; });
      },
      addItem: function (payload) {
        return whenCtx().then(listEntityType).then(function (type) {
          return list().items.add(payload, type);
        }).then(function (r) { return { id: r.data.Id, item: r.item }; });
      },
      addAttachment: function (itemRef, name, file) {
        return itemRef.attachmentFiles.add(name, file);
      },
      // first row where matchColumn equals value (SharePoint compares text
      // case-insensitively); returns returnColumn as a string — a Hyperlink
      // column's { Url } or a plain text value — or null
      lookupValue: function (lk) {
        return whenCtx().then(function () {
          return listOf(lk).items
            .select(lk.returnColumn)
            .filter(lk.matchColumn + " eq '" + odataStr(lk.value) + "'")
            .top(1)
            .get();
        }).then(function (rows) {
          var v = rows && rows[0] ? rows[0][lk.returnColumn] : null;
          if (v && typeof v === 'object') v = v.Url;
          return v ? String(v) : null;
        });
      },
      // assignments: the source rows whose userColumn holds one of the
      // user's addresses. { rows: [{ ID, …columns }], more: bool } — one
      // extra row is asked for, so a cut-off list is reported, never silent.
      getAssignments: function (src, emails) {
        var max = src.top || 500;
        return whenCtx().then(function () {
          var items = listOf(src).items;
          items = items.select.apply(items, ['Id'].concat(src._cols));
          return items.filter(userFilter(src.userColumn, emails))
            .orderBy(src.orderBy || src.labelColumn, true)
            .top(max + 1)
            .get();
        }).then(function (rows) {
          rows = rows || [];
          return {
            more: rows.length > max,
            rows: rows.slice(0, max).map(function (it) {
              var o = { ID: it.Id };
              src._cols.forEach(function (c) { o[c] = it[c] == null ? '' : it[c]; });
              return o;
            })
          };
        });
      },
      // the access list ([data-psz-access]): the rows whose areaColumn is one
      // of these area names, as { rows: [{ area, name, email }], more }.
      // Chunks of 20 areas keep the URL short; more = a chunk hit its cap.
      // On a list past 5,000 items areaColumn must be indexed.
      getAccess: function (spec, areas) {
        var max = Math.min(spec.top || 2000, 4999);
        var chunks = [];
        for (var i = 0; i < areas.length; i += 20) chunks.push(areas.slice(i, i + 20));
        return whenCtx().then(function () {
          return Promise.all(chunks.map(function (part) {
            return listOf(spec).items
              .select(spec.areaColumn, spec.nameColumn, spec.emailColumn)
              .filter(part.map(function (a) { return spec.areaColumn + " eq '" + odataStr(a) + "'"; }).join(' or '))
              .top(max + 1)
              .get();
          }));
        }).then(function (pages) {
          var more = false, rows = [];
          pages.forEach(function (p) {
            p = p || [];
            if (p.length > max) more = true;
            p.slice(0, max).forEach(function (it) {
              rows.push({
                area: String(it[spec.areaColumn] == null ? '' : it[spec.areaColumn]),
                name: String(it[spec.nameColumn] == null ? '' : it[spec.nameColumn]),
                email: String(it[spec.emailColumn] == null ? '' : it[spec.emailColumn])
              });
            });
          });
          return { rows: rows, more: more };
        });
      },
      // keyColumn values of the rows this user already saved to the target
      // list (assignments.responses) — those source rows aren't shown again.
      // { keys: [string], more: bool } — more = the read hit its cap.
      getRowKeys: function (rk, emails) {
        var max = ROW_KEYS_MAX;
        return whenCtx().then(function () {
          return list().items.select(rk.keyColumn)
            .filter(userFilter(rk.userColumn, emails))
            .top(max + 1)
            .get();
        }).then(function (rows) {
          rows = rows || [];
          return {
            more: rows.length > max,
            keys: rows.slice(0, max).map(function (r) { return r[rk.keyColumn]; })
              .filter(function (v) { return v != null && v !== ''; }).map(String)
          };
        });
      },
      // which of these keys this user already has in the target list — an
      // exact check for a handful of rows (the retry after a failed save), so
      // ROW_KEYS_MAX never applies. A number is sent as a number literal (a
      // Number column rejects a quoted one); chunks keep the URL short.
      getRowKeysFor: function (rk, emails, values) {
        var chunks = [];
        for (var i = 0; i < values.length; i += 20) chunks.push(values.slice(i, i + 20));
        return whenCtx().then(function () {
          return Promise.all(chunks.map(function (part) {
            var keys = part.map(function (v) {
              return rk.keyColumn + ' eq ' + (typeof v === 'number' ? v : "'" + odataStr(v) + "'");
            }).join(' or ');
            return list().items.select(rk.keyColumn)
              .filter('(' + userFilter(rk.userColumn, emails) + ') and (' + keys + ')')
              .top(part.length * 10)
              .get();
          }));
        }).then(function (pages) {
          var out = [];
          pages.forEach(function (rows) {
            (rows || []).forEach(function (r) { if (r[rk.keyColumn] != null) out.push(String(r[rk.keyColumn])); });
          });
          return out;
        });
      },
      getListFields: function (spec) {
        return whenCtx().then(function () {
          return (spec ? listOf(spec) : list()).fields
            .select('InternalName', 'Title', 'TypeAsString', 'Required', 'ReadOnlyField', 'Hidden', 'RichText')
            .filter('Hidden eq false')
            .get();
        });
      },
      getLookupItems: function (lk) {
        var display = lk.displayField || 'Title';
        return whenCtx().then(function () {
          var w = lk.siteUrl ? web(absUrl(lk.siteUrl)) : web();
          return w.lists.getByTitle(lk.listTitle).items
            .select('Id', display)
            .orderBy(display, true)
            .top(lk.top || 500)
            .get();
        }).then(function (items) {
          return (items || []).map(function (it) { return { id: it.Id, text: String(it[display] == null ? it.Id : it[display]) }; });
        });
      }
    };
  }

  /* ------------------------------------------------------------------
     Config normalization + structural validation
     ------------------------------------------------------------------ */
  var TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'currency', 'choice',
    'multichoice', 'boolean', 'date', 'person', 'link', 'lookup', 'heading', 'note', 'hidden',
    'assignments', 'currentUser'];
  // display-only types: no value, no validation, no column
  var STATIC_TYPES = { heading: 1, note: 1, currentUser: 1 };
  var TINTS = ['sky', 'blue', 'neutral'];

  /* Values from the page URL (field.query). Parameter names match
     case-insensitively; URLSearchParams decodes the value, so an encoded
     link/name arrives as its plain text. field.normalize then trims it:
     keep "alnum" (a-z, 0-9 only), case "lower"/"upper", maxLength. */
  function readQuery(name) {
    var want = String(name).toLowerCase(), found = null;
    try {
      new URLSearchParams(location.search).forEach(function (v, k) {
        if (found === null && k.toLowerCase() === want) found = v;
      });
    } catch (e) { /* no URLSearchParams: treat as absent */ }
    return found;
  }
  function normalizeVal(v, n) {
    var s = String(v == null ? '' : v).trim();
    if (!n) return s;
    if (n.keep === 'alnum') s = s.replace(/[^A-Za-z0-9]/g, '');
    if (n.case === 'lower') s = s.toLowerCase();
    else if (n.case === 'upper') s = s.toUpperCase();
    if (n.maxLength > 0) s = s.slice(0, n.maxLength);
    return s;
  }
  // only http(s) and server-relative targets leave the form as a link/redirect
  function safeHref(u) {
    var s = String(u == null ? '' : u).trim();
    return /^https?:\/\/[^\s]+$/i.test(s) || /^\/(?!\/)[^\s]*$/.test(s) ? s : '';
  }
  var PILL_CYCLE = ['blue', 'green', 'lavender', 'orange', 'teal', 'berry', 'yellow', 'sky', 'red', 'gray'];

  /* assignments: one row per source-list item keyed to the current user,
     one choice per row; the form saves one target item per row. */
  function isIdCol(c) { return c === 'ID' || c === 'Id'; }
  // one read of the user's earlier responses (a list view page)
  var ROW_KEYS_MAX = 5000;
  function normalizeAssignments(f, errors) {
    var where = 'field "' + f.id + '"';
    var src = f.source = Object.assign({}, f.source || {});
    if (!src.listTitle && !src.listUrl) errors.push(where + ': source.listTitle or source.listUrl is required');
    if (!src.userColumn) errors.push(where + ': source.userColumn is required');
    if (!src.labelColumn) errors.push(where + ': source.labelColumn is required');
    if (!f.column) errors.push(where + ': column (where each row\'s choice is saved) is required');
    f.rowColumns = (f.rowColumns && typeof f.rowColumns === 'object') ? f.rowColumns : {};
    // currentColumn: each row's value as it stands. The row then offers
    // "confirm" or "change"; previousColumn / changedColumn record which.
    if ((f.previousColumn || f.changedColumn) && !src.currentColumn) {
      errors.push(where + ': previousColumn / changedColumn need source.currentColumn');
    }
    // every target column a row writes must be distinct, or one silently
    // overwrites another (e.g. previousColumn = column saves the old value)
    var targets = Object.create(null);
    [['column', f.column], ['previousColumn', f.previousColumn], ['changedColumn', f.changedColumn]]
      .concat(Object.keys(f.rowColumns || {}).map(function (c) { return ['rowColumns', c]; }))
      .forEach(function (p) {
        if (!p[1]) return;
        if (targets[p[1]]) errors.push(where + ': target column "' + p[1] + '" is used by both ' + targets[p[1]] + ' and ' + p[0]);
        else targets[p[1]] = p[0];
      });
    // every source column the rows need: label, detail, current, and what rowColumns copies
    var cols = [];
    [src.labelColumn, src.detailColumn, src.currentColumn].concat(Object.keys(f.rowColumns).map(function (k) { return f.rowColumns[k]; }))
      .forEach(function (c) { if (c && !isIdCol(c) && cols.indexOf(c) < 0) cols.push(c); });
    src._cols = cols;
    var rs = f.responses;
    if (rs != null) {
      if (!rs.userColumn || !rs.keyColumn) errors.push(where + ': responses needs userColumn and keyColumn');
      else if (!f.rowColumns[rs.keyColumn]) {
        errors.push(where + ': responses.keyColumn "' + rs.keyColumn + '" must be a rowColumns target (e.g. "' + rs.keyColumn + '": "ID")');
      }
    }
  }

  function normalizeConfig(raw, lang) {
    var errors = [];
    lang = lang || 'en';
    var langs = formLangs(raw);
    if (raw && raw.form && raw.form.languages != null &&
        (!langs || !langs.every(function (l) { return LANGS.indexOf(l) > -1; }))) {
      errors.push('form.languages must be a non-empty array of "en" / "fr"');
    }
    var cfg = localize(JSON.parse(JSON.stringify(raw || {})), lang);
    cfg._lang = lang;
    cfg._multiLang = !!langs && langs.length > 1;

    cfg.form = cfg.form || {};
    // a page may override form.vars (PSZ_FORM_SETTINGS.vars), e.g. a page
    // URL that differs between the dev harness, dev and prod
    if (settings.vars && typeof settings.vars === 'object') cfg.form.vars = Object.assign({}, cfg.form.vars || {}, settings.vars);
    cfg.form.appearance = Object.assign(
      { frame: 'card', header: 'band', tint: 'sky', icon: null },
      cfg.form.appearance || {});
    cfg.strings = Object.assign({}, DEFAULT_STRINGS, lang === 'fr' ? DEFAULT_STRINGS_FR : {}, cfg.strings || {});
    var hc = cfg.form.headerCard;
    if (hc != null && (typeof hc !== 'object' || !hc.title || !hc.url)) {
      errors.push('form.headerCard needs title and url');
    }
    var sc = cfg.submitConfirm;
    if (sc != null && (typeof sc !== 'object' || !sc.message)) errors.push('submitConfirm needs a message');
    // business calendar for withinBusinessDays rules and date prompts
    var bhRaw = cfg.form.businessHours;
    cfg._bh = null;
    if (bhRaw) {
      var bh = {
        timeZone: bhRaw.timeZone,
        days: Array.isArray(bhRaw.days) ? bhRaw.days : [1, 2, 3, 4, 5],
        dateAt: bhRaw.dateAt || 'end',
        _start: hhmm(bhRaw.start || '09:00'), _end: hhmm(bhRaw.end || '17:00')
      };
      if (!bh.timeZone) errors.push('form.businessHours.timeZone is required (e.g. "America/Toronto")');
      else {
        try { new Intl.DateTimeFormat('en-US', { timeZone: bh.timeZone }); }
        catch (e) { errors.push('form.businessHours.timeZone "' + bh.timeZone + '" is not a valid time zone'); }
      }
      if (bh._start == null || bh._end == null || bh._end <= bh._start) {
        errors.push('form.businessHours start/end must be "HH:MM" with end after start');
      }
      if (bh.dateAt !== 'end' && bh.dateAt !== 'start') errors.push('form.businessHours.dateAt must be "end" or "start"');
      cfg._bh = bh;
    }
    cfg.target = cfg.target || {};
    if (!cfg.target.listTitle && !cfg.target.listId && !cfg.target.listUrl) {
      errors.push('target.listTitle, target.listUrl or target.listId is required');
    }
    if (cfg.errorLog != null && (typeof cfg.errorLog !== 'object' || !cfg.errorLog.listTitle)) {
      errors.push('errorLog needs a listTitle (and optionally siteUrl)');
    }
    if (cfg.errorContact != null && (typeof cfg.errorContact !== 'object' || !MAIL_RE.test(String(cfg.errorContact.email || '')))) {
      errors.push('errorContact needs an email address (and optionally a subject)');
    }
    cfg.confirmation = Object.assign({ title: null, message: null, allowAnother: true }, cfg.confirmation || {});
    cfg.attachments = Object.assign({
      enabled: false, required: false, label: 'Attachments', hint: '',
      maxFiles: 10, maxFileSizeMb: 10, accept: null, page: null
    }, cfg.attachments || {});

    if (!Array.isArray(cfg.pages) || !cfg.pages.length) errors.push('pages must be a non-empty array');
    cfg.pages = cfg.pages || [];

    // null-prototype maps: field/section ids are author-supplied, so keys
    // like "constructor" must be plain data, not inherited properties
    var byKey = Object.create(null), ordered = [], keyOfId = Object.create(null);
    var sectionsById = Object.create(null);
    cfg.pages.forEach(function (pg, pi) {
      pg.id = pg.id || ('page' + (pi + 1));
      pg.sections = Array.isArray(pg.sections) ? pg.sections : [];
      if (!pg.sections.length) errors.push('page "' + pg.id + '" has no sections');
      pg.sections.forEach(function (sec, si) {
        sec.id = sec.id || (pg.id + '_s' + (si + 1));
        sec._page = pi;
        if (sectionsById[sec.id]) errors.push('duplicate section id "' + sec.id + '"');
        else sectionsById[sec.id] = sec;
        sec.fields = Array.isArray(sec.fields) ? sec.fields : [];
        if (sec.columns != null && sec.columns !== 1 && sec.columns !== 2) {
          errors.push('section "' + sec.id + '": columns must be 1 or 2');
        }
        if (sec.tint != null && TINTS.indexOf(sec.tint) < 0) {
          errors.push('section "' + sec.id + '": tint must be ' + TINTS.join(', '));
        }
        sec.fields.forEach(function (f, fi) {
          if (!f.id) { errors.push('field #' + (fi + 1) + ' in section "' + sec.id + '" is missing an id'); f.id = sec.id + '_f' + fi; }
          if (TYPES.indexOf(f.type) < 0) errors.push('field "' + f.id + '": unknown type "' + f.type + '"');
          if (f.span != null && f.span !== 'full') errors.push('field "' + f.id + '": span must be "full" (or omitted)');
          var k = safeKey(f.id);
          if (byKey[k]) errors.push('duplicate field id "' + f.id + '"');
          f.k = k; f.page = pi; f.section = sec.id;
          f.validation = f.validation || {};
          if (f.validation.pattern != null) {
            // compile once: a bad pattern is a config error, never a
            // silently-disabled rule
            try { f._pattern = new RegExp(f.validation.pattern); }
            catch (e) { errors.push('field "' + f.id + '": validation.pattern is invalid (' + e.message + ')'); }
          }
          if (f.type === 'choice' || f.type === 'multichoice' || f.type === 'assignments') {
            var ch = Array.isArray(f.choices) ? f.choices : [];
            if (!ch.length) errors.push('field "' + f.id + '": choices are required for type ' + f.type);
            f.choices = ch.map(function (c, ci) {
              // value is what's saved; label (optional, may be bilingual) is shown
              var o = (typeof c === 'string') ? { value: c } : Object.assign({}, c);
              if (!o.color) o.color = PILL_CYCLE[ci % PILL_CYCLE.length];
              if (!o.label) o.label = o.value;
              return o;
            });
          }
          if (f.type === 'assignments') normalizeAssignments(f, errors);
          if (f.type === 'lookup') {
            f.lookup = f.lookup || {};
            if (!f.lookup.listTitle) errors.push('field "' + f.id + '": lookup.listTitle is required');
            if (!f.color) f.color = 'blue';
          }
          if (f.type === 'person') f.multiple = !!f.multiple;
          if (f.type === 'date') f.includeTime = !!f.includeTime;
          if (STATIC_TYPES[f.type]) f.column = null;
          byKey[k] = f; keyOfId[f.id] = k; ordered.push(f);
        });
      });
    });

    // resolve rule references
    function checkRuleRefs(rule, where) {
      if (!rule) return;
      if (rule.all) return rule.all.forEach(function (r) { checkRuleRefs(r, where); });
      if (rule.any) return rule.any.forEach(function (r) { checkRuleRefs(r, where); });
      if (rule.not) return checkRuleRefs(rule.not, where);
      if (rule.field && !keyOfId[rule.field]) errors.push(where + ': rule references unknown field "' + rule.field + '"');
      if (rule.op === 'withinBusinessDays' && !cfg._bh) errors.push(where + ': withinBusinessDays needs form.businessHours');
      if (rule.op === 'anyChanged' && rule.field && keyOfId[rule.field] && byKey[keyOfId[rule.field]].type !== 'assignments') {
        errors.push(where + ': anyChanged is for an assignments field');
      }
      if (rule.compareTo && rule.compareTo !== '@today' && !keyOfId[rule.compareTo]) {
        errors.push(where + ': rule compares to unknown field "' + rule.compareTo + '"');
      }
    }
    ordered.forEach(function (f) {
      checkRuleRefs(f.visibleWhen, 'field "' + f.id + '"');
      var where = 'field "' + f.id + '"';
      if (f.control != null && (f.type !== 'boolean' || (f.control !== 'switch' && f.control !== 'checkbox'))) {
        errors.push(where + ': control is "switch" or "checkbox", on boolean fields only');
      }
      if (f.values != null) {
        if (f.type !== 'boolean') errors.push(where + ': values is only for boolean fields');
        else if (typeof f.values.on !== 'string' || typeof f.values.off !== 'string') {
          errors.push(where + ': values needs string "on" and "off"');
        }
      }
      if (f.lockWhen) {
        checkRuleRefs(f.lockWhen, where + ' lockWhen');
        if (f.lockValue === undefined) f.lockValue = true;
      }
      if (f.query != null) {
        if (typeof f.query !== 'string' || !f.query) errors.push(where + ': query must be a URL parameter name');
        if (['text', 'textarea', 'email', 'phone', 'hidden', 'choice'].indexOf(f.type) < 0) {
          errors.push(where + ': query works on text, textarea, email, phone, hidden and choice fields');
        }
      }
      if (f.normalize != null && (typeof f.normalize !== 'object' ||
          (f.normalize.keep != null && f.normalize.keep !== 'alnum') ||
          (f.normalize.case != null && f.normalize.case !== 'lower' && f.normalize.case !== 'upper'))) {
        errors.push(where + ': normalize takes { keep: "alnum", case: "lower" | "upper", maxLength }');
      }
      if (f.type === 'hidden' && !f.query && f.default == null) errors.push(where + ': a hidden field needs query or default');
      if (f.readOnly && f.type !== 'text') errors.push(where + ': readOnly is only for text fields');
      if (f.prompt) {
        var pr = f.prompt;
        if (f.type !== 'date') errors.push(where + ': prompt is only for date fields');
        if (!cfg._bh) errors.push(where + ': prompt needs form.businessHours');
        if (!(+pr.withinBusinessDays > 0)) errors.push(where + ': prompt.withinBusinessDays must be a positive number');
        if (!pr.message) errors.push(where + ': prompt.message is required');
        Object.keys((pr.confirm && pr.confirm.set) || {}).forEach(function (id) {
          if (!keyOfId[id]) errors.push(where + ': prompt.confirm.set references unknown field "' + id + '"');
        });
        if (pr.alternative && !(+pr.alternative.moveToBusinessDays > 0)) {
          errors.push(where + ': prompt.alternative.moveToBusinessDays must be a positive number');
        }
      }
      (f.rules || []).forEach(function (r) {
        checkRuleRefs({ field: f.id, compareTo: r.compareTo }, 'field "' + f.id + '"');
      });
    });
    cfg.pages.forEach(function (pg) {
      pg.sections.forEach(function (sec) { checkRuleRefs(sec.visibleWhen, 'section "' + sec.id + '"'); });
    });

    // afterSubmit (post-submit lookup + result screens) and queryError
    function checkScreen(s, where) {
      if (!s || typeof s !== 'object') { errors.push(where + ' must be an object'); return; }
      if (s.redirect && !s.redirect.url) errors.push(where + '.redirect.url is required');
    }
    var as = cfg.afterSubmit;
    if (as) {
      if (as.lookup) {
        var lk = as.lookup;
        if (!lk.listUrl && !lk.listTitle) errors.push('afterSubmit.lookup needs listUrl or listTitle');
        if (!lk.matchColumn || !lk.returnColumn) errors.push('afterSubmit.lookup needs matchColumn and returnColumn');
        if (!keyOfId[lk.matchField]) errors.push('afterSubmit.lookup.matchField "' + lk.matchField + '" is not a field id');
        checkScreen(as.found, 'afterSubmit.found');
      }
      checkScreen(as.notFound, 'afterSubmit.notFound');
    }
    if (cfg.queryError) checkScreen(cfg.queryError, 'queryError');

    // assignments: at most one per form; it turns submit into one item per row
    var asgs = ordered.filter(function (f) { return f.type === 'assignments'; });
    if (asgs.length > 1) errors.push('only one assignments field per form (found ' + asgs.length + ')');
    cfg._asg = asgs[0] || null;
    if (cfg._asg && cfg.attachments.enabled) errors.push('attachments can\'t be combined with an assignments field (one item per row)');
    if (cfg._asg && cfg._asg.visibleWhen) errors.push('field "' + cfg._asg.id + '": an assignments field can\'t have visibleWhen');
    if (cfg.target.set != null) {
      if (typeof cfg.target.set !== 'object' || Array.isArray(cfg.target.set)) errors.push('target.set must be an object of column → template');
      else Object.keys(cfg.target.set).forEach(function (col) {
        if (typeof cfg.target.set[col] !== 'string') errors.push('target.set.' + col + ' must be a string template');
      });
    }

    if (cfg.attachments.enabled && cfg.attachments.section != null) {
      // render inside a section (its page wins over attachments.page)
      var asec = sectionsById[cfg.attachments.section];
      if (!asec) errors.push('attachments.section "' + cfg.attachments.section + '" is not a section id');
      else if (asec.visibleWhen) errors.push('attachments.section "' + asec.id + '" must not have visibleWhen');
      else cfg.attachments.page = asec._page;
    }
    if (cfg.attachments.enabled) {
      var ap = cfg.attachments.page;
      if (ap == null) cfg.attachments.page = cfg.pages.length - 1;
      else if (ap < 0 || ap >= cfg.pages.length) { errors.push('attachments.page is out of range'); cfg.attachments.page = cfg.pages.length - 1; }
    }

    // shared columns — several fields may write one column, but only when
    // the config says so explicitly; accidental duplicates are config errors.
    var shared = Array.isArray(cfg.sharedColumns) ? cfg.sharedColumns.slice() : [];
    var colFields = Object.create(null);
    ordered.forEach(function (f) {
      if (f.column) (colFields[f.column] = colFields[f.column] || []).push(f.id);
    });
    Object.keys(colFields).forEach(function (col) {
      if (colFields[col].length > 1 && shared.indexOf(col) < 0) {
        errors.push('column "' + col + '" is mapped by multiple fields (' + colFields[col].join(', ') +
          ') — declare it in sharedColumns to confirm the conditional variants are intentional');
      }
    });
    shared.forEach(function (col) {
      if (!colFields[col]) errors.push('sharedColumns entry "' + col + '" is not mapped by any field');
    });
    cfg._sharedColumns = shared; cfg._colFields = colFields;

    // a note's text may carry {var:name} (e.g. a link to another page), and
    // so may a feature note's button url
    ordered.forEach(function (f) {
      if (f.type !== 'note') return;
      if (f.style && f.style !== 'plain' && f.style !== 'feature' && !ICONS[f.style]) {
        errors.push('field "' + f.id + '": style must be info, warning, success, danger, plain or feature');
      }
      if (f.text) f.text = fillVars(f.text, cfg);
      if (f.style === 'feature') {
        var b = f.button = Object.assign({}, f.button || {});
        b.url = safeHref(fillVars(b.url, cfg));
        if (!b.text || !b.url) errors.push('field "' + f.id + '": a feature note needs button.text and an http(s) or server-relative button.url');
        // fromForm: the tab this button opens keeps window.opener (no
        // noopener), so the access list's Back can check that a form opened
        // it and close it. Same-origin targets only: another origin never
        // gets a handle on this window.
        else if (b.fromForm) {
          var to = null;
          try { to = new URL(b.url, location.href); } catch (e) { /* safeHref passed it; stays noopener */ }
          b._keepOpener = !!(to && to.origin === location.origin);
        }
      }
    });
    var hn = cfg.form.headerNote;
    if (hn != null) {
      if (typeof hn !== 'object' || !hn.text) errors.push('form.headerNote needs text');
      else {
        if (hn.style && !ICONS[hn.style]) errors.push('form.headerNote.style must be info, warning, success or danger');
        hn.text = fillVars(hn.text, cfg);
      }
    }
    if (cfg.form.headerUser != null && typeof cfg.form.headerUser !== 'object') {
      errors.push('form.headerUser must be an object, e.g. { "label": "Confirmation by:" }');
    }
    cfg._byKey = byKey; cfg._ordered = ordered; cfg._keyOfId = keyOfId;
    cfg._sectionsById = sectionsById;
    return { cfg: cfg, errors: errors };
  }

  /* ------------------------------------------------------------------
     Rule engine — visibility + date comparisons.
     get(fieldId) -> current value. Date ops compare calendar days:
       value(field)  <op>  value(compareTo) + days
     ------------------------------------------------------------------ */
  var DATE_OPS = { after: 1, onOrAfter: 1, before: 1, onOrBefore: 1 };

  function isEmptyVal(v) {
    if (v == null || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return !v.url && !v.id && !v.text;
    return false;
  }
  function evalDateOp(op, mine, base, days) {
    if (!mine || !base) return null; // unknown — caller decides
    var b = new Date(base.getTime() + (days || 0) * 86400000);
    var d = dayDiff(mine, b);
    if (op === 'after') return d > 0;
    if (op === 'onOrAfter') return d >= 0;
    if (op === 'before') return d < 0;
    if (op === 'onOrBefore') return d <= 0;
    return null;
  }
  // bh = the form's normalized businessHours (needed only by withinBusinessDays)
  function evalRule(rule, get, bh) {
    if (!rule) return true;
    if (rule.all) return rule.all.every(function (r) { return evalRule(r, get, bh); });
    if (rule.any) return rule.any.some(function (r) { return evalRule(r, get, bh); });
    if (rule.not) return !evalRule(rule.not, get, bh);
    var v = get(rule.field);
    var op = rule.op || 'equals';
    if (DATE_OPS[op]) {
      var mine = parseDateVal(v);
      var base = rule.compareTo === '@today' ? today0() : parseDateVal(get(rule.compareTo));
      var r = evalDateOp(op, mine, base, rule.days);
      return r === null ? false : r;
    }
    switch (op) {
      case 'equals': return eqLoose(v, rule.value);
      case 'notEquals': return !eqLoose(v, rule.value);
      case 'in': return Array.isArray(rule.value) && rule.value.some(function (x) { return eqLoose(v, x); });
      case 'notIn': return !(Array.isArray(rule.value) && rule.value.some(function (x) { return eqLoose(v, x); }));
      case 'includes': return Array.isArray(v) && v.indexOf(rule.value) > -1;
      case 'includesAny': return Array.isArray(v) && Array.isArray(rule.value) && rule.value.some(function (x) { return v.indexOf(x) > -1; });
      case 'includesAll': return Array.isArray(v) && Array.isArray(rule.value) && rule.value.every(function (x) { return v.indexOf(x) > -1; });
      case 'isEmpty': return isEmptyVal(v);
      case 'notEmpty': return !isEmptyVal(v);
      case 'withinBusinessDays': return !!bh && !isEmptyVal(v) && bizWithin(bh, v, +rule.value, nowMs());
      // assignments: some row's answer differs from its current value (the
      // same test as changedColumn: a first value on a row with none counts)
      case 'anyChanged': return Array.isArray(v) && v.some(function (r) { return r && r.value && r.value !== (r.current || ''); });
      default: return false;
    }
  }
  function eqLoose(a, b) {
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
    if (a == null) return b == null || b === '';
    return String(a) === String(b);
  }

  /* ------------------------------------------------------------------
     Field validators — return '' (ok) or a message. Warnings for date
     warn-mode rules are returned separately.
     ------------------------------------------------------------------ */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function validPhone(v) {
    if (!/^\+?[\d\s().-]{7,24}$/.test(v)) return false;
    return (v.match(/\d/g) || []).length >= 7;
  }
  function validUrl(v) {
    try { var u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch (e) { return false; }
  }

  /* ------------------------------------------------------------------
     Markup builders — every user-supplied string is escaped; every
     Alpine expression only references the instance's own state/methods.
     ------------------------------------------------------------------ */
  var ICONS = {
    info: 'ic-fluent-info-24-regular',
    warning: 'ic-fluent-warning-24-regular',
    success: 'ic-fluent-checkmark-circle-24-regular',
    danger: 'ic-fluent-dismiss-circle-24-regular'
  };
  function icon(name, size) {
    return '<svg class="icon icon--' + (size || 16) + '" aria-hidden="true"><use href="#' + name + '"/></svg>';
  }
  // Author prose (intro, descriptions, hints, notes, confirmation): escaped,
  // then [text](url) becomes a link. Only http(s), mailto, server-relative
  // and #anchor targets. Off-page links open in a new tab so a half-filled
  // form isn't lost. data-interception="off" on every such link: a modern
  // SharePoint page otherwise catches a click on a same-tenant link (at the
  // window, before any handler of ours) and navigates IN PLACE, target or
  // not, replacing the form (seen on the dev tenant with 1.3.0).
  var LINK_RE = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:|\/|#)[^)\s]*)\)/g;
  function prose(s) {
    return esc(s).replace(LINK_RE, function (m, text, href) {
      var ext = href.charAt(0) !== '#';
      return '<a href="' + href + '"' + (ext ? ' target="_blank" rel="noopener noreferrer" data-interception="off"' : '') + '>' + text + '</a>';
    });
  }

  function fieldShell(f, inner, S) {
    var noLabel = f.type === 'heading' || f.type === 'note' || f.type === 'boolean';
    var h = '<div class="field' + (f.span === 'full' ? ' psz-field--full' : '') + '" data-psz-field="' + esc(f.k) + '"';
    if (f.visibleWhen) h += ' x-show="vis(' + esc(jstr(f.k)) + ')" x-cloak';
    h += '>';
    if (!noLabel) {
      h += '<label class="field__label" for="' + esc(f.domId) + '">' + esc(f.label || f.id);
      if (f.required) h += ' <span class="field__req" aria-hidden="true">*</span>';
      h += '</label>';
    }
    h += inner;
    if (f.hint) h += '<p class="field__hint">' + prose(f.hint) + '</p>';
    if (f.type !== 'heading' && f.type !== 'note') {
      h += '<p class="field__error" role="alert" x-show="errors.' + f.k + '" x-text="errors.' + f.k + '" x-cloak></p>';
      h += '<p class="psz-field__warning" x-show="warnings.' + f.k + '" x-text="warnings.' + f.k + '" x-cloak></p>';
    }
    h += '</div>';
    return h;
  }

  function inputCommon(f) {
    return ' id="' + esc(f.domId) + '" @blur="touch(' + esc(jstr(f.k)) + ')"' +
      ' @input="reval(' + esc(jstr(f.k)) + ')" :aria-invalid="errors.' + f.k + ' ? \'true\' : \'false\'"' +
      (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '');
  }

  function renderReadOnly(f) {
    // shown, never edited (e.g. a value carried in from the URL); the row
    // disappears when there's nothing to show. x-text = never parsed as HTML.
    var vis = f.visibleWhen ? 'values.' + f.k + ' && vis(' + esc(jstr(f.k)) + ')' : 'values.' + f.k;
    var h = '<div class="field psz-readonly' + (f.span === 'full' ? ' psz-field--full' : '') + '" data-psz-field="' + esc(f.k) + '"' +
      ' x-show="' + vis + '" x-cloak>';
    h += '<span class="field__label">' + esc(f.label || f.id) + '</span>';
    h += '<p class="psz-readonly__value" id="' + esc(f.domId) + '" x-text="values.' + f.k + '"></p>';
    if (f.hint) h += '<p class="field__hint">' + prose(f.hint) + '</p>';
    return h + '</div>';
  }

  function renderText(f, S) {
    if (f.readOnly) return renderReadOnly(f);
    var type = f.type === 'email' ? 'email' : (f.type === 'phone' ? 'tel' : 'text');
    var maxAttr = f.validation.maxLength ? ' maxlength="' + (+f.validation.maxLength) + '"' : '';
    return fieldShell(f,
      '<input class="input" type="' + type + '"' + maxAttr + ' x-model.trim="values.' + f.k + '"' + inputCommon(f) + '>', S);
  }
  function renderTextarea(f, S) {
    var maxAttr = f.validation.maxLength ? ' maxlength="' + (+f.validation.maxLength) + '"' : '';
    return fieldShell(f,
      '<textarea class="textarea"' + maxAttr + (f.rows ? ' rows="' + (+f.rows) + '"' : '') +
      ' x-model="values.' + f.k + '"' + inputCommon(f) + '></textarea>', S);
  }
  function renderNumber(f, S) {
    var step = f.type === 'currency' ? '0.01' : (f.validation.integer ? '1' : 'any');
    return fieldShell(f,
      '<input class="input" type="number" inputmode="decimal" step="' + step + '"' +
      ' x-model.number="values.' + f.k + '"' + inputCommon(f) + '>', S);
  }
  function renderBoolean(f, S) {
    if (f.control === 'checkbox') {
      // design-system .check: the box's own text is toggleText, or the label
      // when there's no toggleText (then no separate label row)
      var cb = f.toggleText
        ? '<span class="field__label" id="' + esc(f.domId) + '_lbl">' + esc(f.label || f.id) +
          (f.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span>'
        : '';
      cb += '<label class="check">' +
        '<input type="checkbox" id="' + esc(f.domId) + '"' + (f.toggleText ? ' aria-describedby="' + esc(f.domId) + '_lbl"' : '') +
        ' x-model="values.' + f.k + '" @change="check(' + esc(jstr(f.k)) + ')"' +
        (f.lockWhen ? ' :disabled="locked(' + esc(jstr(f.k)) + ')"' : '') + '>' +
        ' <span>' + esc(f.toggleText || f.label || f.id) +
        (!f.toggleText && f.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span></label>';
      return fieldShell(f, cb, S);
    }
    var inner =
      '<span class="field__label" id="' + esc(f.domId) + '_lbl">' + esc(f.label || f.id) +
      (f.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span>' +
      '<label class="switch">' +
      '<input type="checkbox" id="' + esc(f.domId) + '" aria-labelledby="' + esc(f.domId) + '_lbl"' +
      ' x-model="values.' + f.k + '" @change="check(' + esc(jstr(f.k)) + ')"' +
      (f.lockWhen ? ' :disabled="locked(' + esc(jstr(f.k)) + ')"' : '') + '>' +
      '<span class="switch__track"></span>' +
      (f.toggleText ? ' <span>' + esc(f.toggleText) + '</span>'
        // values: the switch reads out the word it will save
        : f.values ? ' <span x-text="values.' + f.k + ' ? ' + esc(jstr(f.values.on)) + ' : ' + esc(jstr(f.values.off)) + '"></span>' : '') +
      '</label>';
    if (f.lockWhen && f.lockNote) {
      inner += '<p class="psz-field__lock" x-show="locked(' + esc(jstr(f.k)) + ')" x-cloak>' +
        icon('ic-fluent-info-24-regular', 16) + '<span>' + prose(f.lockNote) + '</span></p>';
    }
    return fieldShell(f, inner, S);
  }
  function renderDate(f, S) {
    return fieldShell(f,
      '<input class="input" type="' + (f.includeTime ? 'datetime-local' : 'date') + '"' +
      ' x-model="values.' + f.k + '" @change="dateChanged(' + esc(jstr(f.k)) + ')"' + inputCommon(f) + '>', S);
  }
  function renderLink(f, S) {
    var h = '<input class="input" type="url" x-model.trim="values.' + f.k + '.url"' + inputCommon(f).replace('placeholder="', 'data-x-ph="');
    h += (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : ' placeholder="' + esc(S.linkUrlPlaceholder) + '"') + '>';
    if (f.withDescription) {
      h += '<input class="input" type="text" aria-label="' + esc(S.linkDescPlaceholder) + '" placeholder="' + esc(S.linkDescPlaceholder) + '"' +
        ' x-model.trim="values.' + f.k + '.desc">';
    }
    return fieldShell(f, h, S);
  }

  function pillHtml(color, contentHtml) {
    return '<span class="psz-pill psz-pill--' + esc(color) + '"><span>' + contentHtml + '</span></span>';
  }

  function renderChoice(f, S) {
    var K = f.k, kq = esc(jstr(K));
    var h = '<div class="psz-combo" @click.outside="ui.' + K + '=false" @keydown.escape.stop="ui.' + K + '=false">';
    h += '<div class="psz-combo__control" id="' + esc(f.domId) + '" role="combobox" tabindex="0"' +
      ' aria-haspopup="listbox" :aria-expanded="ui.' + K + ' ? \'true\' : \'false\'"' +
      ' :aria-invalid="errors.' + K + ' ? \'true\' : \'false\'" @click="ui.' + K + '=!ui.' + K + '"' +
      ' @keydown.enter.prevent="ui.' + K + '=!ui.' + K + '" @keydown.space.prevent="ui.' + K + '=!ui.' + K + '">';
    h += '<span class="psz-combo__value">';
    h += '<span class="psz-combo__placeholder" x-show="!values.' + K + '">' + esc(f.placeholder || S.comboPlaceholder) + '</span>';
    f.choices.forEach(function (c) {
      h += '<span class="psz-pill psz-pill--' + esc(c.color) + '" x-show="values.' + K + '===' + esc(jstr(c.value)) + '"><span>' + esc(c.label) + '</span></span>';
    });
    if (f.fillIn) {
      h += '<span class="psz-pill psz-pill--gray" x-show="isCustom(' + kq + ')" x-cloak><span x-text="values.' + K + '"></span></span>';
    }
    h += '</span>' + icon('ic-fluent-chevron-down-24-regular', 16).replace('class="icon', 'class="psz-combo__chevron icon') + '</div>';
    h += '<div class="psz-combo__menu" x-show="ui.' + K + '" x-cloak role="listbox">';
    f.choices.forEach(function (c) {
      var vq = esc(jstr(c.value));
      h += '<button type="button" class="psz-combo__option" role="option"' +
        ' :aria-selected="values.' + K + '===' + vq + ' ? \'true\' : \'false\'"' +
        ' @click="pickChoice(' + kq + ',' + vq + ')">' +
        pillHtml(c.color, esc(c.label)) +
        '<span class="psz-combo__check" x-show="values.' + K + '===' + vq + '" x-cloak>' + icon('ic-fluent-checkmark-24-regular') + '</span>' +
        '</button>';
    });
    if (f.fillIn) {
      h += '<div class="psz-combo__fillin" @click.stop>' +
        '<input class="input" type="text" placeholder="' + esc(S.fillInPlaceholder) + '" x-model.trim="fill.' + K + '"' +
        ' @keydown.enter.prevent="pickFill(' + kq + ')">' +
        '<button type="button" class="btn btn--sm" @click="pickFill(' + kq + ')">' + esc(S.fillInAdd) + '</button></div>';
    }
    h += '</div></div>';
    return fieldShell(f, h, S);
  }

  function renderMultichoice(f, S) {
    var K = f.k, kq = esc(jstr(K));
    var h = '<div class="psz-combo" @click.outside="ui.' + K + '=false" @keydown.escape.stop="ui.' + K + '=false">';
    h += '<div class="psz-combo__control" id="' + esc(f.domId) + '" role="combobox" tabindex="0"' +
      ' aria-haspopup="listbox" :aria-expanded="ui.' + K + ' ? \'true\' : \'false\'"' +
      ' :aria-invalid="errors.' + K + ' ? \'true\' : \'false\'" @click="ui.' + K + '=!ui.' + K + '"' +
      ' @keydown.enter.prevent="ui.' + K + '=!ui.' + K + '" @keydown.space.prevent="ui.' + K + '=!ui.' + K + '">';
    h += '<span class="psz-combo__value">';
    h += '<span class="psz-combo__placeholder" x-show="!values.' + K + '.length">' + esc(f.placeholder || S.comboPlaceholderMulti) + '</span>';
    f.choices.forEach(function (c) {
      var vq = esc(jstr(c.value));
      h += '<span class="psz-pill psz-pill--' + esc(c.color) + '" x-show="values.' + K + '.indexOf(' + vq + ')>-1"><span>' + esc(c.label) + '</span>' +
        '<button type="button" class="psz-pill__remove" aria-label="' + esc(S.attachRemove) + '" @click.stop="toggleMulti(' + kq + ',' + vq + ')">' + icon('ic-fluent-dismiss-24-regular') + '</button>' +
        '</span>';
    });
    if (f.fillIn) {
      h += '<template x-for="cv in customSel(' + kq + ')" :key="cv">' +
        '<span class="psz-pill psz-pill--gray"><span x-text="cv"></span>' +
        '<button type="button" class="psz-pill__remove" aria-label="' + esc(S.attachRemove) + '" @click.stop="toggleMulti(' + kq + ', cv)">' + icon('ic-fluent-dismiss-24-regular') + '</button>' +
        '</span></template>';
    }
    h += '</span>' + icon('ic-fluent-chevron-down-24-regular', 16).replace('class="icon', 'class="psz-combo__chevron icon') + '</div>';
    h += '<div class="psz-combo__menu" x-show="ui.' + K + '" x-cloak role="listbox" aria-multiselectable="true">';
    f.choices.forEach(function (c) {
      var vq = esc(jstr(c.value));
      h += '<button type="button" class="psz-combo__option" role="option"' +
        ' :aria-selected="values.' + K + '.indexOf(' + vq + ')>-1 ? \'true\' : \'false\'"' +
        ' @click="toggleMulti(' + kq + ',' + vq + ')">' +
        pillHtml(c.color, esc(c.label)) +
        '<span class="psz-combo__check" x-show="values.' + K + '.indexOf(' + vq + ')>-1" x-cloak>' + icon('ic-fluent-checkmark-24-regular') + '</span>' +
        '</button>';
    });
    if (f.fillIn) {
      h += '<div class="psz-combo__fillin" @click.stop>' +
        '<input class="input" type="text" placeholder="' + esc(S.fillInPlaceholder) + '" x-model.trim="fill.' + K + '"' +
        ' @keydown.enter.prevent="pickFillMulti(' + kq + ')">' +
        '<button type="button" class="btn btn--sm" @click="pickFillMulti(' + kq + ')">' + esc(S.fillInAdd) + '</button></div>';
    }
    h += '</div></div>';
    return fieldShell(f, h, S);
  }

  function renderLookup(f, S) {
    var K = f.k, kq = esc(jstr(K));
    var h = '<div class="psz-combo" @click.outside="ui.' + K + '=false" @keydown.escape.stop="ui.' + K + '=false">';
    h += '<div class="psz-combo__control" id="' + esc(f.domId) + '" role="combobox" tabindex="0"' +
      ' aria-haspopup="listbox" :aria-expanded="ui.' + K + ' ? \'true\' : \'false\'"' +
      ' :aria-invalid="errors.' + K + ' ? \'true\' : \'false\'" @click="openLookup(' + kq + ')"' +
      ' @keydown.enter.prevent="openLookup(' + kq + ')" @keydown.space.prevent="openLookup(' + kq + ')">';
    h += '<span class="psz-combo__value">';
    h += '<span class="psz-combo__placeholder" x-show="!values.' + K + '">' + esc(f.placeholder || S.comboPlaceholder) + '</span>';
    h += '<span class="psz-pill psz-pill--' + esc(f.color) + '" x-show="values.' + K + '" x-cloak><span x-text="values.' + K + ' && values.' + K + '.text"></span></span>';
    h += '</span>' + icon('ic-fluent-chevron-down-24-regular', 16).replace('class="icon', 'class="psz-combo__chevron icon') + '</div>';
    h += '<div class="psz-combo__menu" x-show="ui.' + K + '" x-cloak role="listbox">';
    h += '<div class="spinner-row" x-show="lkBusy.' + K + '"><span class="spinner spinner--16" role="progressbar" aria-label="' + esc(S.lookupLoading) + '"></span> ' + esc(S.lookupLoading) + '</div>';
    h += '<div class="psz-people__note" x-show="lkErr.' + K + '" x-text="lkErr.' + K + '" x-cloak></div>';
    h += '<template x-for="opt in lkOpts.' + K + '" :key="opt.id">' +
      '<button type="button" class="psz-combo__option" role="option"' +
      ' :aria-selected="values.' + K + ' && values.' + K + '.id===opt.id ? \'true\' : \'false\'"' +
      ' @click="pickLookup(' + kq + ', opt)">' +
      '<span class="psz-pill psz-pill--' + esc(f.color) + '"><span x-text="opt.text"></span></span>' +
      '<span class="psz-combo__check" x-show="values.' + K + ' && values.' + K + '.id===opt.id" x-cloak>' + icon('ic-fluent-checkmark-24-regular') + '</span>' +
      '</button></template>';
    h += '</div></div>';
    return fieldShell(f, h, S);
  }

  function renderPerson(f, S) {
    var K = f.k, kq = esc(jstr(K));
    var h = '<div class="psz-people" @click.outside="pOpen.' + K + '=false">';
    h += '<div class="psz-people__control" :aria-invalid="errors.' + K + ' ? \'true\' : \'false\'" @click="focusPeople(' + kq + ')">';
    h += '<template x-for="(p, i) in values.' + K + '" :key="p.key">' +
      '<span class="tag psz-people__tag">' +
      '<img class="psz-people__photo" :src="photoUrl(p)" alt="" x-show="!photoFail[p.key]" @error="photoFail[p.key]=true">' +
      '<span class="avatar avatar--20" x-show="photoFail[p.key]" x-text="initials(p.text)" x-cloak></span>' +
      '<span x-text="p.text"></span>' +
      '<button type="button" class="tag__remove" :aria-label="\'' + esc(S.attachRemove) + ' \' + p.text" @click.stop="removePerson(' + kq + ', i)">' + icon('ic-fluent-dismiss-24-regular') + '</button>' +
      '</span></template>';
    h += '<input class="psz-people__input" id="' + esc(f.domId) + '" type="text" autocomplete="off"' +
      ' x-show="canAddPerson(' + kq + ')" x-model="pq.' + K + '"' +
      ' placeholder="' + esc(f.placeholder || S.personPlaceholder) + '"' +
      ' @focus="pOpen.' + K + '=true"' +
      ' @input.debounce.300ms="searchPeople(' + kq + ')"' +
      ' @keydown.down.prevent="pMove(' + kq + ', 1)"' +
      ' @keydown.up.prevent="pMove(' + kq + ', -1)"' +
      ' @keydown.enter.prevent="pickActive(' + kq + ')"' +
      ' @keydown.backspace="maybePopPerson(' + kq + ', $event)"' +
      ' @blur="touch(' + kq + ')">';
    h += '</div>';
    h += '<div class="psz-people__menu" x-show="pOpen.' + K + ' && (pBusy.' + K + ' || pq.' + K + '.length>1)" x-cloak role="listbox">';
    h += '<div class="spinner-row" x-show="pBusy.' + K + '"><span class="spinner spinner--16" role="progressbar" aria-label="' + esc(S.personSearching) + '"></span> ' + esc(S.personSearching) + '</div>';
    h += '<template x-for="(s, i) in pRes.' + K + '" :key="s.key">' +
      '<button type="button" class="psz-people__option" :class="{ \'is-active\': i===pIdx.' + K + ' }" role="option"' +
      ' :aria-selected="i===pIdx.' + K + ' ? \'true\' : \'false\'" @click="addPerson(' + kq + ', s)">' +
      '<img class="psz-people__photo--lg" :src="photoUrl(s)" alt="" x-show="!photoFail[s.key]" @error="photoFail[s.key]=true">' +
      '<span class="avatar avatar--28" x-show="photoFail[s.key]" x-text="initials(s.text)" x-cloak></span>' +
      '<span class="psz-people__name" x-text="s.text"></span>' +
      '<span class="psz-people__mail" x-text="s.email"></span>' +
      '</button></template>';
    h += '<div class="psz-people__note" x-show="!pBusy.' + K + ' && pq.' + K + '.length>1 && !pRes.' + K + '.length" x-cloak>' + esc(S.personNoResults) + '</div>';
    h += '</div></div>';
    return fieldShell(f, h, S);
  }

  function renderHeading(f) {
    // one wrapper owns title + description so visibility hides both
    var h = '<div class="psz-heading"';
    if (f.visibleWhen) h += ' x-show="vis(' + esc(jstr(f.k)) + ')" x-cloak';
    h += '>';
    h += '<div class="psz-section__title" role="heading" aria-level="4">' + esc(f.text || f.label || '') + '</div>';
    if (f.description) h += '<p class="psz-section__desc">' + prose(f.description) + '</p>';
    return h + '</div>';
  }
  function renderNote(f, S) {
    var style = f.style || 'info';
    var vis = f.visibleWhen ? ' x-show="vis(' + esc(jstr(f.k)) + ')" x-cloak' : '';
    if (style === 'plain') {
      return '<p class="field__hint"' + vis + '>' + prose(f.text || '') + '</p>';
    }
    // feature: a callout that stands out from the info bars: an icon tile,
    // a title, the text and a button opening button.url in a new tab
    // (same-tenant safe: data-interception="off", see prose)
    if (style === 'feature') {
      var b = f.button;
      return '<div class="psz-callout" role="note"' + vis + '>' +
        '<span class="psz-callout__tile">' + icon('ic-fluent-' + esc(f.icon || 'info') + '-24-regular', 24) + '</span>' +
        '<div class="psz-callout__copy">' +
        (f.title ? '<p class="psz-callout__title">' + esc(f.title) + '</p>' : '') +
        (f.text ? '<p class="psz-callout__text">' + prose(f.text) + '</p>' : '') + '</div>' +
        '<a class="btn btn--primary psz-callout__btn" href="' + esc(b.url) + '" target="_blank"' +
        // target=_blank implies noopener in current browsers: keeping the
        // opener needs rel="opener" said out loud
        (b._keepOpener ? ' rel="opener"' : ' rel="noopener noreferrer"') + ' data-interception="off">' +
        '<span>' + esc(b.text) + '</span>' + icon('ic-fluent-open-24-regular', 16) +
        '<span class="psz-sr">' + esc(S.opensNewTab) + '</span></a></div>';
    }
    return '<div class="msgbar msgbar--' + esc(style) + '" role="status"' + vis + '>' +
      icon(ICONS[style] || ICONS.info, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body">' + prose(f.text || '') + '</div></div>';
  }

  function dotHtml(color) {
    return '<span class="psz-dot psz-dot--' + esc(color) + '" aria-hidden="true"></span>';
  }

  /* assignments — one card per row of the user's: the row's name, its value
     (a color dot + label, with that choice's description) and the answer.
     A row with a current value (source.currentColumn) is confirmed with a
     checkbox, or changed through the dropdown (current value left out) and
     changed back with "keep"; a row without one gets the dropdown straight
     away. The card wears the hue of the value it shows. Rows arrive after
     load (x-for), so ids are built from the row id. */
  function renderAssignments(f, S) {
    var K = f.k, kq = esc(jstr(K)), base = f.domId, hasCur = !!f.source.currentColumn;
    var h = '<div class="field psz-field--full psz-asg" data-psz-field="' + esc(K) + '">';
    if (f.label) {
      h += '<span class="field__label" id="' + esc(base) + '-lbl">' + esc(f.label) +
        (f.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span>';
    }
    if (f.hint) h += '<p class="field__hint">' + prose(f.hint) + '</p>';

    h += '<div class="psz-asg__state" x-show="asg.state===\'loading\'">' +
      '<span class="spinner spinner--16" aria-hidden="true"></span><span>' + esc(S.assignLoading) + '</span></div>';
    h += '<div class="msgbar msgbar--danger" role="alert" x-show="asg.state===\'error\'" x-cloak>' +
      icon(ICONS.danger, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body psz-asg__err"><span x-text="asg.msg"></span>' +
      '<button type="button" class="btn btn--sm" @click="loadAssignments()">' + esc(S.assignRetry) + '</button>' +
      '<a class="psz-errmail" x-show="failMail.load" :href="failMail.load">' + esc(S.errorMailLink) + '</a></div></div>';
    // a cut-off read (too many rows / earlier responses) — shown, never silent
    h += '<template x-for="(w, wi) in asg.warn" :key="wi">' +
      '<div class="msgbar msgbar--warning psz-asg__warn" role="status" x-show="asg.state===\'ready\'">' +
      icon(ICONS.warning, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body" x-text="w"></div></div></template>';

    // the per-row combo: same control/menu as a choice field, dot + label values
    var c = '<div class="psz-combo psz-asg__combo" @click.outside="row.open=false" @keydown.escape.stop="row.open=false">';
    c += '<div class="psz-combo__control" role="combobox" tabindex="0" aria-haspopup="listbox"' +
      ' :id="' + esc(jstr(base + '-x')) + ' + row.id"' +
      ' :aria-labelledby="' + esc(jstr(base + '-c2 ' + base + '-r')) + ' + row.id"' +
      ' :aria-expanded="row.open ? \'true\' : \'false\'"' +
      ' :aria-invalid="row.err && row.mode !== \'confirm\' ? \'true\' : \'false\'"' +
      ' :aria-disabled="row.saved ? \'true\' : \'false\'"' +
      ' @click="rowToggle(' + kq + ', row)" @keydown.enter.prevent="rowToggle(' + kq + ', row)"' +
      ' @keydown.space.prevent="rowToggle(' + kq + ', row)">';
    c += '<span class="psz-combo__value">';
    c += '<span class="psz-combo__placeholder" x-show="!row.value && row.mode !== \'change\'">' + esc(f.placeholder || S.comboPlaceholder) + '</span>';
    if (hasCur) c += '<span class="psz-combo__placeholder" x-show="!row.value && row.mode === \'change\'" x-cloak>' + esc(S.assignNewPlaceholder) + '</span>';
    f.choices.forEach(function (ch) {
      c += '<span class="psz-zone" x-show="row.value===' + esc(jstr(ch.value)) + '" x-cloak>' +
        dotHtml(ch.color) + '<span>' + esc(ch.label) + '</span></span>';
    });
    c += '</span>';
    // clear: stops Enter/Space reaching the control (whose .prevent would
    // swallow the button's own activation)
    c += '<button type="button" class="psz-combo__clear" x-show="row.value && !row.saved" x-cloak' +
      ' aria-label="' + esc(S.assignClear) + '" title="' + esc(S.assignClear) + '"' +
      ' @click.stop="rowPick(' + kq + ', row, \'\')" @keydown.enter.stop @keydown.space.stop>' +
      icon('ic-fluent-dismiss-24-regular', 16) + '</button>';
    c += icon('ic-fluent-chevron-down-24-regular', 16).replace('class="icon', 'class="psz-combo__chevron icon') + '</div>';
    c += '<div class="psz-combo__menu" x-show="row.open" x-cloak role="listbox">';
    c += '<button type="button" class="psz-combo__option psz-combo__option--clear" role="option" aria-selected="false"' +
      ' x-show="row.value" @click="rowPick(' + kq + ', row, \'\')">' +
      icon('ic-fluent-dismiss-24-regular', 16) + '<span>' + esc(S.assignClear) + '</span></button>';
    f.choices.forEach(function (ch) {
      var vq = esc(jstr(ch.value));
      // the current value isn't offered: picking it would just be "confirm"
      c += '<button type="button" class="psz-combo__option" role="option"' +
        (hasCur ? ' x-show="row.current !== ' + vq + '"' : '') +
        ' :aria-selected="row.value===' + vq + ' ? \'true\' : \'false\'" @click="rowPick(' + kq + ', row, ' + vq + ')">' +
        dotHtml(ch.color) + '<span>' + esc(ch.label) + '</span>' +
        '<span class="psz-combo__check" x-show="row.value===' + vq + '" x-cloak>' + icon('ic-fluent-checkmark-24-regular') + '</span></button>';
    });
    c += '</div></div>';

    // the value line: the current value (struck through once changed), an
    // arrow, the new one; then the shown value's description
    var zone = function (ch, cls, show) {
      return '<span class="psz-asg__zone' + cls + '" x-show="' + show + '" x-cloak' +
        (cls ? ' :class="{ \'is-replaced\': rowChanged(row) }"' : '') + '>' +
        dotHtml(ch.color) + '<span class="psz-asg__zonename">' + esc(ch.label) + '</span></span>';
    };
    var body = '<div class="psz-asg__body" x-show="row.current || row.value" x-cloak>';
    if (hasCur) {
      body += '<span class="psz-asg__eyebrow" x-show="row.current">' + esc(S.assignCurrent) + '</span>' +
        '<span class="psz-asg__eyebrow" x-show="!row.current" x-cloak>' + esc(f.choiceLabel || '') + '</span>';
    } else if (f.choiceLabel) {
      body += '<span class="psz-asg__eyebrow">' + esc(f.choiceLabel) + '</span>';
    }
    body += '<div class="psz-asg__zones">';
    if (hasCur) {
      f.choices.forEach(function (ch) { body += zone(ch, ' psz-asg__zone--was', 'row.current===' + esc(jstr(ch.value))); });
      body += '<span class="psz-asg__arrow" x-show="rowChanged(row)" x-cloak>' + icon('ic-fluent-arrow-right-24-regular', 16) +
        '<span class="psz-sr">' + esc(S.assignChanged) + '</span></span>';
    }
    f.choices.forEach(function (ch) {
      body += zone(ch, '', 'row.value===' + esc(jstr(ch.value)) + (hasCur ? ' && row.value!==row.current' : ''));
    });
    body += '</div>';
    f.choices.forEach(function (ch) {
      if (ch.description) {
        body += '<p class="psz-asg__desc" x-show="(row.value || row.current)===' + esc(jstr(ch.value)) + '" x-cloak>' +
          prose(ch.description) + '</p>';
      }
    });
    body += '</div>';

    // the answer: confirm / change (a current value), or the dropdown
    var foot = '<div class="psz-asg__foot">';
    if (hasCur) {
      foot += '<div class="psz-asg__confirm" x-show="row.mode===\'confirm\'">' +
        '<label class="check"><input type="checkbox" :id="' + esc(jstr(base + '-k')) + ' + row.id"' +
        ' :checked="!!row.value" :disabled="row.saved" @change="rowConfirm(' + kq + ', row, $event.target.checked)"' +
        ' :aria-invalid="row.err && row.mode === \'confirm\' ? \'true\' : \'false\'" :aria-describedby="' + esc(jstr(base + '-r')) + ' + row.id">' +
        '<span>' + esc(S.assignConfirm) + '</span></label>' +
        '<button type="button" class="btn btn--secondary btn--lg" :id="' + esc(jstr(base + '-g')) + ' + row.id"' +
        ' x-show="!row.saved" @click="rowChange(' + kq + ', row)">' +
        icon('ic-fluent-edit-24-regular', 16) + '<span>' + esc(S.assignChange) + '</span></button></div>';
    }
    foot += '<div class="psz-asg__pick"' + (hasCur ? ' x-show="row.mode!==\'confirm\'" x-cloak' : '') + '>' + c;
    if (hasCur) {
      foot += '<button type="button" class="btn btn--tertiary btn--lg psz-asg__keep" x-show="row.mode===\'change\' && !row.saved"' +
        ' @click="rowKeep(' + kq + ', row)">' + icon('ic-fluent-dismiss-24-regular', 16) +
        '<span>' + esc(S.assignKeep) + '</span></button>';
    }
    foot += '</div><p class="field__error" x-show="row.err" x-text="row.err" x-cloak></p></div>';

    h += '<span class="psz-sr" id="' + esc(base) + '-c2">' + esc(f.choiceLabel || '') + '</span>';
    h += '<div class="psz-asg__list" role="list" x-show="asg.state===\'ready\'" x-cloak' +
      (f.label ? ' aria-labelledby="' + esc(base) + '-lbl"' : '') + '>';
    h += '<template x-for="(row, i) in values.' + K + '" :key="row.id">';
    h += '<div class="psz-asg__row" role="listitem" :class="rowClass(' + kq + ', row)" :style="{ \'--psz-i\': i }">';
    h += '<div class="psz-asg__head"><div class="psz-asg__area">' +
      '<span class="psz-asg__label" :id="' + esc(jstr(base + '-r')) + ' + row.id" x-text="row.label"></span>';
    if (f.source.detailColumn) h += '<span class="psz-asg__detail" x-show="row.detail" x-text="row.detail"></span>';
    h += '</div><span class="psz-asg__status" x-show="row.value || row.saved" x-cloak>' +
      icon('ic-fluent-checkmark-24-regular', 16) + '<span x-text="rowStatus(row)"></span></span></div>';
    h += body + foot + '</div></template></div>';

    h += '<div class="progress progress--subtle psz-asg__progress" x-show="asg.state===\'ready\' && values.' + K + '.length > 1" x-cloak' +
      ' :class="{ \'progress--success\': rowsDone(' + kq + ')===values.' + K + '.length }"' +
      ' role="progressbar" aria-valuemin="0" :aria-valuemax="values.' + K + '.length" :aria-valuenow="rowsDone(' + kq + ')">' +
      '<div class="progress__meta"><span class="progress__label">' + icon('ic-fluent-checkmark-circle-24-regular', 16) +
      '<span x-text="progressText(' + kq + ')"></span></span></div>' +
      '<div class="progress__track"><div class="progress__fill" :style="{ width: rowsPct(' + kq + ') + \'%\' }"></div></div></div>';
    h += '<p class="field__hint" x-show="asg.skipped" x-cloak x-text="fmt(' + esc(jstr(S.assignSomeDone)) + ', { n: asg.skipped })"></p>';
    h += '<p class="field__error" role="alert" x-show="errors.' + K + '" x-text="errors.' + K + '" x-cloak></p>';
    return h + '</div>';
  }

  /* currentUser — who is filling the form in (photo, name, email) */
  function renderCurrentUser(f, S) {
    var h = '<div class="field psz-field--full psz-who" data-psz-field="' + esc(f.k) + '">';
    if (f.label) h += '<span class="field__label">' + esc(f.label) + '</span>';
    h += '<div class="psz-who__card">';
    h += '<span class="psz-who__avatar">' +
      '<template x-if="me.email && !photoFail._me"><img class="psz-who__photo" :src="photoUrl(me)" alt="" @error="photoFail._me=true"></template>' +
      '<span class="avatar avatar--48" x-show="!me.email || photoFail._me" x-text="me.ready ? initials(me.name || me.email) : \'\'"></span></span>';
    h += '<span class="psz-who__id">' +
      '<span class="psz-who__name" x-text="me.ready ? (me.name || me.email) : ' + esc(jstr(S.userLoading)) + '"></span>' +
      '<span class="psz-who__mail" x-show="me.name && me.email" x-text="me.email"></span></span>';
    h += '<span class="spinner spinner--16 psz-who__spin" x-show="!me.ready" aria-hidden="true"></span>';
    h += '</div>';
    if (f.hint) h += '<p class="field__hint">' + prose(f.hint) + '</p>';
    return h + '</div>';
  }

  // {var:name} from form.vars, for config values used at render time
  function fillVars(s, cfg) {
    var vars = cfg.form.vars || {};
    return String(s == null ? '' : s).replace(/\{var:([^}]+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) && vars[name] != null ? String(vars[name]) : '';
    });
  }

  function renderAttachments(cfg, S, uid) {
    var a = cfg.attachments;
    var labelId = uid + '-att-label'; // per-instance: DOM ids are document-global
    var acceptAttr = a.accept && a.accept.length ? ' accept="' + esc(a.accept.join(',')) + '"' : '';
    var hint = a.hint || fmtStr(S.attachHint, {}) ||
      (a.maxFiles + ' files max · ' + a.maxFileSizeMb + ' MB each' + (a.accept && a.accept.length ? ' · ' + a.accept.join(', ') : ''));
    var h = '<div class="field psz-attach psz-field--full" data-psz-field="_attachments">';
    h += '<span class="field__label" id="' + esc(labelId) + '">' + esc(a.label) +
      (a.required ? ' <span class="field__req" aria-hidden="true">*</span>' : '') + '</span>';
    h += '<div class="dropzone psz-attach__drop" tabindex="0" role="button" aria-labelledby="' + esc(labelId) + '"' +
      ' :class="{ \'is-drag\': dragging }"' +
      ' @click="$refs.fileinp.click()" @keydown.enter.prevent="$refs.fileinp.click()"' +
      ' @dragover.prevent="dragging=true" @dragleave="dragging=false" @drop.prevent="dropFiles($event)">' +
      icon('ic-fluent-attach-24-regular', 24) +
      '<div>' + esc(S.attachDrop) + '</div>' +
      '<p class="dropzone__hint">' + esc(hint) + '</p></div>';
    h += '<input type="file" multiple hidden x-ref="fileinp"' + acceptAttr + ' @change="pickFiles($event)">';
    h += '<div class="psz-attach__list" x-show="filesMeta.length" x-cloak>';
    h += '<template x-for="(fm, i) in filesMeta" :key="fm.uid">' +
      '<div class="psz-attach__item" :class="{ \'is-failed\': fm.status===\'failed\', \'is-done\': fm.status===\'done\' }">' +
      icon('ic-fluent-document-24-regular', 20) +
      '<span class="psz-attach__name" x-text="fm.name"></span>' +
      '<span class="psz-attach__size" x-text="fm.status===\'done\' ? ' + esc(jstr(S.attachDone)) + ' : fm.sizeLabel"></span>' +
      '<button type="button" class="icon-btn" aria-label="' + esc(S.attachRemove) + '" x-show="fm.status!==\'done\'" @click="removeFile(i)">' + icon('ic-fluent-dismiss-24-regular') + '</button>' +
      '</div></template>';
    h += '</div>';
    h += '<p class="field__error" role="alert" x-show="errors._attachments" x-text="errors._attachments" x-cloak></p>';
    h += '</div>';
    return h;
  }

  function renderField(f, S) {
    switch (f.type) {
      case 'text': case 'email': case 'phone': return renderText(f, S);
      case 'textarea': return renderTextarea(f, S);
      case 'number': case 'currency': return renderNumber(f, S);
      case 'boolean': return renderBoolean(f, S);
      case 'date': return renderDate(f, S);
      case 'link': return renderLink(f, S);
      case 'choice': return renderChoice(f, S);
      case 'multichoice': return renderMultichoice(f, S);
      case 'lookup': return renderLookup(f, S);
      case 'person': return renderPerson(f, S);
      case 'heading': return renderHeading(f);
      case 'note': return renderNote(f, S);
      case 'assignments': return renderAssignments(f, S);
      case 'currentUser': return renderCurrentUser(f, S);
      case 'hidden': return ''; // carried in state + submitted, never rendered
      default: return '';
    }
  }

  function renderForm(uid, cfg) {
    var S = cfg.strings;
    var ap = cfg.form.appearance;
    var card = ap.frame !== 'plain';
    var pages = cfg.pages;
    var last = pages.length - 1;
    // a bilingual form says which language it's in (screen-reader voice), as
    // lang-keep so the bilingual library's dual-DOM rules never hide or
    // disable it; the page's own <html lang> stays the page's business
    var h = '<div class="psz' + (card ? ' psz--card' : '') + (cfg._multiLang ? ' lang-keep" lang="' + esc(cfg._lang) : '') +
      '" x-data="PSZoneForm.instance(' + esc(jstr(uid)) + ')" data-psz-uid="' + esc(uid) + '">';

    // Header — shown on every view so the form keeps its identity through
    // the confirmation screen.
    // header card: a link tile beside the intro (job aid, policy, …)
    var hc = cfg.form.headerCard;
    var hcHref = hc ? safeHref(fillVars(hc.url, cfg)) : '';
    if (hc && !hcHref) console.warn('[PS Zone Form] form.headerCard not shown: its url is empty or not http(s)/server-relative');
    // form.headerUser: the who card as the header's right column;
    // form.headerNote: a callout under the intro, in the band
    var hu = cfg.form.headerUser, hn = cfg.form.headerNote;
    if ((cfg.form.title && cfg.form.showTitle !== false) || cfg.form.intro || ap.icon || hcHref || hu || hn) {
      var headCls = 'psz__head' + (ap.header === 'band' ? ' psz__head--band psz__head--' + esc(ap.tint || 'sky') : '') +
        (hcHref || hu ? ' psz__head--hascard' : '');
      h += '<header class="' + headCls + '">';
      h += '<div class="psz__head-copy">';
      if (cfg.form.title && cfg.form.showTitle !== false) h += '<h2 class="psz__title">' + esc(cfg.form.title) + '</h2>';
      if (cfg.form.intro) h += '<p class="psz__intro">' + prose(cfg.form.intro) + '</p>';
      if (hn) {
        var hs = hn.style || 'info';
        h += '<div class="msgbar msgbar--' + esc(hs) + ' psz__head-note" role="note">' +
          icon(ICONS[hs], 20).replace('class="icon', 'class="msgbar__icon icon') +
          '<div class="msgbar__body">' + prose(hn.text) + '</div></div>';
      }
      h += '</div>';
      if (hu) h += '<div class="psz__head-aside">' + renderCurrentUser({ k: 'headerUser', label: hu.label || '' }, S) + '</div>';
      if (hcHref) {
        // an asset path (abacus-icons/x.svg) or a sprite name (shield)
        var hcIcon = !hc.icon ? icon('ic-fluent-info-24-regular', 24)
          : /[./]/.test(hc.icon) ? '<img src="' + esc(resolveAsset(hc.icon)) + '" alt="">'
            : icon('ic-fluent-' + esc(hc.icon) + '-24-regular', 24);
        h += '<a class="psz-tipcard lift" href="' + esc(hcHref) + '" target="_blank" rel="noopener noreferrer" data-interception="off">' +
          '<span class="psz-tipcard__icon">' + hcIcon + '</span>' +
          '<span class="psz-tipcard__copy"><span class="psz-tipcard__title">' + esc(hc.title) + '</span>' +
          (hc.text ? '<span class="psz-tipcard__text">' + esc(hc.text) + '</span>' : '') + '</span>' +
          icon('ic-fluent-open-24-regular', 16).replace('class="icon', 'class="psz-tipcard__go icon') +
          '<span class="psz-sr">' + esc(S.opensNewTab) + '</span></a>';
      }
      if (ap.icon) h += '<img class="psz__head-icon" src="' + esc(resolveAsset(ap.icon)) + '" alt="">';
      h += '</header>';
    }

    // Body
    h += '<form class="psz__body" x-show="view===\'form\'" novalidate @submit.prevent="nextOrSubmit()">';
    h += '<div class="psz__content">';
    // answers are frozen while a submit runs: native controls via the
    // disabled fieldset, the custom pickers by their own busy guards
    h += '<fieldset class="psz__lock" :disabled="busy">';

    // Stepper
    if (pages.length > 1) {
      h += '<ol class="stepper psz__stepper" aria-label="' + esc(fmtStr(S.stepOf, { n: '', total: pages.length })) + '">';
      pages.forEach(function (pg, i) {
        h += '<li class="stepper__step" :class="{ \'is-current\': page===' + i + ', \'is-done\': page>' + i + ', \'is-error\': pageHasError(' + i + ') }"' +
          ' @click="goTo(' + i + ')">' +
          '<span class="stepper__dot">' +
          '<span x-show="page>' + i + '" x-cloak>' + icon('ic-fluent-checkmark-24-regular', 12) + '</span>' +
          '<span x-show="page<=' + i + '">' + (i + 1) + '</span>' +
          '</span>' +
          '<span class="stepper__label">' + esc(pg.title || ('Step ' + (i + 1))) + '</span></li>';
      });
      h += '</ol>';
    }

    pages.forEach(function (pg, i) {
      h += '<div class="psz-page" x-show="page===' + i + '"' + (i > 0 ? ' x-cloak' : '') + '>';
      if (pages.length > 1 && pg.title) h += '<h3 class="psz-page__title">' + esc(pg.title) + '</h3>';
      if (pg.description) h += '<p class="psz-page__desc">' + prose(pg.description) + '</p>';
      pg.sections.forEach(function (sec) {
        h += '<section class="psz-section' + (sec.tint ? ' psz-section--tint psz-section--' + esc(sec.tint) : '') + '"';
        if (sec.visibleWhen) h += ' x-show="secVis(' + esc(jstr(sec.id)) + ')" x-cloak';
        h += '>';
        if (sec.icon && (sec.title || sec.description)) {
          // section head with a Fluent icon tile (sprite name, e.g. "person")
          h += '<div class="psz-section__head">' +
            '<span class="psz-section__tile">' + icon('ic-fluent-' + esc(sec.icon) + '-24-regular', 20) + '</span>' +
            '<div class="psz-section__copy">';
          if (sec.title) h += '<h4 class="psz-section__title">' + esc(sec.title) + '</h4>';
          if (sec.description) h += '<p class="psz-section__desc">' + prose(sec.description) + '</p>';
          h += '</div></div>';
        } else {
          if (sec.title) h += '<h4 class="psz-section__title">' + esc(sec.title) + '</h4>';
          if (sec.description) h += '<p class="psz-section__desc">' + prose(sec.description) + '</p>';
        }
        h += '<div class="psz-fields' + (sec.columns === 2 ? ' psz-fields--2' : '') + '">';
        sec.fields.forEach(function (f) { h += renderField(f, S); });
        if (cfg.attachments.enabled && cfg.attachments.section === sec.id) h += renderAttachments(cfg, S, uid);
        h += '</div></section>';
      });
      if (cfg.attachments.enabled && cfg.attachments.section == null && cfg.attachments.page === i) {
        h += '<section class="psz-section">' + renderAttachments(cfg, S, uid) + '</section>';
      }
      h += '</div>';
    });

    // a save failure (not a validation message) also offers the admin email link
    h += '<div class="msgbar msgbar--danger psz__pageerror" role="alert" x-show="pageError" x-cloak>' +
      icon(ICONS.danger, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body"><span x-text="pageError"></span>' +
      '<a class="psz-errmail" x-show="failMail.save" :href="failMail.save">' + esc(S.errorMailLink) + '</a></div></div>';

    h += '</fieldset></div>'; // .psz__lock, .psz__content

    h += '<div class="psz-nav' + (card ? ' psz-nav--foot' : '') + '">';
    h += '<button type="button" class="btn" x-show="page>0" x-cloak @click="prev()">' + esc(S.back) + '</button>';
    h += '<span class="psz-nav__spacer"></span>';
    if (last > 0) h += '<button type="button" class="btn btn--primary" x-show="page<' + last + '" @click="next()">' + esc(S.next) + '</button>';
    h += '<button type="submit" class="btn btn--primary" x-show="page===' + last + '"' + (last > 0 ? ' x-cloak' : '') + ' :disabled="busy">' +
      '<span class="spinner spinner--16 spinner--on-accent" x-show="busy" x-cloak aria-hidden="true"></span>' +
      '<span x-text="busy ? ' + esc(jstr(S.submitting)) + ' : ' + esc(jstr(S.submit)) + '"></span></button>';
    h += '</div></form>';

    // Attachment-retry view (item saved, some uploads failed)
    h += '<div class="psz__content" x-show="view===\'attachRetry\'" x-cloak><div class="psz-page">' +
      '<div class="msgbar msgbar--warning" role="alert">' +
      icon(ICONS.warning, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body"><strong>' + esc(S.attachPartialTitle) + '</strong><br>' +
      '<span x-text="attachPartialMsg()"></span></div></div>' +
      '<div class="psz-attach__list">' +
      '<template x-for="(fm, i) in filesMeta" :key="fm.uid">' +
      '<div class="psz-attach__item" :class="{ \'is-failed\': fm.status===\'failed\', \'is-done\': fm.status===\'done\' }">' +
      icon('ic-fluent-document-24-regular', 20) +
      '<span class="psz-attach__name" x-text="fm.name"></span>' +
      '<span class="psz-attach__size" x-text="fm.status===\'done\' ? ' + esc(jstr(S.attachDone)) + ' : fm.sizeLabel"></span>' +
      '</div></template></div>' +
      '<div class="psz-nav"><span class="psz-nav__spacer"></span>' +
      '<button type="button" class="btn" @click="skipAttachments()">' + esc(S.attachSkip) + '</button>' +
      '<button type="button" class="btn btn--primary" :disabled="busy" @click="retryAttachments()">' +
      '<span class="spinner spinner--16 spinner--on-accent" x-show="busy" x-cloak aria-hidden="true"></span> ' + esc(S.attachRetry) + '</button>' +
      '</div></div></div>';

    // Nothing-to-do screens for an assignments form (no rows / all submitted)
    if (cfg._asg) {
      [['empty', cfg._asg.empty, S.assignEmptyTitle, S.assignEmptyMessage, 'ic-fluent-info-24-regular', ' psz-done__icon--info'],
        ['allDone', cfg._asg.allDone, S.assignDoneTitle, S.assignDoneMessage, 'ic-fluent-checkmark-circle-24-filled', '']
      ].forEach(function (v) {
        var spec = v[1] || {};
        var msg = spec.message != null ? spec.message : v[3];
        h += '<div class="psz-done psz-done--' + v[0] + '" x-show="view===\'' + v[0] + '\'" x-cloak>' +
          '<svg class="icon icon--48 psz-done__icon' + v[5] + '" aria-hidden="true"><use href="#' + v[4] + '"/></svg>' +
          '<h2 class="psz-done__title">' + esc(spec.title || v[2]) + '</h2>' +
          (msg ? '<p class="psz-done__msg">' + prose(msg) + '</p>' : '') + '</div>';
      });
    }

    // Dialog (date-field prompts, submit confirmation) — the design system's .scrim + .dialog
    if (cfg._ordered.some(function (f) { return f.prompt; }) || cfg.submitConfirm) {
      var dlgId = uid + '-dlg';
      h += '<div class="scrim psz-dialog" x-show="dlg.open" x-cloak @keydown="dlgKey($event)">' +
        '<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="' + esc(dlgId) + '-t"' +
        ' aria-describedby="' + esc(dlgId) + '-m" @click.stop>' +
        '<div class="dialog__head"><h2 class="dialog__title" id="' + esc(dlgId) + '-t" x-text="dlg.title"></h2></div>' +
        '<div class="dialog__body"><p class="psz-dialog__msg" id="' + esc(dlgId) + '-m" x-html="dlg.html"></p></div>' +
        '<div class="dialog__foot">' +
        '<button type="button" class="btn psz-dialog__alt" x-show="dlg.alt" @click="dlgAlt()" x-text="dlg.alt"></button>' +
        '<button type="button" class="btn btn--primary psz-dialog__ok" @click="dlgConfirm()" x-text="dlg.ok"></button>' +
        '</div></div></div>';
    }

    // Saving overlay: a submit can take a few seconds (one save per row), so
    // while it runs a full-page scrim with a spinner says so, asks the user
    // not to leave, and blocks clicks. A beforeunload guard backs it up
    // (installUnloadGuard). Same design-system .scrim + .dialog as above.
    var savingId = uid + '-saving';
    h += '<div class="scrim psz-saving" x-show="busy" x-cloak>' +
      '<div class="dialog psz-saving__card" role="alertdialog" aria-modal="true" aria-live="assertive" tabindex="-1"' +
      ' aria-labelledby="' + esc(savingId) + '-t" aria-describedby="' + esc(savingId) + '-m">' +
      '<span class="spinner spinner--48" aria-hidden="true"></span>' +
      '<h2 class="psz-saving__title" id="' + esc(savingId) + '-t">' + esc(S.savingTitle) + '</h2>' +
      '<p class="psz-saving__msg" id="' + esc(savingId) + '-m">' + esc(S.savingMessage) + '</p>' +
      '</div></div>';

    // Result view (afterSubmit found/notFound, queryError). Everything dynamic
    // is x-text / :href; result.html is prose() output (escaped first).
    if (cfg.afterSubmit || cfg.queryError) {
      h += '<div class="psz-done psz-result" x-show="view===\'result\'" x-cloak aria-live="polite">';
      h += '<h2 class="psz-done__title" x-show="result.title" x-text="result.title"></h2>';
      h += '<p class="psz-done__msg" x-show="result.html" x-html="result.html"></p>';
      h += '<a class="psz-result__link" x-show="result.href" :href="result.href">' +
        '<span x-text="result.linkText"></span>' + icon('ic-fluent-arrow-right-24-regular', 20) + '</a>';
      h += '<div class="psz-result__copy" x-show="result.copyFailed" x-cloak>' +
        '<p class="psz-done__msg">' + esc(S.copyBlocked) + '</p>' +
        '<div class="psz-result__copyrow"><input class="input" readonly :value="result.copyText" aria-label="' + esc(S.copyLabel) + '" @focus="$event.target.select()">' +
        '<button type="button" class="btn btn--primary" @click="copyAgain()">' + esc(S.copyButton) + '</button></div></div>';
      h += '<p class="psz-result__count" x-show="redir.url" x-cloak>' +
        '<span x-text="countdownText()"></span> <a :href="redir.url">' + esc(S.redirectNow) + '</a></p>';
      h += '</div>';
    }

    // Confirmation view
    h += '<div class="psz-done" x-show="view===\'done\'" x-cloak>';
    if (cfg.confirmation.illustration) {
      h += '<img class="psz-done__art" src="' + esc(resolveAsset(cfg.confirmation.illustration)) + '" alt="">';
    } else {
      h += '<svg class="icon icon--48 psz-done__icon" aria-hidden="true"><use href="#ic-fluent-checkmark-circle-24-filled"/></svg>';
    }
    h += '<h2 class="psz-done__title">' + esc(cfg.confirmation.title || S.confirmTitle) + '</h2>';
    var cMsg = cfg.confirmation.message || S.confirmMessage;
    if (cMsg) h += '<p class="psz-done__msg">' + prose(cMsg) + '</p>';
    if (cfg.confirmation.allowAnother !== false) {
      h += '<button type="button" class="btn btn--secondary" @click="resetForm()">' + esc(cfg.confirmation.anotherLabel || S.confirmAnother) + '</button>';
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  /* ------------------------------------------------------------------
     Instance state factory — Alpine evaluates
     x-data="PSZoneForm.instance('<uid>')" on the generated root.
     ------------------------------------------------------------------ */
  NS.instance = function (uid) {
    var def = NS._defs[uid];
    if (!def) return {};
    var cfg = def.cfg, S = cfg.strings, adapter = def.adapter, store = def.store;

    function defaultValue(f) {
      if (f.query) {
        // URL value wins; "Submit another" resets back to it (defaultsSnapshot)
        var q = readQuery(f.query);
        if (q !== null) return normalizeVal(q, f.normalize);
      }
      switch (f.type) {
        case 'multichoice': return Array.isArray(f.default) ? f.default.slice() : [];
        case 'person': return [];
        case 'boolean': return !!f.default;
        case 'link': return { url: (f.default && f.default.url) || '', desc: (f.default && f.default.desc) || '' };
        case 'lookup': return null;
        case 'assignments': return []; // rows arrive from loadAssignments()
        case 'number': case 'currency': return (f.default != null ? f.default : '');
        default: return (f.default != null ? String(f.default) : '');
      }
    }

    var values = {}, errors = {}, warnings = {}, touched = {}, ui = {}, fill = {};
    var pq = {}, pRes = {}, pBusy = {}, pOpen = {}, pIdx = {};
    var lkOpts = {}, lkBusy = {}, lkErr = {};
    cfg._ordered.forEach(function (f) {
      if (STATIC_TYPES[f.type]) return;
      values[f.k] = defaultValue(f);
      errors[f.k] = ''; warnings[f.k] = ''; touched[f.k] = false;
      if (f.type === 'choice' || f.type === 'multichoice' || f.type === 'lookup') { ui[f.k] = false; fill[f.k] = ''; }
      if (f.type === 'person') { pq[f.k] = ''; pRes[f.k] = []; pBusy[f.k] = false; pOpen[f.k] = false; pIdx[f.k] = -1; }
      if (f.type === 'lookup') { lkOpts[f.k] = []; lkBusy[f.k] = false; lkErr[f.k] = ''; }
    });
    errors._attachments = '';
    var defaultsSnapshot = JSON.parse(JSON.stringify(values));

    return {
      view: 'form', page: 0, busy: false,
      values: values, errors: errors, warnings: warnings, touched: touched,
      ui: ui, fill: fill,
      pq: pq, pRes: pRes, pBusy: pBusy, pOpen: pOpen, pIdx: pIdx,
      lkOpts: lkOpts, lkBusy: lkBusy, lkErr: lkErr,
      photoFail: {},
      filesMeta: [], dragging: false,
      pageError: '',
      // the "email the administrator" mailto for a failed load / save ('' = none)
      failMail: { load: '', save: '' },
      // date prompt dialog; promptAck[k] = the value the user already answered for
      dlg: { open: false, mode: 'prompt', k: null, title: '', html: '', ok: '', alt: '' },
      promptAck: {},
      // result screen (afterSubmit / queryError) + its optional countdown redirect
      result: { title: '', html: '', href: '', linkText: '', lookup: '', copyText: '', copyFailed: false, copied: false },
      redir: { url: '', left: 0, paused: false },
      // assignments load state ('idle' | 'loading' | 'ready' | 'error' |
      // 'empty' | 'done'), and the signed-in user for currentUser fields
      asg: { state: 'idle', msg: '', skipped: 0, warn: [] },
      me: { name: '', email: '', ready: false },

      init: function () {
        store.state = this;
        var self = this;
        // re-rendered for a language switch: take the previous state over
        var carry = def.carry;
        def.carry = null;
        if (carry) {
          Object.keys(carry.values).forEach(function (k) { if (k in self.values) self.values[k] = carry.values[k]; });
          ['page', 'view', 'filesMeta', 'promptAck', 'asg', 'me', 'result', 'failMail'].forEach(function (p) {
            if (carry[p] !== undefined) self[p] = carry[p];
          });
          if (cfg._asg) (this.values[cfg._asg.k] || []).forEach(function (r) { r.open = false; });
        }
        // begin loading pnp + resolving the page web in the background so
        // submit/search are warm
        if (!adapter.isMock) adapter.ready().catch(function () { /* surfaced on use */ });
        if (cfg._asg) {
          if (this.asg.state === 'idle' || this.asg.state === 'loading') this.loadAssignments();
        } else if (!this.me.ready && (cfg.form.headerUser || cfg._ordered.some(function (f) { return f.type === 'currentUser'; }))) {
          this.loadMe();
        }
        if (carry) return;
        // a required/invalid URL value (field.query) can't be fixed by the
        // user: show queryError instead of the form
        if (cfg.queryError && cfg._ordered.some(function (f) { return f.query && !self.check(f.k); })) {
          this.view = 'result';
          this.showResult(cfg.queryError);
        }
      },

      /* ---- current user + assignments ---- */
      readMe: function () {
        var u = adapter.userInfo ? adapter.userInfo() : {};
        this.me = { name: u.name || '', email: u.email || userEmails(u)[0] || '', ready: true };
        return u;
      },
      loadMe: function () {
        var self = this;
        adapter.ready().then(function () { self.readMe(); })
          .catch(function (e) { console.warn('[PS Zone Form] current user unavailable:', e); self.me.ready = true; });
      },
      loadAssignments: function () {
        var self = this, f = cfg._asg, k = f.k, src = f.source;
        this.asg.state = 'loading'; this.asg.msg = ''; this.asg.warn = []; this.errors[k] = ''; this.failMail.load = '';
        adapter.ready().then(function () {
          var emails = userEmails(self.readMe());
          if (!emails.length) throw new Error('no-user');
          return Promise.all([
            adapter.getAssignments(src, emails),
            self.doneKeys(emails)
          ]);
        }).then(function (res) {
          var rows = res[0].rows || [], done = res[1];
          // a cut-off read is said out loud, never silent
          var warn = [];
          if (res[0].more) {
            var max = src.top || 500;
            console.warn('[PS Zone Form] assignments: more than ' + max + ' rows match; showing the first ' + max);
            warn.push(fmtStr(S.assignMore, { max: max }));
          }
          if (done.more) {
            console.warn('[PS Zone Form] assignments: more than ' + ROW_KEYS_MAX + ' earlier responses; some answered rows may show again');
            warn.push(fmtStr(S.assignKeysMore, { max: ROW_KEYS_MAX }));
          }
          self.asg.warn = warn;
          var open = rows.filter(function (r) { return !done.has(self.rowKey(r)); });
          self.values[k] = open.map(function (r) {
            // the row's current value counts only if it's one of the choices;
            // anything else is treated as "no current value" (said in the console)
            var cur = src.currentColumn && r[src.currentColumn] != null ? String(r[src.currentColumn]) : '';
            if (cur && !f.choices.some(function (ch) { return ch.value === cur; })) {
              console.warn('[PS Zone Form] assignments: row ' + r.ID + ' has ' + src.currentColumn + ' "' + cur + '", which isn\'t a choice value; shown without a current value');
              cur = '';
            }
            return {
              id: String(r.ID), label: String(r[src.labelColumn] == null ? '' : r[src.labelColumn]),
              detail: src.detailColumn ? String(r[src.detailColumn] == null ? '' : r[src.detailColumn]) : '',
              // mode: 'confirm' (a current value: checkbox + Change), 'change'
              // (its dropdown is open for a new value), 'pick' (no current value).
              // value is always the answer: the current value once confirmed.
              current: cur, mode: cur ? 'confirm' : 'pick',
              data: r, value: '', err: '', open: false, saved: false
            };
          });
          self.asg.skipped = rows.length - open.length;
          if (!rows.length) { self.asg.state = 'empty'; self.view = 'empty'; }
          // all shown rows done but a read was cut off (more rows, or more
          // earlier responses than one read covers): "already submitted"
          // could be false, so say what we know instead
          else if (!open.length && (res[0].more || done.more)) { self.asg.state = 'error'; self.asg.msg = warn.join(' '); }
          else if (!open.length) { self.asg.state = 'done'; self.view = 'allDone'; }
          else self.asg.state = 'ready';
        }).catch(function (e) {
          console.error('[PS Zone Form] assignments load failed:', e);
          var loadInfo = { list: src.listTitle || src.listUrl };
          reportError(cfg.errorLog, 'load', e, Object.assign({ language: cfg._lang }, loadInfo));
          self.failMail.load = errorMailHref(cfg.errorContact, cfg.form.title, S, 'load', e, loadInfo, cfg._lang);
          self.asg.state = 'error';
          self.asg.msg = e && e.message === 'no-user' ? S.assignNoUser
            : e && e.message === 'no-context' ? S.noContext : S.assignLoadError;
        });
      },
      // a source row's key as the responses list stores it (keyColumn's source)
      rowKey: function (r) {
        var f = cfg._asg;
        if (!f.responses) return null;
        var c = f.rowColumns[f.responses.keyColumn];
        var v = isIdCol(c) ? r.ID : r[c];
        return v == null ? null : String(v);
      },
      // keys this user already has in the target list → { has(key), more }
      doneKeys: function (emails) {
        var f = cfg._asg;
        if (!f.responses) return Promise.resolve({ has: function () { return false; }, more: false });
        return adapter.getRowKeys(f.responses, emails).then(function (res) {
          var set = Object.create(null);
          (res.keys || []).forEach(function (v) { set[String(v)] = true; });
          return { has: function (key) { return key != null && !!set[key]; }, more: !!res.more };
        });
      },
      // after a failed save, an add may have reached SharePoint even though
      // the browser never heard back. Before trying again, ask the list about
      // exactly the unsaved rows (getRowKeysFor — no read cap applies) and
      // mark the ones it has as saved, so a retry can't save them twice.
      // Without `responses` there is nothing to ask; the retry then trusts row.saved.
      reconcileRows: function () {
        var self = this, f = cfg._asg, rows = this.values[f.k];
        if (!f.responses) return Promise.resolve();
        var src = f.rowColumns[f.responses.keyColumn];
        var pending = rows.filter(function (r) { return !r.saved; });
        // the key as it's stored: the ID is a number, other columns as read
        var vals = pending.map(function (r) { return isIdCol(src) ? Number(r.id) : r.data[src]; })
          .filter(function (v) { return v != null && v !== ''; });
        if (!vals.length) return Promise.resolve();
        return adapter.getRowKeysFor(f.responses, userEmails(adapter.userInfo ? adapter.userInfo() : {}), vals)
          .then(function (have) {
            pending.forEach(function (r) {
              if (have.indexOf(self.rowKey(r.data)) > -1) { r.saved = true; r.open = false; r.err = ''; }
            });
          });
      },
      rowToggle: function (k, row) {
        if (row.saved || this.busy) return;
        var open = !row.open;
        this.values[k].forEach(function (r) { r.open = false; });
        row.open = open;
      },
      rowPick: function (k, row, v) {
        if (row.saved || this.busy) return; // answers are frozen while saving
        row.value = v; row.open = false;
        row.err = '';
        if (this.errors[k]) this.check(k);
      },
      // a current value: the checkbox makes it the answer, or clears it
      rowConfirm: function (k, row, on) {
        if (row.saved || this.busy || row.mode !== 'confirm') return;
        row.value = on ? row.current : '';
        row.err = '';
        if (this.errors[k]) this.check(k);
      },
      // "Change": unconfirms, opens the dropdown and moves focus into it
      rowChange: function (k, row) {
        if (row.saved || this.busy) return;
        this.values[k].forEach(function (r) { r.open = false; });
        row.mode = 'change'; row.value = ''; row.open = true;
        var id = cfg._byKey[k].domId + '-x' + row.id;
        this.$nextTick(function () { var el = document.getElementById(id); if (el) el.focus(); });
      },
      // "Keep current": back to the untouched row (not confirmed), focus on Change
      rowKeep: function (k, row) {
        if (row.saved || this.busy) return;
        row.mode = 'confirm'; row.value = ''; row.open = false; row.err = '';
        var id = cfg._byKey[k].domId + '-g' + row.id;
        this.$nextTick(function () { var el = document.getElementById(id); if (el) el.focus(); });
      },
      rowChanged: function (row) { return !!(row.current && row.value && row.value !== row.current); },
      rowStatus: function (row) {
        return row.saved ? S.assignSaved : row.mode === 'confirm' ? S.assignConfirmed
          : row.mode === 'change' ? S.assignChanged : S.assignSelected;
      },
      choiceColor: function (k, v) {
        var c = (cfg._byKey[k].choices || []).filter(function (x) { return x.value === v; })[0];
        return c ? c.color : '';
      },
      rowClass: function (k, row) {
        // the card wears the hue of the value it shows: the answer, else the current value
        var color = this.choiceColor(k, row.value || row.current);
        // is-open lifts the row over its siblings so the menu isn't covered
        return (color ? 'has-hue has-value psz-asg__row--' + color : '') + (row.value ? ' is-set' : '') +
          (row.saved ? ' is-saved' : '') + (row.err ? ' is-error' : '') + (row.open ? ' is-open' : '');
      },
      rowsDone: function (k) {
        return (this.values[k] || []).filter(function (r) { return !!r.value; }).length;
      },
      rowsPct: function (k) {
        var n = (this.values[k] || []).length;
        return n ? Math.round(this.rowsDone(k) / n * 100) : 0;
      },
      progressText: function (k) {
        return fmtStr(S.assignProgress, { n: this.rowsDone(k), total: (this.values[k] || []).length });
      },
      fmt: function (tpl, map) { return fmtStr(tpl, map); },

      /* ---- result screens: afterSubmit found/notFound, queryError ---- */
      showResult: function (spec, href) {
        var self = this;
        this.result.title = this.renderTemplate(spec.title || '');
        this.result.html = prose(this.renderTemplate(spec.message || ''));
        this.result.href = href || '';
        this.result.linkText = href ? (this.renderTemplate((spec.link && spec.link.text) || '') || href) : '';
        this.result.copyText = spec.copy ? this.renderTemplate(spec.copy) : '';
        this.result.copyFailed = false; this.result.copied = false;
        var go = spec.redirect ? safeHref(this.renderTemplate(spec.redirect.url)) : '';
        if (spec.redirect && !go) console.warn('[PS Zone Form] redirect skipped: not an http(s) or server-relative URL');
        var secs = spec.redirect ? Math.max(0, Math.min(60, Math.round(+this.renderTemplate(String(spec.redirect.seconds == null ? 5 : spec.redirect.seconds))) || 0)) : 0;
        var copied = this.result.copyText ? this.copyText(this.result.copyText) : Promise.resolve(true);
        return copied.then(function (ok) {
          self.result.copied = ok && !!self.result.copyText;
          // a blocked copy pauses the countdown until the user copies by hand
          self.result.copyFailed = !ok;
          if (go) self.startRedirect(go, secs, !ok);
        });
      },
      copyText: function (text) {
        function legacy() {
          try {
            var ta = document.createElement('textarea');
            ta.value = text; ta.setAttribute('readonly', '');
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            var ok = document.execCommand('copy');
            ta.remove();
            return ok;
          } catch (e) { return false; }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacy(); });
        }
        return Promise.resolve(legacy());
      },
      copyAgain: function () {
        // runs inside a click, so the browser allows it
        var self = this;
        this.copyText(this.result.copyText).then(function (ok) {
          self.result.copied = ok;
          if (ok) { self.result.copyFailed = false; self.redir.paused = false; }
        });
      },
      startRedirect: function (url, secs, paused) {
        var self = this;
        this.redir.url = url; this.redir.left = secs; this.redir.paused = !!paused;
        if (store.redirTimer) clearInterval(store.redirTimer);
        store.redirTimer = setInterval(function () {
          if (self.redir.paused) return;
          if (self.redir.left > 0) { self.redir.left--; return; }
          clearInterval(store.redirTimer); store.redirTimer = null;
          window.location.assign(self.redir.url);
        }, 1000);
      },
      countdownText: function () {
        return this.redir.paused ? S.redirectPaused : fmtStr(S.redirectCountdown, { n: this.redir.left });
      },
      runAfterSubmit: function () {
        var self = this, as = cfg.afterSubmit, lk = as.lookup;
        var v = lk ? String(this._get(lk.matchField) == null ? '' : this._get(lk.matchField)).trim() : '';
        var found = (lk && v)
          ? adapter.lookupValue({ siteUrl: lk.siteUrl, listUrl: lk.listUrl, listTitle: lk.listTitle,
            matchColumn: lk.matchColumn, returnColumn: lk.returnColumn, value: v })
            .catch(function (e) { console.warn('[PS Zone Form] lookup failed:', e); return null; })
          : Promise.resolve(null);
        return found.then(function (url) {
          var href = safeHref(url);
          self.result.lookup = href;
          self.view = 'result';
          self.scrollTop();
          return href && as.found ? self.showResult(as.found, href) : self.showResult(as.notFound || {});
        });
      },

      /* ---- visibility ---- */
      _get: function (fieldId) {
        var k = cfg._keyOfId[fieldId];
        return k ? this.values[k] : undefined;
      },
      vis: function (k) {
        var f = cfg._byKey[k];
        if (!f || !f.visibleWhen) return true;
        var self = this;
        return evalRule(f.visibleWhen, function (id) { return self._get(id); }, cfg._bh);
      },
      secVis: function (secId) {
        var sec = cfg._sectionsById[secId];
        if (!sec || !sec.visibleWhen) return true;
        var self = this;
        return evalRule(sec.visibleWhen, function (id) { return self._get(id); }, cfg._bh);
      },
      fieldActive: function (f) {
        // a field counts (validation + submit) only when it and its section are visible
        if (!this.vis(f.k)) return false;
        return this.secVis(f.section);
      },

      /* ---- locks (lockWhen) + date prompts ---- */
      locked: function (k) {
        var f = cfg._byKey[k];
        if (!f || !f.lockWhen) return false;
        var self = this;
        return evalRule(f.lockWhen, function (id) { return self._get(id); }, cfg._bh);
      },
      applyLocks: function () {
        var self = this;
        cfg._ordered.forEach(function (f) {
          if (f.lockWhen && self.locked(f.k) && self.values[f.k] !== f.lockValue) self.values[f.k] = f.lockValue;
        });
      },
      dateChanged: function (k) {
        this.touched[k] = true;
        this.check(k);
        // an open prompt decides first (OK applies the locks, Change moves
        // the date out of the window); only otherwise enforce locks now
        if (!this.maybePrompt(k)) this.applyLocks();
      },
      promptDue: function (k) {
        var f = cfg._byKey[k];
        if (!f || !f.prompt || !cfg._bh || !this.fieldActive(f)) return false;
        var v = this.values[k];
        // only real, not-past dates: typing a year digit by digit passes
        // through dates like 0202-10-07, which must never open the dialog
        if (!v || String(v).slice(0, 10) < bizToday(cfg._bh, nowMs())) return false;
        if (this.promptAck[k] === v) return false;
        return bizWithin(cfg._bh, v, +f.prompt.withinBusinessDays, nowMs());
      },
      maybePrompt: function (k) {
        if (!this.promptDue(k)) return false;
        var pr = cfg._byKey[k].prompt;
        this.dlg.mode = 'prompt';
        this.dlg.k = k;
        this.dlg.title = pr.title || S.promptTitle;
        this.dlg.html = prose(pr.message);
        this.dlg.ok = (pr.confirm && pr.confirm.label) || S.promptOk;
        this.dlg.alt = (pr.alternative && pr.alternative.label) || '';
        this.dlg.open = true;
        var root = this.$root;
        // after x-show has revealed the sheet (a hidden button can't take focus)
        this.$nextTick(function () {
          requestAnimationFrame(function () {
            var ok = root.querySelector('.psz-dialog__ok');
            if (ok) ok.focus();
          });
        });
        return true;
      },
      // submitConfirm: a last look before an irreversible submit. Focus starts
      // on the safe button; Escape goes back.
      openSubmitConfirm: function () {
        var sc = cfg.submitConfirm;
        this.dlg.mode = 'submit';
        this.dlg.k = null;
        this.dlg.title = sc.title || S.submitConfirmTitle;
        this.dlg.html = prose(sc.message);
        this.dlg.ok = sc.confirm || S.submitConfirmOk;
        this.dlg.alt = sc.cancel || S.submitConfirmCancel;
        this.dlg.open = true;
        var root = this.$root;
        this.$nextTick(function () {
          requestAnimationFrame(function () {
            var b = root.querySelector('.psz-dialog__alt');
            if (b) b.focus();
          });
        });
      },
      dlgClose: function () {
        var k = this.dlg.k, mode = this.dlg.mode;
        this.dlg.open = false; this.dlg.k = null;
        var f = k && cfg._byKey[k];
        var inp = mode === 'submit' ? this.$root.querySelector('.psz__body button[type="submit"]')
          : f && document.getElementById(f.domId);
        if (inp) this.$nextTick(function () { inp.focus(); });
      },
      dlgConfirm: function () {
        if (this.dlg.mode === 'submit') {
          this.dlgClose();
          this.submitForm(true);
          return;
        }
        // keep the date; apply confirm.set (e.g. mark the request urgent)
        var self = this, k = this.dlg.k, pr = cfg._byKey[k].prompt;
        this.promptAck[k] = this.values[k];
        var set = (pr.confirm && pr.confirm.set) || {};
        Object.keys(set).forEach(function (id) {
          var tk = cfg._keyOfId[id];
          if (tk) { self.values[tk] = set[id]; self.check(tk); }
        });
        this.applyLocks();
        this.dlgClose();
      },
      dlgAlt: function () {
        if (this.dlg.mode === 'submit') { this.dlgClose(); return; } // go back
        // move the date to the first one at least N business days out
        var k = this.dlg.k, f = cfg._byKey[k];
        var d = bizDateAfter(cfg._bh, +f.prompt.alternative.moveToBusinessDays, nowMs());
        if (d) {
          if (f.includeTime) {
            var m = cfg._bh.dateAt === 'start' ? cfg._bh._start : cfg._bh._end;
            d += 'T' + ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
          }
          this.values[k] = d;
          this.promptAck[k] = d;
          this.check(k);
          this.applyLocks();
        }
        this.dlgClose();
      },
      dlgKey: function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          // a prompt's Escape keeps the date (OK); a submit confirmation's goes back
          if (this.dlg.mode === 'submit') this.dlgClose(); else this.dlgConfirm();
          return;
        }
        if (e.key !== 'Tab') return;
        // keep focus inside the dialog (two buttons)
        var btns = Array.prototype.filter.call(this.$root.querySelectorAll('.psz-dialog .btn'),
          function (b) { return b.offsetParent !== null; });
        if (!btns.length) return;
        var i = btns.indexOf(document.activeElement);
        var n = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : (i === btns.length - 1 ? 0 : i + 1);
        e.preventDefault();
        btns[n].focus();
      },
      // a prompt not yet answered on page i (or anywhere when i is null)
      pendingPrompt: function (i) {
        var self = this;
        var f = cfg._ordered.filter(function (x) { return x.prompt && (i == null || x.page === i) && self.promptDue(x.k); })[0];
        return f ? f.k : null;
      },

      /* ---- interaction helpers ---- */
      touch: function (k) { this.touched[k] = true; this.check(k); },
      reval: function (k) {
        // live re-validation once a field already shows an error, so the
        // message clears while typing instead of collapsing layout at blur
        var self = this;
        this.$nextTick(function () { if (self.errors[k]) self.check(k); });
      },
      isCustom: function (k) {
        var f = cfg._byKey[k];
        var v = this.values[k];
        return !!v && !(f.choices || []).some(function (c) { return c.value === v; });
      },
      customSel: function (k) {
        var f = cfg._byKey[k];
        return (this.values[k] || []).filter(function (v) {
          return !(f.choices || []).some(function (c) { return c.value === v; });
        });
      },
      pickChoice: function (k, v) {
        if (this.busy) return;
        this.values[k] = (this.values[k] === v) ? '' : v;
        this.ui[k] = false; this.touched[k] = true; this.check(k);
      },
      pickFill: function (k) {
        if (this.busy) return;
        var v = (this.fill[k] || '').trim();
        if (!v) return;
        this.values[k] = v; this.fill[k] = ''; this.ui[k] = false;
        this.touched[k] = true; this.check(k);
      },
      toggleMulti: function (k, v) {
        if (this.busy) return;
        var arr = this.values[k];
        var i = arr.indexOf(v);
        if (i > -1) arr.splice(i, 1); else arr.push(v);
        this.touched[k] = true; this.check(k);
      },
      pickFillMulti: function (k) {
        if (this.busy) return;
        var v = (this.fill[k] || '').trim();
        if (!v) return;
        if (this.values[k].indexOf(v) < 0) this.values[k].push(v);
        this.fill[k] = '';
        this.touched[k] = true; this.check(k);
      },

      /* ---- lookup ---- */
      openLookup: function (k) {
        this.ui[k] = !this.ui[k];
        if (!this.ui[k] || this.lkOpts[k].length || this.lkBusy[k]) return;
        var f = cfg._byKey[k], self = this;
        self.lkBusy[k] = true; self.lkErr[k] = '';
        adapter.getLookupItems(f.lookup).then(function (opts) {
          self.lkOpts[k] = opts;
        }).catch(function (e) {
          console.warn('[PS Zone Form] lookup load failed:', e);
          self.lkErr[k] = S.lookupError;
        }).finally(function () { self.lkBusy[k] = false; });
      },
      pickLookup: function (k, opt) {
        if (this.busy) return;
        var cur = this.values[k];
        this.values[k] = (cur && cur.id === opt.id) ? null : { id: opt.id, text: opt.text };
        this.ui[k] = false; this.touched[k] = true; this.check(k);
      },

      /* ---- people ---- */
      canAddPerson: function (k) {
        var f = cfg._byKey[k];
        var n = this.values[k].length;
        if (!f.multiple) return n < 1;
        var max = f.validation.maxPeople;
        return !max || n < max;
      },
      focusPeople: function (k) {
        var inp = document.getElementById(cfg._byKey[k].domId);
        if (inp) inp.focus();
        this.pOpen[k] = true;
      },
      searchPeople: function (k) {
        var self = this;
        var q = (this.pq[k] || '').trim();
        if (q.length < 2) { this.pRes[k] = []; this.pBusy[k] = false; return; }
        var seq = (store.pSeq[k] = (store.pSeq[k] || 0) + 1);
        this.pBusy[k] = true; this.pOpen[k] = true;
        adapter.searchPeople(q, 8).then(function (res) {
          if (store.pSeq[k] !== seq) return; // stale
          var chosen = self.values[k].map(function (p) { return p.key; });
          self.pRes[k] = res.filter(function (r) { return chosen.indexOf(r.key) < 0; });
          self.pIdx[k] = self.pRes[k].length ? 0 : -1;
        }).catch(function (e) {
          if (store.pSeq[k] !== seq) return;
          console.warn('[PS Zone Form] people search failed:', e);
          self.pRes[k] = [];
        }).finally(function () {
          if (store.pSeq[k] === seq) self.pBusy[k] = false;
        });
      },
      addPerson: function (k, s) {
        if (this.busy) return;
        if (!this.canAddPerson(k)) return;
        this.values[k].push({ key: s.key, text: s.text, email: s.email, id: s.id || null });
        this.pq[k] = ''; this.pRes[k] = []; this.pIdx[k] = -1; this.pOpen[k] = false;
        this.touched[k] = true; this.check(k);
        // resolve the user id in the background so submit is fast + early-fails
        var self = this;
        adapter.ensureUser(s.key).then(function (id) {
          self.values[k].forEach(function (p) { if (p.key === s.key) p.id = id; });
        }).catch(function (e) { console.warn('[PS Zone Form] ensureUser deferred to submit:', e); });
      },
      removePerson: function (k, i) {
        if (this.busy) return;
        this.values[k].splice(i, 1);
        this.touched[k] = true; this.check(k);
      },
      maybePopPerson: function (k, ev) {
        if (this.busy) return;
        if ((this.pq[k] || '').length === 0 && this.values[k].length) {
          ev.preventDefault();
          this.values[k].pop();
          this.check(k);
        }
      },
      pMove: function (k, d) {
        var n = this.pRes[k].length;
        if (!n) return;
        this.pIdx[k] = ((this.pIdx[k] + d) % n + n) % n;
      },
      pickActive: function (k) {
        var i = this.pIdx[k];
        if (i > -1 && this.pRes[k][i]) this.addPerson(k, this.pRes[k][i]);
      },
      photoUrl: function (p) {
        if (adapter.photoUrl) return adapter.photoUrl(p);
        var base = adapter.webUrl && adapter.webUrl();
        var origin = base || location.origin;
        return origin + '/_layouts/15/userphoto.aspx?size=S&accountname=' + encodeURIComponent(p.email || p.key);
      },
      initials: function (name) {
        var parts = String(name || '').trim().split(/\s+/);
        var a = parts[0] ? parts[0][0] : '', b = parts.length > 1 ? parts[parts.length - 1][0] : '';
        return (a + b).toUpperCase() || '?';
      },

      /* ---- attachments ---- */
      pickFiles: function (ev) { this.addFiles(ev.target.files); ev.target.value = ''; },
      dropFiles: function (ev) { this.dragging = false; this.addFiles(ev.dataTransfer && ev.dataTransfer.files); },
      // the file set is frozen while a submit runs: the dropzone is a div, so
      // the disabled fieldset doesn't stop a drop — these guards do
      addFiles: function (fileList) {
        if (this.busy) return;
        if (!fileList || !fileList.length) return;
        var a = cfg.attachments, self = this;
        var err = '';
        Array.prototype.forEach.call(fileList, function (file) {
          if (err) return;
          if (self.filesMeta.length >= a.maxFiles) { err = fmtStr(S.attachTooMany, { max: a.maxFiles }); return; }
          if (file.size > a.maxFileSizeMb * 1048576) { err = fmtStr(S.attachTooLarge, { name: file.name, max: a.maxFileSizeMb }); return; }
          if (a.accept && a.accept.length) {
            var ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
            var ok = a.accept.some(function (x) { return x.toLowerCase() === ext; });
            if (!ok) { err = fmtStr(S.attachBadType, { name: file.name, types: a.accept.join(', ') }); return; }
          }
          var name = sanitizeFileName(file.name, self.filesMeta.map(function (m) { return m.name; }));
          var fuid = 'af' + (++store.fileSeq);
          store.files[fuid] = file;
          self.filesMeta.push({ uid: fuid, name: name, size: file.size, sizeLabel: fmtSize(file.size), status: 'pending' });
        });
        this.errors._attachments = err;
        if (!err && a.required && this.filesMeta.length) this.errors._attachments = '';
      },
      removeFile: function (i) {
        if (this.busy) return;
        var fm = this.filesMeta[i];
        if (!fm) return;
        delete store.files[fm.uid];
        this.filesMeta.splice(i, 1);
        if (this.errors._attachments) this.errors._attachments = '';
      },

      /* ---- validation ---- */
      check: function (k) {
        var f = cfg._byKey[k];
        if (!f) return true;
        if (!this.fieldActive(f)) { this.errors[k] = ''; this.warnings[k] = ''; return true; }
        var v = this.values[k];
        var msg = '', warn = '';
        if (f.type === 'assignments') {
          // rows not loaded can't be submitted; otherwise each row needs a choice
          if (this.asg.state !== 'ready') msg = this.asg.state === 'error' ? (this.asg.msg || S.assignLoadError) : S.assignLoading;
          else if (f.required) {
            var missing = 0;
            // a row with a current value is confirmed or changed; one without is picked
            v.forEach(function (r) {
              r.err = r.value || r.saved ? '' : r.current ? S.assignRowConfirmRequired : S.assignRowRequired;
              if (r.err) missing++;
            });
            if (missing) msg = S.assignAllRequired;
          }
          this.errors[k] = msg;
          return !msg;
        }
        var val = f.validation || {};

        var empty = isEmptyVal(v) || (f.type === 'link' && !v.url) || (f.type === 'boolean' && !v);
        if (f.required && empty) {
          msg = (f.type === 'choice' || f.type === 'multichoice' || f.type === 'lookup') ? S.choiceRequired
            : (f.type === 'person') ? S.personRequired
              : S.requiredField;
        } else if (!empty) {
          switch (f.type) {
            case 'email':
              if (!EMAIL_RE.test(v)) msg = S.invalidEmail; break;
            case 'phone':
              if (!validPhone(v)) msg = S.invalidPhone; break;
            case 'text': case 'textarea': case 'hidden':
              if (val.minLength && v.length < val.minLength) msg = fmtStr(S.textMinLength, { min: val.minLength });
              else if (val.maxLength && v.length > val.maxLength) msg = fmtStr(S.textMaxLength, { max: val.maxLength });
              else if (val.url && !validUrl(v)) msg = S.invalidUrl;
              else if (f._pattern && !f._pattern.test(v)) {
                msg = val.patternMessage || S.patternMismatch;
              }
              break;
            case 'number': case 'currency':
              if (typeof v !== 'number' || isNaN(v)) msg = S.invalidNumber;
              else if (val.integer && v % 1 !== 0) msg = S.numberInteger;
              else if (val.min != null && v < val.min) msg = fmtStr(S.numberMin, { min: val.min });
              else if (val.max != null && v > val.max) msg = fmtStr(S.numberMax, { max: val.max });
              break;
            case 'multichoice':
              if (val.minChoices && v.length < val.minChoices) msg = fmtStr(S.multiMin, { min: val.minChoices });
              else if (val.maxChoices && v.length > val.maxChoices) msg = fmtStr(S.multiMax, { max: val.maxChoices });
              break;
            case 'person':
              if (val.maxPeople && v.length > val.maxPeople) msg = fmtStr(S.personMax, { max: val.maxPeople });
              break;
            case 'link':
              if (!validUrl(v.url)) msg = S.invalidUrl;
              break;
            case 'date': {
              var self = this;
              (f.rules || []).forEach(function (r) {
                if (msg) return;
                var mine = parseDateVal(v);
                var base = r.compareTo === '@today' ? today0() : parseDateVal(self._get(r.compareTo));
                var ok = evalDateOp(r.op, mine, base, r.days);
                if (ok === null || ok) return;
                var otherLabel = r.compareTo === '@today'
                  ? S.todayLabel + (r.days ? ' + ' + r.days + 'd' : '')
                  : ((cfg._byKey[cfg._keyOfId[r.compareTo]] || {}).label || r.compareTo) + (r.days ? ' + ' + r.days + 'd' : '');
                var dflt = r.op === 'after' ? S.dateAfter : r.op === 'onOrAfter' ? S.dateOnOrAfter
                  : r.op === 'before' ? S.dateBefore : S.dateOnOrBefore;
                var text = r.message || fmtStr(dflt, { other: otherLabel, days: r.days || 0 });
                if ((r.mode || 'block') === 'warn') { if (!warn) warn = text; }
                else msg = text;
              });
              break;
            }
          }
        }
        this.errors[k] = msg;
        this.warnings[k] = warn;
        return !msg;
      },
      pageFieldKeys: function (i) {
        var self = this, keys = [];
        cfg._ordered.forEach(function (f) {
          if (f.page !== i || STATIC_TYPES[f.type]) return;
          if (!self.fieldActive(f)) return;
          keys.push(f.k);
        });
        return keys;
      },
      validatePage: function (i) {
        var self = this, ok = true;
        this.pageFieldKeys(i).forEach(function (k) {
          self.touched[k] = true;
          if (!self.check(k)) ok = false;
        });
        if (cfg.attachments.enabled && cfg.attachments.page === i) {
          if (cfg.attachments.required && !this.filesMeta.length) {
            this.errors._attachments = S.attachRequired; ok = false;
          }
        }
        return ok;
      },
      pageHasError: function (i) {
        var self = this;
        var bad = this.pageFieldKeys(i).some(function (k) { return !!self.errors[k]; });
        if (!bad && cfg.attachments.enabled && cfg.attachments.page === i) bad = !!this.errors._attachments;
        return bad;
      },

      /* ---- navigation ---- */
      next: function () {
        var pk = this.pendingPrompt(this.page);
        if (pk) { this.maybePrompt(pk); return; }
        if (!this.validatePage(this.page)) { this.pageError = S.pageError; this.focusFirstError(); return; }
        this.pageError = '';
        this.page++;
        this.scrollTop();
      },
      prev: function () { this.pageError = ''; this.page--; this.scrollTop(); },
      goTo: function (i) { if (i < this.page) { this.pageError = ''; this.page = i; this.scrollTop(); } },
      nextOrSubmit: function () {
        if (this.page < cfg.pages.length - 1) this.next(); else this.submitForm();
      },
      scrollTop: function () {
        var root = def.mount;
        if (root && root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
      },
      focusFirstError: function () {
        var self = this;
        var k = this.pageFieldKeys(this.page).filter(function (x) { return self.errors[x]; })[0];
        if (!k) return;
        if (cfg._byKey[k].type === 'assignments') {
          // the first row's invalid control (only the visible one carries
          // aria-invalid), else the load error's retry button — after the tick
          // that renders the rows' aria-invalid. Two queries, not one selector
          // list: a list returns whichever matches first in the document, and
          // the cards' Change buttons are .btn too.
          var root = this.$root;
          this.$nextTick(function () {
            var sel = '[data-psz-field="' + k + '"] ';
            var r = root.querySelector(sel + '[aria-invalid="true"]') || root.querySelector(sel + '.msgbar .btn');
            if (r) r.focus();
          });
          return;
        }
        var elx = document.getElementById(cfg._byKey[k].domId);
        if (elx && elx.focus) elx.focus();
      },

      /* ---- submit pipeline ---- */
      attachPartialMsg: function () {
        var n = this.filesMeta.filter(function (m) { return m.status !== 'done'; }).length;
        return fmtStr(S.attachPartial, { n: n });
      },
      // row: an assignments row — its payload adds rowColumns + the row's
      // choice, and {row:Col} tokens resolve against it
      buildPayload: function (row) {
        var self = this;
        var payload = {};
        var titleMapped = false;
        // the answers as they were when the submit started (store.snap), so
        // nothing changed mid-save can leak into a later row's item
        var V = store.snap || this.values;
        // target.set: fixed columns from templates ({user:name}, {now}, …);
        // a field mapped to the same column wins
        var set = cfg.target.set || {};
        Object.keys(set).forEach(function (col) {
          var v = self.renderTemplate(set[col], row);
          if (v === '') return;
          payload[col] = v;
          if (col === 'Title') titleMapped = true;
        });
        // dev aid: a shared column should have at most one visible field
        cfg._sharedColumns.forEach(function (col) {
          var visIds = (cfg._colFields[col] || []).filter(function (id) {
            var f = cfg._byKey[cfg._keyOfId[id]];
            return f && self.fieldActive(f);
          });
          if (visIds.length > 1) {
            console.warn('[PS Zone Form] shared column "' + col + '": ' + visIds.length +
              ' fields visible at once (' + visIds.join(', ') + ') — the later field wins.');
          }
        });
        return Promise.all(cfg._ordered.map(function (f) {
          if (!f.column || !self.fieldActive(f)) return null;
          if (f.type === 'person') {
            // resolve any unresolved ids now
            return Promise.all(V[f.k].map(function (p) {
              if (p.id) return p.id;
              return adapter.ensureUser(p.key).then(function (id) { p.id = id; return id; })
                .catch(function () { throw new Error(fmtStr(S.personResolveFailed, { name: p.text })); });
            }));
          }
          return null;
        })).then(function () {
          cfg._ordered.forEach(function (f) {
            if (!f.column || !self.fieldActive(f)) return;
            var v = V[f.k];
            var out;
            switch (f.type) {
              case 'text': case 'email': case 'phone': case 'choice': case 'hidden':
                if (v === '') return; out = v; break;
              case 'textarea':
                if (v === '') return; out = f.richText ? toRichText(v) : v; break;
              case 'number': case 'currency':
                if (v === '' || v == null || (typeof v === 'number' && isNaN(v))) return; out = Number(v); break;
              case 'boolean': out = f.values ? (v ? f.values.on : f.values.off) : !!v; break;
              case 'multichoice':
                if (!v.length) return; out = { results: v.slice() }; break;
              case 'date': {
                var d = parseDateVal(v);
                if (!d) return;
                if (f.includeTime) {
                  var t = new Date(v);
                  out = isNaN(t.getTime()) ? null : t.toISOString();
                } else {
                  out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString();
                }
                if (!out) return;
                break;
              }
              case 'person': {
                var ids = v.map(function (p) { return p.id; }).filter(Boolean);
                if (!ids.length) return;
                if (f.multiple) payload[f.column + 'Id'] = { results: ids };
                else payload[f.column + 'Id'] = ids[0];
                if (f.column === 'Title') titleMapped = true;
                return;
              }
              case 'lookup':
                if (!v || !v.id) return;
                payload[f.column + 'Id'] = v.id;
                return;
              case 'link':
                if (!v.url) return;
                out = { Url: v.url, Description: v.desc || v.url };
                break;
              default: return;
            }
            payload[f.column] = out;   // duplicate column mappings: later fields win
            if (f.column === 'Title') titleMapped = true;
          });
          if (row) {
            var fa = cfg._asg;
            Object.keys(fa.rowColumns).forEach(function (col) {
              var srcCol = fa.rowColumns[col];
              var v = isIdCol(srcCol) ? Number(row.id) : row.data[srcCol];
              if (v == null || v === '') return;
              payload[col] = v;
              if (col === 'Title') titleMapped = true;
            });
            payload[fa.column] = row.value;
            // the row's value before this answer, and whether the answer differs
            // (a row with no current value counts as changed)
            if (fa.previousColumn && row.current) payload[fa.previousColumn] = row.current;
            if (fa.changedColumn) payload[fa.changedColumn] = row.value !== row.current;
            // a row column named Title wins over titleTemplate, like a field's
            if ([fa.column, fa.previousColumn, fa.changedColumn].indexOf('Title') > -1 && 'Title' in payload) titleMapped = true;
          }
          if (!titleMapped && cfg.target.titleTemplate) {
            payload.Title = self.renderTemplate(cfg.target.titleTemplate, row);
          }
          return payload;
        });
      },
      renderTemplate: function (tpl, row) {
        var self = this;
        var u = adapter.userInfo ? adapter.userInfo() : {};
        var now = new Date();
        return String(tpl).replace(/\{(form:title|user:name|user:email|date|time|now|lookup|field:[^}]+|var:[^}]+|row:[^}]+)\}/g, function (m, tok) {
          if (tok === 'form:title') return cfg.form.title || '';
          // {now}: the submit's instant as ISO 8601 (UTC) — what a Date and
          // Time column takes; SharePoint shows it in the site's time zone.
          // Every row of one submit shares it.
          if (tok === 'now') return store.submitAt || new Date(nowMs()).toISOString();
          if (tok.indexOf('row:') === 0) {
            if (!row) return '';
            var c = tok.slice(4);
            var rv = isIdCol(c) ? row.id : row.data[c];
            return rv == null ? '' : String(rv);
          }
          if (tok === 'lookup') return self.result.lookup || '';
          if (tok.indexOf('var:') === 0) {
            var vars = cfg.form.vars || {};
            return Object.prototype.hasOwnProperty.call(vars, tok.slice(4)) && vars[tok.slice(4)] != null ? String(vars[tok.slice(4)]) : '';
          }
          if (tok === 'user:name') return u.name || '';
          if (tok === 'user:email') return u.email || userEmails(u)[0] || '';
          if (tok === 'date') return now.toLocaleDateString();
          if (tok === 'time') return now.toLocaleTimeString();
          if (tok.indexOf('field:') === 0) {
            var fk = cfg._keyOfId[tok.slice(6)];
            var v = fk ? (store.snap || self.values)[fk] : undefined;
            if (Array.isArray(v)) return v.map(function (p) { return p && p.text ? p.text : p; }).join(', ');
            if (v && typeof v === 'object') return v.text || v.url || '';
            return v == null ? '' : String(v);
          }
          return m;
        });
      },
      validateAll: function () {
        for (var i = 0; i < cfg.pages.length; i++) {
          if (!this.validatePage(i)) { this.page = i; this.pageError = S.pageError; this.focusFirstError(); return false; }
        }
        this.pageError = '';
        return true;
      },
      // confirmed: true when the submitConfirm dialog's Confirm sent us here
      submitForm: function (confirmed) {
        var self = this;
        if (this.busy) return;
        // a new attempt: the last failure's email link goes (a validation
        // message in the same bar must never carry it)
        this.failMail.save = '';
        // an unanswered date prompt (e.g. the form sat open overnight) is
        // asked first; the user then submits again
        var pk = this.pendingPrompt(null);
        if (pk) { this.maybePrompt(pk); return; }
        this.applyLocks();
        if (!this.validateAll()) return;
        if (cfg.submitConfirm && confirmed !== true) { this.openSubmitConfirm(); return; }
        this.busy = true; this.pageError = '';
        // the saving overlay takes focus, so a screen reader announces it.
        // x-show reveals it on the next animation frame, so retry briefly
        // until it's actually displayed (a hidden element can't take focus)
        var focusTries = 0;
        (function focusSaving() {
          var card = self.$root && self.$root.querySelector('.psz-saving__card');
          if (!card || !self.busy) return;
          if (card.offsetParent !== null || getComputedStyle(card.parentNode).display !== 'none') { card.focus(); return; }
          if (++focusTries < 40) setTimeout(focusSaving, 25);
        })();
        store.submitAt = new Date(nowMs()).toISOString();
        // what was validated and confirmed is what gets saved (see buildPayload)
        store.snap = JSON.parse(JSON.stringify(this.values));
        adapter.ready().then(function () {
          if (!cfg._asg) return null;
          // an earlier attempt failed: some "unsaved" rows may be in the list
          return store.rowsUncertain ? self.reconcileRows() : null;
        }).then(function () {
          if (cfg._asg) return self.saveRows();
          if (store.itemId) return null; // already created — only attachments remain
          return self.buildPayload().then(function (payload) {
            return adapter.addItem(payload).then(function (r) {
              store.itemId = r.id; store.itemRef = r.item;
            });
          });
        }).then(function () {
          return cfg._asg ? true : self.uploadAttachments();
        }).then(function (allOk) {
          if (cfg.afterSubmit && allOk) return self.runAfterSubmit();
          self.view = allOk ? 'done' : 'attachRetry';
          self.scrollTop();
        }).catch(function (e) {
          if (cfg.afterSubmit && cfg.afterSubmit.continueOnSaveError) {
            // the save is a by-product here; the user still gets their result
            console.warn('[PS Zone Form] save failed, continuing (afterSubmit.continueOnSaveError):', e);
            return self.runAfterSubmit();
          }
          console.error('[PS Zone Form] submit failed:', e);
          var detail = e && e.message ? ' ' + fmtStr(S.submitFailedDetail, { detail: trimErr(e.message) }) : '';
          var rows = cfg._asg ? self.values[cfg._asg.k] : [];
          var saved = rows.filter(function (r) { return r.saved; }).length;
          var saveInfo = { list: cfg.target.listTitle || cfg.target.listUrl || cfg.target.listId,
            'rows saved': cfg._asg ? saved + ' of ' + rows.length : 'n/a' };
          reportError(cfg.errorLog, 'save', e, Object.assign({ language: cfg._lang }, saveInfo));
          self.failMail.save = errorMailHref(cfg.errorContact, cfg.form.title, S, 'save', e, saveInfo, cfg._lang);
          // a failed add may still have landed: the next attempt checks first
          if (cfg._asg) store.rowsUncertain = true;
          self.pageError = (e && e.message === 'no-context') ? S.noContext
            // some rows made it: say so, so a retry (saved rows are skipped) feels safe
            : saved ? fmtStr(S.rowsPartial, { n: saved, total: rows.length, submit: S.submit }) + detail
              // "nothing was saved" can't be promised for rows: an add may have landed unseen
              : cfg._asg ? fmtStr(S.rowsFailed, { submit: S.submit }) + detail
                : S.submitFailed + detail;
        }).finally(function () { self.busy = false; store.snap = null; });
      },
      // one target item per assignments row, in order, built from the
      // submit's snapshot (store.snap). A saved row is never sent again
      // (row.saved on the live row); after a failure, reconcileRows() first
      // marks rows the list already has, so a retry only sends the rest.
      saveRows: function () {
        var self = this, k = cfg._asg.k, chain = Promise.resolve();
        var live = Object.create(null);
        this.values[k].forEach(function (r) { live[r.id] = r; });
        (store.snap ? store.snap[k] : this.values[k]).forEach(function (snapRow) {
          chain = chain.then(function () {
            var row = live[snapRow.id];
            if (!row || row.saved) return null;
            return self.buildPayload(snapRow)
              .then(function (p) { return adapter.addItem(p); })
              .then(function () { row.saved = true; row.open = false; });
          });
        });
        return chain.then(function () { store.rowsUncertain = false; });
      },
      uploadAttachments: function () {
        var self = this;
        var pending = this.filesMeta.filter(function (m) { return m.status !== 'done'; });
        if (!pending.length) return Promise.resolve(true);
        var chain = Promise.resolve();
        pending.forEach(function (fm) {
          chain = chain.then(function () {
            var file = store.files[fm.uid];
            if (!file) { fm.status = 'done'; return; }
            return adapter.addAttachment(store.itemRef, fm.name, file)
              .then(function () { fm.status = 'done'; })
              .catch(function (e) { console.warn('[PS Zone Form] attachment failed:', fm.name, e); fm.status = 'failed'; });
          });
        });
        return chain.then(function () {
          return self.filesMeta.every(function (m) { return m.status === 'done'; });
        });
      },
      retryAttachments: function () {
        var self = this;
        if (this.busy) return;
        this.busy = true;
        this.uploadAttachments().then(function (allOk) {
          if (allOk) {
            if (cfg.afterSubmit) return self.runAfterSubmit();
            self.view = 'done'; self.scrollTop();
          }
        }).finally(function () { self.busy = false; });
      },
      skipAttachments: function () {
        if (cfg.afterSubmit) { this.runAfterSubmit(); return; }
        this.view = 'done'; this.scrollTop();
      },
      resetForm: function () {
        var self = this;
        Object.keys(defaultsSnapshot).forEach(function (k) {
          self.values[k] = JSON.parse(JSON.stringify(defaultsSnapshot[k]));
        });
        Object.keys(this.errors).forEach(function (k) { self.errors[k] = ''; });
        Object.keys(this.warnings).forEach(function (k) { self.warnings[k] = ''; });
        Object.keys(this.touched).forEach(function (k) { self.touched[k] = false; });
        this.filesMeta = [];
        store.files = {}; store.itemId = null; store.itemRef = null; store.submitAt = null;
        store.snap = null; store.rowsUncertain = false;
        this.promptAck = {}; this.dlg.open = false; this.dlg.k = null;
        this.page = 0; this.pageError = ''; this.view = 'form';
        // the rows just saved now count as submitted and drop out
        if (cfg._asg) this.loadAssignments();
        this.scrollTop();
      }
    };
  };

  function trimErr(msg) {
    var s = String(msg || '').replace(/\s+/g, ' ').trim();
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  }
  function sanitizeFileName(name, taken) {
    var n = String(name || 'file')
      .replace(/[~"#%&*:<>?/\\{|}]/g, '-')
      .replace(/^[\s.]+|[\s.]+$/g, '');
    if (!n) n = 'file';
    if (taken.indexOf(n) < 0) return n;
    var dot = n.lastIndexOf('.');
    var stem = dot > 0 ? n.slice(0, dot) : n;
    var ext = dot > 0 ? n.slice(dot) : '';
    var i = 2;
    while (taken.indexOf(stem + ' (' + i + ')' + ext) > -1) i++;
    return stem + ' (' + i + ')' + ext;
  }

  /* ------------------------------------------------------------------
     Doctor — config-vs-list validation report (opt-in per mount via the
     data-validate attribute, or PSZoneForm.validate(mountEl) from devtools).
     ------------------------------------------------------------------ */
  var TYPE_COMPAT = {
    text: { ok: ['Text'], warn: ['Note'] },
    email: { ok: ['Text'], warn: ['Note'] },
    phone: { ok: ['Text'], warn: ['Note'] },
    textarea: { ok: ['Note'], warn: ['Text'] },
    number: { ok: ['Number'], warn: ['Currency', 'Text'] },
    currency: { ok: ['Currency'], warn: ['Number'] },
    choice: { ok: ['Choice'], warn: ['Text'] },
    multichoice: { ok: ['MultiChoice'], warn: [] },
    boolean: { ok: ['Boolean'], warn: [] },
    date: { ok: ['DateTime'], warn: [] },
    link: { ok: ['URL'], warn: [] },
    lookup: { ok: ['Lookup'], warn: [] },
    hidden: { ok: ['Text', 'Choice', 'Note'], warn: ['URL'] },
    assignments: { ok: ['Text', 'Choice'], warn: ['Note'] },
    words: { ok: ['Choice', 'Text'], warn: ['Note'] }, // a boolean saving words (values)
    person: null // handled specially: User vs UserMulti
  };

  function runDoctor(def) {
    var cfg = def.cfg, S = cfg.strings;
    return def.adapter.ready().then(function () {
      return def.adapter.getListFields();
    }).then(function (fields) {
      var byName = {};
      (fields || []).forEach(function (fd) { byName[fd.InternalName] = fd; });
      var rows = [];
      cfg._ordered.forEach(function (f) {
        if (!f.column) return;
        var fd = byName[f.column];
        if (!fd) { rows.push({ field: f.id, column: f.column, expected: expectedLabel(f), actual: '— (missing)', level: 'error' }); return; }
        var actual = fd.TypeAsString;
        var level;
        if (f.type === 'person') {
          level = f.multiple
            ? (actual === 'UserMulti' ? 'ok' : 'error')
            : (actual === 'User' ? 'ok' : (actual === 'UserMulti' ? 'warn' : 'error'));
        } else {
          var c = TYPE_COMPAT[compatType(f)];
          level = c && c.ok.indexOf(actual) > -1 ? 'ok' : (c && c.warn.indexOf(actual) > -1 ? 'warn' : 'error');
        }
        if (fd.ReadOnlyField) level = 'error';
        // RichText is only returned for Note columns
        if (f.type === 'textarea' && actual === 'Note' && level === 'ok' && !!fd.RichText !== !!f.richText) {
          level = 'warn';
          actual += fd.RichText ? ' (rich text: set "richText": true or line breaks collapse)'
            : ' (plain text: remove "richText" or the HTML tags show)';
        }
        rows.push({
          field: f.id,
          column: f.column + (cfg._sharedColumns.indexOf(f.column) > -1 ? ' · shared' : ''),
          expected: expectedLabel(f),
          actual: actual + (fd.ReadOnlyField ? ' (read-only)' : ''), level: level
        });
      });
      // columns written without a field: target.set and an assignments
      // field's rowColumns (expected type: what's written there)
      var fa = cfg._asg;
      var extra = Object.create(null);
      Object.keys(cfg.target.set || {}).forEach(function (col) {
        extra[col] = { from: 'target.set', expected: /\{now\}/.test(cfg.target.set[col]) ? ['DateTime'] : ['Text', 'Note', 'Choice'] };
      });
      if (fa) Object.keys(fa.rowColumns).forEach(function (col) {
        extra[col] = { from: fa.id + ' · row', expected: isIdCol(fa.rowColumns[col]) ? ['Number', 'Text'] : ['Text', 'Note', 'Choice', 'Number'] };
      });
      if (fa && fa.previousColumn) extra[fa.previousColumn] = { from: fa.id + ' · previous', expected: ['Text', 'Choice'] };
      if (fa && fa.changedColumn) extra[fa.changedColumn] = { from: fa.id + ' · changed', expected: ['Boolean'] };
      Object.keys(extra).forEach(function (col) {
        var fd = byName[col], x = extra[col];
        rows.push({
          field: x.from, column: col, expected: x.expected.join(' / '),
          actual: fd ? fd.TypeAsString + (fd.ReadOnlyField ? ' (read-only)' : '') : '— (missing)',
          level: !fd || fd.ReadOnlyField ? 'error' : x.expected.indexOf(fd.TypeAsString) > -1 ? 'ok' : 'warn'
        });
      });
      if (fa && fa.responses) {
        var ufd = byName[fa.responses.userColumn];
        rows.push({ field: fa.id + ' · responses', column: fa.responses.userColumn, expected: 'Text',
          actual: ufd ? ufd.TypeAsString : '— (missing)', level: ufd ? (ufd.TypeAsString === 'Text' ? 'ok' : 'warn') : 'error' });
      }
      // list-required columns nothing maps to
      (fields || []).forEach(function (fd) {
        if (!fd.Required || fd.ReadOnlyField) return;
        var mapped = !!extra[fd.InternalName] || cfg._ordered.some(function (f) { return f.column === fd.InternalName; });
        var viaTemplate = fd.InternalName === 'Title' && cfg.target.titleTemplate;
        if (!mapped && !viaTemplate) {
          rows.push({ field: '—', column: fd.InternalName, expected: '(required by the list)', actual: fd.TypeAsString, level: 'warn' });
        }
      });
      // the assignments source list: readable, and has every column the rows use
      var srcCheck = !fa ? Promise.resolve() : def.adapter.getListFields(fa.source).then(function (sfs) {
        var sn = {};
        (sfs || []).forEach(function (fd) { sn[fd.InternalName] = fd; });
        var where = 'source ' + (fa.source.listUrl || fa.source.listTitle);
        [fa.source.userColumn].concat(fa.source._cols).forEach(function (col) {
          var fd = sn[col];
          rows.push({ field: where, column: col, expected: col === fa.source.userColumn ? 'Text' : 'Text / Number / Choice',
            actual: fd ? fd.TypeAsString : '— (missing)',
            level: !fd ? 'error' : (col !== fa.source.userColumn || fd.TypeAsString === 'Text') ? 'ok' : 'warn' });
        });
      }, function (e) {
        rows.push({ field: 'source ' + (fa.source.listUrl || fa.source.listTitle), column: '—', expected: 'a list this user can read',
          actual: trimErr(e.message), level: 'error' });
      });
      // the afterSubmit lookup list: readable, and has both columns
      var lk = cfg.afterSubmit && cfg.afterSubmit.lookup;
      if (!lk) return srcCheck.then(function () { renderDoctor(def, rows, null, S); });
      var where = 'lookup ' + (lk.listUrl || lk.listTitle);
      return def.adapter.getListFields(lk).then(function (lfs) {
        var ln = {};
        (lfs || []).forEach(function (fd) { ln[fd.InternalName] = fd; });
        [[lk.matchColumn, ['Text'], 'Text'], [lk.returnColumn, ['URL', 'Text', 'Note'], 'URL / Text']].forEach(function (c) {
          var fd = ln[c[0]];
          rows.push({ field: where, column: c[0], expected: c[2],
            actual: fd ? fd.TypeAsString : '— (missing)', level: fd ? (c[1].indexOf(fd.TypeAsString) > -1 ? 'ok' : 'warn') : 'error' });
        });
      }, function (e) {
        rows.push({ field: where, column: '—', expected: 'a list this user can read', actual: trimErr(e.message), level: 'error' });
      }).then(function () { renderDoctor(def, rows, null, S); });
    }).catch(function (e) {
      renderDoctor(def, [], e, cfg.strings);
    });
  }
  // a switch/checkbox with word values writes text: a Choice or Text column
  function compatType(f) { return f.type === 'boolean' && f.values ? 'words' : f.type; }
  function expectedLabel(f) {
    if (f.type === 'person') return f.multiple ? 'UserMulti' : 'User';
    var c = TYPE_COMPAT[compatType(f)];
    return c ? c.ok.join(' / ') : f.type;
  }
  function renderDoctor(def, rows, err, S) {
    var box = el('div', 'psz-doctor');
    var t = def.cfg.target;
    box.appendChild(el('h4', 'psz-section__title', S.doctorTitle + ' — ' + (t.listId || t.listUrl || t.listTitle)));
    if (err) {
      var bar = el('div', 'msgbar msgbar--danger');
      bar.appendChild(el('div', 'msgbar__body', 'Doctor failed: ' + trimErr(err.message)));
      box.appendChild(bar);
    } else {
      var table = el('table', 'grid');
      table.innerHTML = '<thead><tr><th>Form field</th><th>List column</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>';
      var tb = document.createElement('tbody');
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        var badge = r.level === 'ok' ? '<span class="badge badge--success">' + esc(S.doctorOk) + '</span>'
          : r.level === 'warn' ? '<span class="badge badge--warning">' + esc(S.doctorWarn) + '</span>'
            : '<span class="badge badge--danger">' + esc(S.doctorError) + '</span>';
        tr.innerHTML = '<td>' + esc(r.field) + '</td><td class="mono">' + esc(r.column) + '</td><td>' + esc(r.expected) + '</td><td>' + esc(r.actual) + '</td><td>' + badge + '</td>';
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      box.appendChild(table);
    }
    var mount = def.mount;
    var existing = mount.querySelector('.psz-doctor');
    if (existing) existing.remove();
    mount.insertBefore(box, mount.firstChild);
  }
  NS.validate = function (mountEl) {
    var uid = mountEl && mountEl.querySelector('[data-psz-uid]') && mountEl.querySelector('[data-psz-uid]').getAttribute('data-psz-uid');
    if (uid && NS._defs[uid]) runDoctor(NS._defs[uid]);
  };

  /* ------------------------------------------------------------------
     Resources side panel ([data-psz-resources]) — a companion web part
     for the page's side column: link cards, information text and a
     contact card, from its own JSON config (see
     ps-zone-attestation.resources.json and docs/03-config.md). Static
     markup: no Alpine, no list calls. Shares the form's languages,
     edit-mode placeholder, sprite, safe links and error card, and
     re-renders on an intl.js language switch like the form does.
     ------------------------------------------------------------------ */
  NS._res = {};
  var RES_TYPES = ['feature', 'link', 'text', 'contact'];
  function resLangs(raw) {
    return raw && Array.isArray(raw.languages) && raw.languages.length ? raw.languages : null;
  }
  // the form's language helpers read raw.form.languages
  function resLangCfg(raw) { return { form: { languages: resLangs(raw) } }; }
  function resStrings(lang) { return Object.assign({}, DEFAULT_STRINGS, lang === 'fr' ? DEFAULT_STRINGS_FR : {}); }
  function normalizeResources(raw, lang) {
    var errors = [];
    var cfg = localize(raw || {}, lang);
    (resLangs(raw) || []).forEach(function (l) {
      if (LANGS.indexOf(l) < 0) errors.push('languages: "' + l + '" isn\'t supported (use ' + LANGS.join(', ') + ')');
    });
    if (!Array.isArray(cfg.sections) || !cfg.sections.length) errors.push('sections: needs at least one section');
    (Array.isArray(cfg.sections) ? cfg.sections : []).forEach(function (s, i) {
      if (!s || !Array.isArray(s.items)) { errors.push('sections[' + i + '].items: needs a list of items'); return; }
      s.items.forEach(function (it, j) {
        var at = 'sections[' + i + '].items[' + j + ']';
        if (!it || RES_TYPES.indexOf(it.type) < 0) errors.push(at + '.type: use one of ' + RES_TYPES.join(', '));
        else if (it.type === 'contact' ? !it.name : !it.title) errors.push(at + ': needs a ' + (it.type === 'contact' ? 'name' : 'title'));
      });
    });
    cfg._lang = lang;
    cfg._S = resStrings(lang);
    return { cfg: cfg, errors: errors };
  }
  function resInitials(name) {
    // words that start with a letter only, so "[Placeholder] Ana Diaz" → "AD"
    var parts = String(name || '').trim().split(/\s+/).filter(function (w) { return /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(w); });
    var a = parts[0] ? parts[0][0] : '', b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase() || '?';
  }
  // an item's icon: an asset path under design/ (abacus-icons/x.svg) or a sprite name (document)
  function resIcon(name, fallback, size) {
    var n = name || fallback;
    return /[./]/.test(n) ? '<img src="' + esc(resolveAsset(n)) + '" alt="">' : icon('ic-fluent-' + esc(n) + '-24-regular', size);
  }
  // a link when its url is safe; a plain (unlinked) card while it's empty,
  // so placeholders still show; an unsafe url is never linked
  function resCard(it, cls, inner, S) {
    // SharePoint document paths often carry spaces ("Shared Documents");
    // encode them rather than refuse the link
    var href = safeHref(String(it.url == null ? '' : it.url).trim().replace(/ /g, '%20'));
    if (it.url && !href) console.warn('[PS Zone Form] resources: "' + it.title + '" isn\'t linked: its url isn\'t http(s) or server-relative');
    if (!href) return '<div class="' + cls + ' is-unlinked">' + inner + '</div>';
    return '<a class="' + cls + ' lift" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" data-interception="off">' + inner +
      icon('ic-fluent-open-24-regular', 16).replace('class="icon', 'class="psz-tipcard__go icon') +
      '<span class="psz-sr">' + esc(S.opensNewTab) + '</span></a>';
  }
  function renderResources(uid, cfg) {
    var S = cfg._S;
    var h = '<div class="psz-res lang-keep" lang="' + esc(cfg._lang) + '" data-psz-res-uid="' + esc(uid) + '">';
    cfg.sections.forEach(function (s) {
      h += '<section class="psz-res__group">';
      if (s.heading) h += '<h2 class="psz-res__heading">' + esc(s.heading) + '</h2>';
      s.items.forEach(function (it) {
        h += '<div class="psz-res__item psz-res__item--' + esc(it.type) + '">';
        if (it.type === 'feature') {
          h += resCard(it, 'psz-tipcard psz-res__feature',
            '<span class="psz-tipcard__icon">' + resIcon(it.icon, 'info', 24) + '</span>' +
            '<span class="psz-tipcard__copy"><span class="psz-tipcard__title">' + esc(it.title) + '</span>' +
            (it.text ? '<span class="psz-tipcard__text">' + esc(it.text) + '</span>' : '') + '</span>', S);
        } else if (it.type === 'link') {
          h += resCard(it, 'psz-res__link',
            '<span class="psz-res__link-icon">' + resIcon(it.icon, 'document', 20) + '</span>' +
            '<span class="psz-res__link-title">' + esc(it.title) + '</span>', S);
        } else if (it.type === 'text') {
          h += '<h3 class="psz-res__subhead">' + esc(it.title) + '</h3>';
          if (it.text) h += '<p class="psz-res__text">' + prose(it.text) + '</p>';
        } else if (it.type === 'contact') {
          var mail = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(String(it.email || '')) ? it.email : '';
          if (it.email && !mail) console.warn('[PS Zone Form] resources: contact "' + it.name + '" email isn\'t an address');
          if (it.title) h += '<h3 class="psz-res__subhead">' + esc(it.title) + '</h3>';
          h += '<div class="psz-res__contact"><span class="avatar avatar--40" aria-hidden="true">' + esc(resInitials(it.name)) + '</span>' +
            '<span class="psz-res__contact-id"><span class="psz-res__contact-name">' + esc(it.name) + '</span>' +
            (mail ? '<a class="psz-res__contact-mail" href="mailto:' + esc(mail) + '">' + esc(mail) + '</a>'
              : it.email ? '<span class="psz-res__contact-mail">' + esc(it.email) + '</span>' : '') + '</span></div>';
        }
        if (it.description && it.type !== 'text') h += '<p class="psz-res__desc">' + prose(it.description) + '</p>';
        h += '</div>';
      });
      h += '</section>';
    });
    return h + '</div>';
  }
  function initResources(mount) {
    ensureStyles();
    installNavWatcher();
    var configUrl = mount.getAttribute('data-config') || '';
    if (inEditMode()) {
      // same placeholder rule as the form: .is-suspended stays on for the whole edit session
      mount.__pszDeferred = true;
      mount.classList.add('is-suspended', 'is-edit-deferred');
      if (!mount.querySelector('.psz-editnote')) mount.appendChild(editNote(configUrl, DEFAULT_STRINGS));
      return;
    }
    mount.classList.remove('is-suspended', 'is-edit-deferred');
    mount.querySelectorAll('[data-psz-fatal]').forEach(function (n) { n.remove(); });
    mount.setAttribute('data-psz-state', 'initializing');
    var spriteReady = ensureSprite();
    var raw = null;
    loadConfig(mount).then(function (r) {
      raw = r;
      return whenIntl(resLangCfg(r));
    }).then(function () {
      var norm = normalizeResources(raw, activeLang(resLangCfg(raw)));
      if (norm.errors.length) {
        console.error('[PS Zone Form] resources config errors:', norm.errors);
        throw new Error(norm.errors.join('; '));
      }
      var uid = nextUid();
      var def = NS._res[uid] = { uid: uid, raw: raw, mount: mount, cfg: norm.cfg, root: null,
        multiLang: (resLangs(raw) || []).length > 1 };
      if (def.multiLang) wireIntl();
      return spriteReady.then(function () {
        if (!mount.querySelector('.psz-editnote')) mount.appendChild(editNote(configUrl, def.cfg._S));
        var host = document.createElement('div');
        host.innerHTML = renderResources(uid, def.cfg);
        def.root = host.firstChild;
        mount.appendChild(def.root);
        mount.setAttribute('data-psz-state', 'ready');
      });
    }).catch(function (e) {
      console.error('[PS Zone Form] resources init failed:', e);
      mount.__pszInit = false;
      mount.setAttribute('data-psz-state', 'error');
      fatalCard(mount, DEFAULT_STRINGS, e && e.message);
    });
  }
  function relocalizeResources(def) {
    if (!def.multiLang || !def.root || !def.root.isConnected) return;
    var lang = activeLang(resLangCfg(def.raw));
    if (lang === def.cfg._lang) return;
    var norm = normalizeResources(def.raw, lang);
    if (norm.errors.length) { console.error('[PS Zone Form] resources config errors (' + lang + '):', norm.errors); return; }
    def.cfg = norm.cfg;
    var host = document.createElement('div');
    host.innerHTML = renderResources(def.uid, def.cfg);
    var root = host.firstChild;
    def.root.parentNode.replaceChild(root, def.root);
    def.root = root;
  }

  /* ------------------------------------------------------------------
     Employee access list ([data-psz-access]) — a page of its own, opened
     in a new tab from the form's notice: each of the user's areas (their
     rows in the Assignments list) as an open accordion panel listing the
     employees with access to it (the Access list). For information only:
     nothing is saved. Native <details> panels, no Alpine. Config:
     ps-zone-attestation.access.json (docs/03-config.md). "Back" closes
     the tab when the form opened it (formOpener), which returns the user
     to the form with their answers intact.
     ------------------------------------------------------------------ */
  NS._acc = {};
  function normKey(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  // maps keyed by area name: no prototype, so an area called "constructor"
  // or "toString" isn't already "there"
  function keyMap() { return Object.create(null); }
  // The tab that opened this one, when it's a page of ours with the form on
  // it: the form's access-list button (button.fromForm) keeps window.opener
  // for exactly this. Reading another origin's opener throws, so only a
  // same-origin page with a [data-psz-form] mount counts. Not a URL flag:
  // any page can put one of those in a link.
  function formOpener() {
    try {
      var o = window.opener;
      if (!o || o.closed || o === window) return null;
      if (o.location.origin !== location.origin) return null;
      return o.document.querySelector('[data-psz-form]') ? o : null;
    } catch (e) { return null; }
  }
  function normalizeAccess(raw, lang) {
    var errors = [];
    var cfg = localize(raw || {}, lang);
    (resLangs(raw) || []).forEach(function (l) {
      if (LANGS.indexOf(l) < 0) errors.push('languages: "' + l + '" isn\'t supported (use ' + LANGS.join(', ') + ')');
    });
    var a = cfg.assignments = Object.assign({}, cfg.assignments || {});
    var x = cfg.access = Object.assign({}, cfg.access || {});
    if (!a.listTitle && !a.listUrl) errors.push('assignments: listTitle or listUrl is required');
    ['userColumn', 'labelColumn'].forEach(function (c) { if (!a[c]) errors.push('assignments.' + c + ' is required'); });
    if (!x.listTitle && !x.listUrl) errors.push('access: listTitle or listUrl is required');
    ['areaColumn', 'nameColumn', 'emailColumn'].forEach(function (c) { if (!x[c]) errors.push('access.' + c + ' is required'); });
    a._cols = a.labelColumn ? [a.labelColumn] : [];
    // {var:formUrl} in the intro; PSZ_FORM_SETTINGS.vars overrides (the dev harness)
    var vars = Object.assign({}, cfg.vars || {}, settings.vars || {});
    cfg.intro = cfg.intro ? fillVars(cfg.intro, { form: { vars: vars } }) : '';
    cfg.formUrl = safeHref(vars.formUrl);
    if (vars.formUrl && !cfg.formUrl) console.warn('[PS Zone Form] access: vars.formUrl isn\'t http(s) or server-relative, so there\'s no back link');
    cfg._lang = lang;
    cfg._S = Object.assign(resStrings(lang), cfg.strings || {});
    return { cfg: cfg, errors: errors };
  }
  // the user's areas (in the order read, de-duplicated) with the employees
  // listed for each, sorted by name. A row for an area that isn't one of
  // the user's is never shown.
  function accessGroups(areas, rows) {
    var groups = [], byKey = keyMap();
    areas.forEach(function (a) {
      var k = normKey(a);
      if (!k || byKey[k]) return;
      groups.push(byKey[k] = { area: String(a).trim(), people: [] });
    });
    rows.forEach(function (r) {
      var g = byKey[normKey(r.area)];
      var name = String(r.name || '').trim(), email = String(r.email || '').trim();
      if (!g || (!name && !email)) return;
      if (g.people.some(function (p) { return normKey(p.name) === normKey(name) && normKey(p.email) === normKey(email); })) return;
      g.people.push({ name: name, email: email });
    });
    groups.forEach(function (g) {
      g.people.sort(function (p, q) { return (p.name || p.email).localeCompare(q.name || q.email); });
    });
    return groups;
  }
  function accessBody(def, closed) {
    var cfg = def.cfg, S = cfg._S, v = def.view;
    if (v.state === 'loading') {
      return '<div class="psz-asg__state psz-acc__state" role="status"><span class="spinner spinner--16" aria-hidden="true"></span><span>' +
        esc(S.accessLoading) + '</span></div>';
    }
    if (v.state === 'error') {
      var mail = '';
      try {
        mail = errorMailHref(cfg.errorContact, cfg.title, S, 'access', v.err, { config: def.configUrl }, cfg._lang);
      } catch (x) { /* a malformed errorContact must not hide the real error */ }
      return '<div class="msgbar msgbar--danger" role="alert">' +
        icon(ICONS.danger, 20).replace('class="icon', 'class="msgbar__icon icon') +
        '<div class="msgbar__body psz-asg__err"><span>' + esc(v.noUser ? S.accessNoUser : S.accessLoadError) + '</span>' +
        '<button type="button" class="btn btn--sm" data-psz-acc-retry>' + esc(S.assignRetry) + '</button>' +
        (mail ? '<a class="psz-errmail" href="' + esc(mail) + '">' + esc(S.errorMailLink) + '</a>' : '') + '</div></div>';
    }
    var groups = accessGroups(def.data.areas, def.data.rows);
    if (!groups.length) {
      // nothing to show. "No areas assigned" only when the read was
      // complete; a cut-off read with no usable area says that instead
      var partial = !!def.data.more, em = partial ? {} : (cfg.empty || {});
      return '<div class="psz-done psz-done--' + (partial ? 'partial' : 'empty') + '">' +
        '<svg class="icon icon--48 psz-done__icon ' + (partial ? 'psz-done__icon--warning' : 'psz-done__icon--info') + '" aria-hidden="true">' +
        '<use href="#ic-fluent-' + (partial ? 'warning' : 'info') + '-24-regular"/></svg>' +
        '<h3 class="psz-done__title">' + esc(em.title || (partial ? S.accessPartialTitle : S.accessEmptyTitle)) + '</h3>' +
        '<p class="psz-done__msg">' + prose(em.message || (partial ? S.accessPartialMessage : S.accessEmptyMessage)) + '</p></div>';
    }
    // a cut-off read is said out loud above what did arrive
    var h = '';
    if (def.data.more) {
      h += '<div class="msgbar msgbar--warning" role="status">' +
        icon(ICONS.warning, 20).replace('class="icon', 'class="msgbar__icon icon') +
        '<div class="msgbar__body">' + esc(S.accessMore) + '</div></div>';
    }
    if (groups.length > 1) {
      h += '<div class="psz-acc__tools">' +
        '<button type="button" class="btn btn--sm btn--ghost" data-psz-acc-all="open">' + esc(S.accessExpandAll) + '</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-psz-acc-all="close">' + esc(S.accessCollapseAll) + '</button></div>';
    }
    h += '<div class="psz-acc__areas">';
    groups.forEach(function (g) {
      var k = normKey(g.area);
      h += '<details class="psz-acc__area" data-psz-area="' + esc(k) + '"' + (closed[k] ? '' : ' open') + '>' +
        '<summary class="psz-acc__summary">' +
        icon('ic-fluent-chevron-down-24-regular', 16).replace('class="icon', 'class="psz-acc__chev icon') +
        '<span class="psz-acc__area-name">' + esc(g.area) + '</span>' +
        '<span class="psz-acc__count">' + esc(fmtStr(S.accessCount, { n: g.people.length })) + '</span></summary>';
      if (!g.people.length) {
        h += '<p class="psz-acc__none">' + esc(S.accessNoEmployees) + '</p>';
      } else {
        h += '<ul class="psz-acc__people">';
        g.people.forEach(function (p) {
          var mail = MAIL_RE.test(p.email) ? p.email : '';
          h += '<li class="psz-acc__person"><span class="psz-acc__name">' + esc(p.name || p.email) + '</span>';
          if (p.name && mail) h += '<a class="psz-acc__email" href="mailto:' + esc(mail) + '">' + esc(mail) + '</a>';
          else if (p.name && p.email) h += '<span class="psz-acc__email">' + esc(p.email) + '</span>';
          h += '</li>';
        });
        h += '</ul>';
      }
      h += '</details>';
    });
    return h + '</div>';
  }
  function renderAccess(def, closed) {
    var cfg = def.cfg, S = cfg._S;
    var h = '<div class="psz-acc lang-keep" lang="' + esc(cfg._lang) + '" data-psz-acc-uid="' + esc(def.uid) + '">';
    if (cfg.formUrl) {
      h += '<a class="psz-acc__back" href="' + esc(cfg.formUrl) + '" data-psz-back data-interception="off">' +
        icon('ic-fluent-chevron-left-24-regular', 16) + '<span>' + esc(cfg.back || S.accessBack) + '</span></a>';
    }
    h += '<div class="psz psz--card">';
    if (cfg.title) {
      h += '<header class="psz__head psz__head--band psz__head--' + esc(TINTS.indexOf(cfg.tint) > -1 ? cfg.tint : 'sky') + '">' +
        '<div class="psz__head-copy"><h2 class="psz__title">' + esc(cfg.title) + '</h2></div></header>';
    }
    h += '<div class="psz__body"><div class="psz__content psz-acc__content">';
    if (cfg.intro) {
      h += '<div class="msgbar msgbar--info psz-acc__intro" role="note">' +
        icon(ICONS.info, 20).replace('class="icon', 'class="msgbar__icon icon') +
        '<div class="msgbar__body">' + prose(cfg.intro) + '</div></div>';
    }
    h += '<div class="psz-acc__body" aria-live="polite">' + accessBody(def, closed) + '</div>';
    return h + '</div></div></div></div>';
  }
  // panels the user collapsed stay collapsed through a re-render
  function accessClosed(def) {
    var closed = keyMap();
    if (def.root) def.root.querySelectorAll('details[data-psz-area]').forEach(function (d) {
      if (!d.open) closed[d.getAttribute('data-psz-area')] = true;
    });
    return closed;
  }
  function paintAccess(def, full) {
    var closed = accessClosed(def);
    if (!full && def.root && def.root.isConnected) {
      def.root.querySelector('.psz-acc__body').innerHTML = accessBody(def, closed);
      return;
    }
    var host = document.createElement('div');
    host.innerHTML = renderAccess(def, closed);
    var root = host.firstChild;
    // the intro's link to the form is a back link too
    root.querySelectorAll('.psz-acc__intro a').forEach(function (a) {
      if (!def.cfg.formUrl || a.getAttribute('href') !== def.cfg.formUrl) return;
      a.removeAttribute('target');
      a.removeAttribute('rel');
      a.setAttribute('data-psz-back', '');
      a.setAttribute('data-interception', 'off');
    });
    if (def.root && def.root.parentNode) def.root.parentNode.replaceChild(root, def.root);
    else def.mount.appendChild(root);
    def.root = root;
  }
  function loadAccess(def) {
    var cfg = def.cfg;
    var seq = def.seq = (def.seq || 0) + 1;
    def.view = { state: 'loading' };
    paintAccess(def);
    var adapter = def.adapter;
    adapter.ready().then(function () {
      var emails = userEmails(adapter.userInfo ? adapter.userInfo() : getUserInfo());
      if (!emails.length) throw new Error('no-user');
      return adapter.getAssignments(cfg.assignments, emails);
    }).then(function (asg) {
      var seen = keyMap(), areas = [];
      (asg.rows || []).forEach(function (r) {
        var a = String(r[cfg.assignments.labelColumn] == null ? '' : r[cfg.assignments.labelColumn]).trim();
        if (a && !seen[normKey(a)]) { seen[normKey(a)] = true; areas.push(a); }
      });
      if (!areas.length) return { areas: [], rows: [], more: !!asg.more };
      return adapter.getAccess(cfg.access, areas).then(function (acc) {
        return { areas: areas, rows: acc.rows || [], more: !!(asg.more || acc.more) };
      });
    }).then(function (d) {
      if (seq !== def.seq) return;
      def.data = d;
      def.view = { state: 'ready' };
      paintAccess(def);
      def.mount.setAttribute('data-psz-state', 'ready');
    }).catch(function (e) {
      if (seq !== def.seq) return;
      console.error('[PS Zone Form] access list load failed:', e);
      reportError(def.raw.errorLog, 'access', e, { config: def.configUrl });
      def.view = { state: 'error', err: e, noUser: !!(e && e.message === 'no-user') };
      paintAccess(def);
      def.mount.setAttribute('data-psz-state', 'ready');
    });
  }
  // Back: a tab a FORM opened (formOpener) that is still on its first page
  // closes, and the form's tab comes forward with its answers intact.
  // Anything else — opened from elsewhere, navigated since, the form tab
  // gone, or a browser that won't let the script close it — follows the link.
  function accessBack(ev, a) {
    if (ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
    var opener = history.length > 1 ? null : formOpener();
    if (!opener) return;
    ev.preventDefault();
    var href = a.href;
    try { opener.focus(); } catch (e) { /* focus is best effort */ }
    try { window.close(); } catch (e) { /* not closable */ }
    setTimeout(function () { location.href = href; }, 300);
  }
  function bindAccess(mount) {
    if (mount.__pszAccBound) return;
    mount.__pszAccBound = true;
    mount.addEventListener('click', function (ev) {
      var def = mount.__pszAcc;
      var t = ev.target && ev.target.closest ? ev.target : null;
      if (!def || !t) return;
      var back = t.closest('[data-psz-back]');
      if (back) { accessBack(ev, back); return; }
      if (t.closest('[data-psz-acc-retry]')) { loadAccess(def); return; }
      var all = t.closest('[data-psz-acc-all]');
      if (all) {
        var open = all.getAttribute('data-psz-acc-all') === 'open';
        def.root.querySelectorAll('details[data-psz-area]').forEach(function (d) { d.open = open; });
      }
    });
  }
  function initAccess(mount) {
    ensureStyles();
    installNavWatcher();
    var configUrl = mount.getAttribute('data-config') || '';
    if (inEditMode()) {
      mount.__pszDeferred = true;
      mount.classList.add('is-suspended', 'is-edit-deferred');
      if (!mount.querySelector('.psz-editnote')) mount.appendChild(editNote(configUrl, DEFAULT_STRINGS));
      return;
    }
    mount.classList.remove('is-suspended', 'is-edit-deferred');
    mount.querySelectorAll('[data-psz-fatal]').forEach(function (n) { n.remove(); });
    mount.setAttribute('data-psz-state', 'initializing');
    var spriteReady = ensureSprite();
    var raw = null;
    loadConfig(mount).then(function (r) {
      raw = r;
      return whenIntl(resLangCfg(r));
    }).then(function () {
      var norm = normalizeAccess(raw, activeLang(resLangCfg(raw)));
      if (norm.errors.length) {
        console.error('[PS Zone Form] access list config errors:', norm.errors);
        throw new Error(norm.errors.join('; '));
      }
      var uid = nextUid();
      var cfg = norm.cfg;
      var def = NS._acc[uid] = mount.__pszAcc = {
        uid: uid, raw: raw, mount: mount, cfg: cfg, root: null, configUrl: configUrl,
        multiLang: (resLangs(raw) || []).length > 1, view: { state: 'loading' }, data: null,
        adapter: makeAdapter({ target: { siteUrl: cfg.access.siteUrl || cfg.assignments.siteUrl || '' } })
      };
      if (def.multiLang) wireIntl();
      bindAccess(mount);
      return spriteReady.then(function () {
        if (!mount.querySelector('.psz-editnote')) mount.appendChild(editNote(configUrl, cfg._S));
        loadAccess(def);
      });
    }).catch(function (e) {
      console.error('[PS Zone Form] access list init failed:', e);
      if (raw && raw.errorLog) reportError(raw.errorLog, 'init', e, { config: configUrl });
      var lang = raw ? activeLang(resLangCfg(raw)) : 'en';
      var S0 = resStrings(lang), mail = '';
      try {
        if (raw && raw.errorContact) mail = errorMailHref(localize(raw.errorContact, lang), localize(raw.title, lang), S0, 'init', e, { config: configUrl }, lang);
      } catch (x) { /* see initMount */ }
      mount.__pszInit = false;
      mount.setAttribute('data-psz-state', 'error');
      fatalCard(mount, S0, e && e.message, mail);
    });
  }
  function relocalizeAccess(def) {
    if (!def.multiLang || !def.root || !def.root.isConnected) return;
    var lang = activeLang(resLangCfg(def.raw));
    if (lang === def.cfg._lang) return;
    var norm = normalizeAccess(def.raw, lang);
    if (norm.errors.length) { console.error('[PS Zone Form] access list config errors (' + lang + '):', norm.errors); return; }
    def.cfg = norm.cfg;
    paintAccess(def, true);
  }

  /* ------------------------------------------------------------------
     Edit mode + boot
     ------------------------------------------------------------------ */
  function inEditMode() {
    return /[?&]Mode=Edit\b/i.test(location.search) || location.pathname.indexOf('/_layouts/') > -1;
  }
  // the web parts this engine mounts: the form, its resources panel and
  // the employee access list
  var MOUNTS = '[data-psz-form], [data-psz-resources], [data-psz-access]';
  function initAny(m) {
    if (m.hasAttribute('data-psz-resources')) initResources(m);
    else if (m.hasAttribute('data-psz-access')) initAccess(m);
    else initMount(m);
  }
  function editNote(configUrl, S) {
    var note = el('div', 'psz-editnote');
    note.innerHTML = icon('ic-fluent-info-24-regular', 20) + '<span>' + esc(S.editModeNote) + ' <code>' + esc(configUrl || 'inline') + '</code></span>';
    return note;
  }

  // While any form on the page is saving, closing, reloading or leaving the
  // page asks first (the browser's own "Leave site?" prompt; its wording
  // can't be set). A SharePoint in-page (SPA) navigation doesn't fire this,
  // which is what the saving overlay's click-blocking scrim is for.
  var unloadGuardInstalled = false;
  function installUnloadGuard() {
    if (unloadGuardInstalled) return;
    unloadGuardInstalled = true;
    window.addEventListener('beforeunload', function (ev) {
      var saving = Object.keys(NS._defs).some(function (uid) {
        var st = NS._defs[uid].store.state;
        return st && st.busy;
      });
      if (!saving) return;
      ev.preventDefault();
      ev.returnValue = '';
      return '';
    });
  }

  var navWatcherInstalled = false;
  function installNavWatcher() {
    if (navWatcherInstalled) return;
    navWatcherInstalled = true;
    function onNav() { setTimeout(applyEditState, 50); }
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      history[fn] = function () { var r = orig.apply(this, arguments); onNav(); return r; };
    });
    window.addEventListener('popstate', onNav);
  }
  function applyEditState() {
    var edit = inEditMode();
    document.querySelectorAll(MOUNTS).forEach(function (m) {
      if (m.__pszDeferred) {
        // still deferred: keep the placeholder up until edit mode ends
        if (!edit) { m.__pszDeferred = false; initAny(m); }
        return;
      }
      m.classList.toggle('is-suspended', edit);
    });
  }

  function fatalCard(mount, S, detail, mailHref) {
    // engine-owned failure UI: tagged so retries can clear it cleanly
    mount.querySelectorAll('[data-psz-fatal]').forEach(function (n) { n.remove(); });
    var bar = el('div', 'msgbar msgbar--danger');
    bar.setAttribute('data-psz-fatal', '');
    bar.setAttribute('role', 'alert');
    bar.innerHTML = icon(ICONS.danger, 20).replace('class="icon', 'class="msgbar__icon icon') +
      '<div class="msgbar__body">' + esc(S.configLoadError) +
      (detail ? '<br><small>' + esc(fmtStr(S.configLoadDetail, { detail: trimErr(detail) })) + '</small>' : '') +
      (mailHref ? '<br><a class="psz-errmail" href="' + esc(mailHref) + '">' + esc(S.errorMailLink) + '</a>' : '') + '</div>';
    mount.appendChild(bar);
  }

  function readInlineConfig(mount) {
    var s = mount.querySelector('script[type="application/json"][data-psz-config]');
    if (!s) return null;
    try { return JSON.parse(s.textContent); } catch (e) { throw new Error('inline config is not valid JSON: ' + e.message); }
  }

  function loadConfig(mount) {
    var url = mount.getAttribute('data-config');
    if (url) {
      return fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
        .then(function (r) {
          if (!r.ok) throw new Error('config HTTP ' + r.status + ' — ' + url);
          return r.json();
        });
    }
    var inline = readInlineConfig(mount);
    if (inline) return Promise.resolve(inline);
    return Promise.reject(new Error('no data-config url and no inline config'));
  }

  function activateAlpine(rootEl) {
    if (window.Alpine) {
      if (!rootEl._x_dataStack) window.Alpine.initTree(rootEl);
      return Promise.resolve();
    }
    return whenAlpine().then(function () {
      // Alpine auto-starts and walks the whole document on load; only roots
      // inserted after that need an explicit init.
      if (window.Alpine && !rootEl._x_dataStack) window.Alpine.initTree(rootEl);
    });
  }

  /* Language switch (intl.setLang): rebuild the form in the new language
     and carry its state over — answers, page, view, loaded rows, user.
     Runs after the current submit settles; a form mid-save isn't touched. */
  function snapshotState(st) {
    var out = {};
    // plain-data copies (answers, rows, result text); open menus/dialogs don't carry
    ['values', 'page', 'view', 'filesMeta', 'promptAck', 'asg', 'me', 'result', 'failMail'].forEach(function (p) {
      out[p] = st[p] === undefined ? undefined : JSON.parse(JSON.stringify(st[p]));
    });
    return out;
  }
  function relocalize(def) {
    if (!def.multiLang || !def.root || !def.root.isConnected) return;
    var lang = activeLang(def.raw);
    if (lang === def.cfg._lang) return;
    var st = def.store.state;
    if (st && st.busy) { setTimeout(function () { relocalize(def); }, 400); return; }
    var norm = normalizeConfig(def.raw, lang);
    if (norm.errors.length) { console.error('[PS Zone Form] config errors (' + lang + '):', norm.errors); return; }
    var cfg = norm.cfg;
    cfg._ordered.forEach(function (f) { f.domId = def.uid + '-' + f.k; });
    def.carry = st ? snapshotState(st) : null;
    def.cfg = cfg;
    var old = def.root;
    try { if (window.Alpine && window.Alpine.destroyTree) window.Alpine.destroyTree(old); } catch (e) { /* best effort */ }
    var host = document.createElement('div');
    host.innerHTML = renderForm(def.uid, cfg);
    var root = host.firstChild;
    old.parentNode.replaceChild(root, old);
    def.root = root;
    activateAlpine(root).then(function () {
      if (def.mount.hasAttribute('data-validate')) runDoctor(def);
    });
  }

  function initMount(mount) {
    ensureStyles();
    installNavWatcher();
    installUnloadGuard();
    var configUrl = mount.getAttribute('data-config') || '';

    if (inEditMode()) {
      // Defer real init and show the inert placeholder. The note is only
      // visible WHILE .is-suspended is present, so the class must stay on
      // for the whole edit session (see ps-zone-attestation.css).
      mount.__pszDeferred = true;
      mount.classList.add('is-suspended', 'is-edit-deferred');
      if (!mount.querySelector('.psz-editnote')) mount.appendChild(editNote(configUrl, DEFAULT_STRINGS));
      return;
    }
    mount.classList.remove('is-suspended', 'is-edit-deferred');
    mount.querySelectorAll('[data-psz-fatal]').forEach(function (n) { n.remove(); });

    mount.setAttribute('data-psz-state', 'initializing');
    var spriteReady = ensureSprite();

    var rawCfg = null;
    loadConfig(mount).then(function (raw) {
      rawCfg = raw;
      return whenIntl(raw);
    }).then(function () {
      var raw = rawCfg;
      var norm = normalizeConfig(raw, activeLang(raw));
      if (norm.errors.length) {
        console.error('[PS Zone Form] config errors:', norm.errors);
        throw new Error(norm.errors.join('; '));
      }
      var cfg = norm.cfg;
      var uid = nextUid();
      cfg._ordered.forEach(function (f) { f.domId = uid + '-' + f.k; });

      var adapter = makeAdapter(cfg);
      var def = NS._defs[uid] = {
        uid: uid, cfg: cfg, raw: raw, mount: mount, adapter: adapter, root: null, carry: null,
        multiLang: (formLangs(raw) || []).length > 1,
        store: { files: {}, fileSeq: 0, itemId: null, itemRef: null, pSeq: {}, state: null, submitAt: null, snap: null, rowsUncertain: false }
      };
      if (def.multiLang) wireIntl();

      return spriteReady.then(function () {
        // edit note first (hidden in view mode by CSS), then the app root
        if (!mount.querySelector('.psz-editnote')) mount.appendChild(editNote(configUrl, cfg.strings));
        var host = document.createElement('div');
        host.innerHTML = renderForm(uid, cfg);
        var root = def.root = host.firstChild;
        mount.appendChild(root);
        return activateAlpine(root).then(function () {
          mount.setAttribute('data-psz-state', 'ready');
          if (mount.hasAttribute('data-validate')) runDoctor(def);
        });
      });
    }).catch(function (e) {
      console.error('[PS Zone Form] init failed:', e);
      // reportable once the config has loaded (it names the error list); a
      // config that can't be fetched at all shows on the page and console only
      if (rawCfg && rawCfg.errorLog) reportError(rawCfg.errorLog, 'init', e, { config: configUrl });
      var lang = rawCfg ? activeLang(rawCfg) : 'en';
      var S0 = resStrings(lang);
      var mail = '';
      try {
        if (rawCfg && rawCfg.errorContact) {
          mail = errorMailHref(localize(rawCfg.errorContact, lang), localize(rawCfg.form && rawCfg.form.title, lang),
            S0, 'init', e, { config: configUrl }, lang);
        }
      } catch (x) { /* a malformed errorContact must not hide the real error */ }
      // config fetches and library loads can fail transiently — leave the
      // mount retryable by the next scan / script re-evaluation
      mount.__pszInit = false;
      mount.setAttribute('data-psz-state', 'error');
      fatalCard(mount, S0, e && e.message, mail);
    });
  }

  NS.scan = function () {
    document.querySelectorAll(MOUNTS).forEach(function (m) {
      if (m.__pszInit) return;
      m.__pszInit = true;
      try { initAny(m); }
      catch (e) {
        console.error('[PS Zone Form] init threw:', e);
        m.__pszInit = false;
        m.setAttribute('data-psz-state', 'error');
        fatalCard(m, DEFAULT_STRINGS, e && e.message);
      }
    });
  };

  // Explicit retry for a mount that failed to initialize (devtools aid; the
  // next NS.scan() would also pick it up since failure clears __pszInit).
  NS.retry = function (mount) {
    if (!mount || mount.getAttribute('data-psz-state') !== 'error') return;
    mount.querySelectorAll('[data-psz-fatal]').forEach(function (n) { n.remove(); });
    mount.__pszInit = false;
    NS.scan();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { NS.scan(); });
  } else {
    NS.scan();
  }
})();
