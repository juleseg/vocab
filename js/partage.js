"use strict";

// === PARTAGE (LISTES COMMUNES ET COPIES) ===
// Étape 30. Mode Supabase seulement (script supabase-etape30.sql). Sans le script : « Partager » affiche
// « Lancez le script SQL de l'étape 30 », le reste de l'appli marche comme avant.
// Deux façons de partager une liste ou un dossier avec des amis (menu de la liste ou du dossier → « Partager ») :
//  - Copie : les données sont copiées au moment de l'envoi dans l'invitation (shared_invites.payload, sans progression) ;
//    si l'ami accepte, elles sont ajoutées à ses données (nouvelles cartes, boîte 0), indépendantes ensuite.
//  - Liste commune : une seule version des cartes, dans shared_cards ; chacun garde sa progression.
//    · Dans l'appli, une liste commune est une liste normale de state.lists avec l.shared = { id (shared_lists),
//      role (owner | read | write), owner, ownerName, folder (dossier commun), team (liste d'équipe, étape 54) } ; un dossier commun : f.shared.
//    · Ses cartes sont ajoutées à state.cards (attach) depuis un cache local (localStorage "vocabfr.shared:<identifiant>"),
//      mais jamais enregistrées dans user_data : seule la progression l'est (clé sharedprogress:<id>, voir STORAGE).
//    · Avant chaque sauvegarde (capture), les cartes des listes communes sont comparées au cache : les différences
//      partent dans une file d'envoi (gardée hors connexion, envoyée au retour). Lecture seule : changements annulés.
//    · Synchro toutes les 2 min (et au retour au premier plan / de la connexion) : envoi de la file, liste des partages
//      (my_shared_lists), puis cartes modifiées depuis la dernière synchro (pas pendant une session de révision).
//    · Conflit : la dernière modification envoyée gagne ; une carte modifiée par quelqu'un d'autre est marquée « ✎ nom ».
// Journal : share_sent, share_accepted, share_declined, share_member_removed, share_left, share_deleted.
const SH_POLL_MS = 120000;      // synchro des listes communes : toutes les 2 min
const SH_BATCH = 200;           // cartes envoyées par requête
const SH_PROG_CHUNK = 2000;     // progression : cartes max par morceau user:<id>:sharedprogress:<liste>[:<n>]
const SH_FLAG_DAYS = 7;         // « modifiée par … » affiché 7 jours au plus (ou jusqu'à l'ouverture de la carte)
const SH_SKIP = ["id", "listId", "box", "dueAt", "stats", "progress"];   // jamais dans la version commune (progress : étape 37)

function isSharedList(l) { return !!(l && l.shared && typeof l.shared.id === "string" && l.shared.id); }
function isSharedFolder(f) { return !!(f && f.shared && typeof f.shared.id === "string" && f.shared.id); }
// Liste modifiable par moi ? (liste normale, ou liste commune dont je suis propriétaire / membre « modifiable »)
function canEditList(x) {
  const l = typeof x === "string" ? getList(x) : x;
  return !isSharedList(l) || l.shared.role !== "read";
}
function shIsOwner(o) { return !!(o && o.shared && o.shared.role === "owner"); }
// Marque de partage gardée par normalizeData (liste ou dossier).
function normSharedMark(o) {
  const out = {};
  const s = o && o.shared;
  if (s && typeof s === "object" && typeof s.id === "string" && /^[0-9a-f-]{36}$/i.test(s.id)) {
    out.shared = { id: s.id, role: ["owner", "read", "write"].includes(s.role) ? s.role : "read",
      owner: String(s.owner || ""), ownerName: String(s.ownerName || "").slice(0, 40) };
    if (typeof s.folder === "string" && /^[0-9a-f-]{36}$/i.test(s.folder)) out.shared.folder = s.folder;
    if (typeof s.team === "string" && /^[0-9a-f-]{36}$/i.test(s.team)) out.shared.team = s.team;   // liste d'équipe (étape 54, recalculé à chaque synchro)
  }
  if (o && typeof o.copiedFrom === "string" && o.copiedFrom) out.copiedFrom = o.copiedFrom.slice(0, 40);
  return out;
}
function normSharedProgress(p) {
  const out = {};
  if (!p || typeof p !== "object" || Array.isArray(p)) return out;
  Object.keys(p).forEach(U => {
    if (!/^[0-9a-f-]{36}$/i.test(U) || !p[U] || typeof p[U] !== "object") return;
    const m = {};
    Object.keys(p[U]).forEach(cid => { const v = p[U][cid]; if (Array.isArray(v)) m[cid] = v.slice(0, 7); });
    out[U] = m;
  });
  return out;
}
// JSON aux clés triées (jsonb ne garde pas l'ordre des champs).
function shStable(v) {
  if (Array.isArray(v)) return "[" + v.map(shStable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + shStable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
// Contenu d'une carte (sans progression), sous forme normalisée.
function shContent(c) {
  const n = normalizeCard(Object.assign({}, c, { id: String(c.id || "x"), listId: "x" }));
  const o = {};
  Object.keys(n).forEach(k => { if (!SH_SKIP.includes(k)) o[k] = n[k]; });
  // Exemples par langue (étape 35) : envoyés seulement s'il y en a (carte inchangée = même contenu qu'avant l'étape 35).
  if (o.examples && typeof o.examples === "object" && !Array.isArray(o.examples) && !Object.keys(o.examples).length) delete o.examples;
  return o;
}
// Progression personnelle d'une carte commune : [boîte, dueAt, vues, sues, ratées, dernière vue, { langue: [mêmes 6 + FSRS] }]
// (7e case : progression par langue étudiée, étape 37 — ignorée par les versions 36 et moins).
// Étape 47 : chaque langue de la 7e case = [boîte, dueAt, vues, sues, ratées, dernière vue, s, d, last, reps, lapses, state, lb]
// (les versions 37 à 46 ne lisent que les 6 premières valeurs ; sans valeurs FSRS → estimées depuis la boîte, comme la migration).
const SH_FSRS = ["s", "d", "last", "reps", "lapses", "state", "lb"];
function shProgArr(b, d, s, P) {
  s = s || {};
  const out = [b, d, num(s.seen, 0), num(s.correct, 0), num(s.wrong, 0), s.lastSeen == null ? null : s.lastSeen];
  if (P && fsrsHas(P)) SH_FSRS.forEach(k => out.push(P[k] == null ? null : P[k]));
  return out;
}
function shProg(c) {
  const out = shProgArr(c.box, c.dueAt, c.stats);
  const pg = c.progress && typeof c.progress === "object" ? c.progress : null;
  if (pg && Object.keys(pg).length) { const o = {}; Object.keys(pg).forEach(L => { o[L] = shProgArr(pg[L].box, pg[L].dueAt, pg[L].stats, pg[L]); }); out.push(o); }
  return out;
}
// Une langue de la 7e case → progression { box, dueAt, stats, champs FSRS } (champs FSRS absents → migration 6 → 7).
function shProgFrom(v) {
  const P = { box: clampInt(v[0], 0, 5, 0), dueAt: num(v[1], 0),
    stats: { seen: num(v[2], 0), correct: num(v[3], 0), wrong: num(v[4], 0), lastSeen: num(v[5], null) } };
  const o = {};
  SH_FSRS.forEach((k, i) => { if (v[6 + i] != null) o[k] = v[6 + i]; });
  const F = fsrsNorm(o);
  if (F) Object.assign(P, F); else fsrsMigrateProg(P);
  return P;
}
function shWithProg(c, p) {
  if (Array.isArray(p)) {
    c.box = clampInt(p[0], 0, 5, 0); c.dueAt = num(p[1], Date.now());
    c.stats = { seen: num(p[2], 0), correct: num(p[3], 0), wrong: num(p[4], 0), lastSeen: num(p[5], null) };
    const o = p[6] && typeof p[6] === "object" && !Array.isArray(p[6]) ? p[6] : null, pg = {};
    if (o) Object.keys(o).forEach(L => { const v = o[L]; if (isLang(L) && Array.isArray(v)) pg[L] = shProgFrom(v); });
    if (Object.keys(pg).length) { c.progress = pg; syncPrimaryProgress(c, primaryLang(c)); } else delete c.progress;
  } else { c.box = 0; c.dueAt = Date.now(); c.stats = { seen: 0, correct: 0, wrong: 0, lastSeen: null }; delete c.progress; }
  return c;
}
// Progression à enregistrer dans user_data : depuis les cartes pour les listes chargées, sinon telle qu'elle a été lue.
function sharedProgressOf(data) {
  const out = {};
  const sh = arr(data && data.lists).filter(isSharedList);
  if (!sh.length) return out;
  const loaded = data.__shLoaded instanceof Set ? data.__shLoaded : null;
  const byLocal = new Map();
  sh.forEach(l => {
    const U = l.shared.id;
    if (loaded && loaded.has(U)) { out[U] = {}; byLocal.set(l.id, out[U]); }
    else out[U] = Object.assign({}, (data.sharedProgress || {})[U] || {});
  });
  if (byLocal.size) arr(data.cards).forEach(c => { const m = byLocal.get(c.listId); if (m) m[c.id] = shProg(c); });
  Object.keys(out).forEach(U => { if (!Object.keys(out[U]).length) delete out[U]; });
  return out;
}

const Shared = (() => {
  let status = "unknown";          // unknown | ok | missing (script de l'étape 30 pas lancé)
  let cache = null, cacheUser = null;
  let busy = false, timer = null, saveTimer = null, flushTimer = null, revertWarned = 0;
  let invites = null, invitesAt = 0, inviteCount = 0, friendsProg = null, lastProgKey = "";
  const view = { busy: false };

  function on() { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); }
  function me() { return auth.sbUid || ""; }
  function myName() { return Storage.getUser() || ""; }
  function isMissing(e) { return alIsMissing(e); }
  async function rpc(name, args) {
    const r = await withTimeout(Supa.client().rpc(name, args || {}), 20000);
    if (r && r.error) throw r.error;
    return r ? r.data : null;
  }
  function errText(e) {
    const hint = String((e && e.hint) || "");
    if (I18N.fr["sh.err." + hint]) return t("sh.err." + hint);
    if (isMissing(e)) return t("sh.missing");
    if (sbErrKind(e) === "net") return t("sh.err.net");
    if (String((e && e.code) || "") === "42501" || /compte bloqué/i.test(String((e && e.message) || ""))) return t("am.err.account_blocked");
    return t("sh.err.other");
  }

  // --- Cache local : { lists: [lignes my_shared_lists], cards: { U: { since, items: { idCarte: { d, s, del, by } } } },
  //     out: { "U|idCarte": { l, c, d, s, del } } (file d'envoi), meta: { U: { name, target, support } }, flags: { idCarte: { by, at } } }
  function key() { return CONFIG.LS_USER_PREFIX + "shared:" + (Storage.getUser() || ""); }
  function emptyCache() { return { v: 1, lists: [], cards: {}, out: {}, meta: {}, flags: {} }; }
  function loadCache() {
    const u = Storage.getUser();
    if (cache && cacheUser === u) return cache;
    cacheUser = u; cache = emptyCache();
    try {
      const c = JSON.parse(localStorage.getItem(key()) || "null");
      if (c && typeof c === "object") {
        cache.lists = arr(c.lists);
        ["cards", "out", "meta", "flags"].forEach(k => { if (c[k] && typeof c[k] === "object" && !Array.isArray(c[k])) cache[k] = c[k]; });
      }
    } catch (e) {}
    return cache;
  }
  function saveCache(now) {
    clearTimeout(saveTimer); saveTimer = null;
    const write = () => { try { if (cache && cacheUser === Storage.getUser()) localStorage.setItem(key(), JSON.stringify(cache)); } catch (e) {} };
    if (now) write(); else saveTimer = setTimeout(write, 500);
  }
  function eff(U) {           // état connu d'une liste : cache + file d'envoi (idCarte → { d, s, del })
    const lc = cache.cards[U], m = {};
    if (lc) Object.keys(lc.items).forEach(cid => { m[cid] = lc.items[cid]; });
    Object.keys(cache.out).forEach(k => { const o = cache.out[k]; if (o.l === U) m[o.c] = o; });
    return m;
  }
  function defHidden(o, k, v) { try { Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true }); } catch (e) {} }
  function cardFrom(U, cid, item, localId, prog) {
    return shWithProg(normalizeCard(Object.assign({}, item.d, { id: cid, listId: localId })), prog);
  }

  // --- Cartes des listes communes ajoutées aux données (au lancement, après une synchro qui remplace les données, import JSON) ---
  function attach(data) {
    data = data || state;
    if (!data || !Array.isArray(data.lists) || !Array.isArray(data.cards)) return;
    loadCache();
    const sh = data.lists.filter(isSharedList);
    const ids = new Set(sh.map(l => l.id));
    if (ids.size) data.cards = data.cards.filter(c => !ids.has(c.listId));
    const loaded = new Set();
    sh.forEach(l => {
      const U = l.shared.id;
      if (!cache.cards[U]) return;
      loaded.add(U);
      const prog = (data.sharedProgress || {})[U] || {}, m = eff(U);
      Object.keys(m).forEach(cid => { if (!m[cid].del) data.cards.push(cardFrom(U, cid, m[cid], l.id, prog[cid])); });
    });
    defHidden(data, "__shLoaded", loaded);
    defHidden(data, "__sh", true);
    pruneProposals(data);
  }
  // Propositions « À valider » sur des cartes qui n'existent plus (une fois toutes les listes communes chargées).
  function pruneProposals(data) {
    const sh = data.lists.filter(isSharedList);
    if (sh.some(l => !data.__shLoaded.has(l.shared.id))) return;
    const ids = new Set(data.cards.map(c => c.id));
    data.proposals = data.proposals.filter(p => p.field === "new" || ids.has(p.cardId));
  }
  // Charge (ou recharge depuis le cache) les cartes d'une liste commune dans state.
  function loadList(l) {
    const U = l.shared.id;
    const prog = Object.assign({}, (state.sharedProgress || {})[U] || {});
    state.cards.forEach(c => { if (c.listId === l.id) prog[c.id] = shProg(c); });
    state.cards = state.cards.filter(c => c.listId !== l.id);
    const m = eff(U);
    Object.keys(m).forEach(cid => { if (!m[cid].del) state.cards.push(cardFrom(U, cid, m[cid], l.id, prog[cid])); });
    if (!(state.__shLoaded instanceof Set)) defHidden(state, "__shLoaded", new Set());
    state.__shLoaded.add(U);
    defHidden(state, "__sh", true);
  }

  // --- Avant chaque sauvegarde : modifications des listes communes → file d'envoi ---
  function capture(data) {
    if (!data || data !== state || !data.__sh || !(data.__shLoaded instanceof Set)) return;
    const sh = data.lists.filter(isSharedList);
    if (!sh.length && !data.folders.some(isSharedFolder)) return;
    loadCache();
    let changed = false, reverted = false;
    const byList = new Map();
    data.cards.forEach(c => { if (!byList.has(c.listId)) byList.set(c.listId, []); byList.get(c.listId).push(c); });
    sh.forEach(l => {
      const U = l.shared.id;
      if (!data.__shLoaded.has(U)) return;
      const m = eff(U), seen = new Set();
      const diffs = [];
      arr(byList.get(l.id)).forEach(c => {
        seen.add(c.id);
        const d = shContent(c), s = shStable(d), e = m[c.id];
        if (!e || e.del || e.s !== s) diffs.push({ c: c.id, d, s, del: false });
      });
      Object.keys(m).forEach(cid => { if (!m[cid].del && !seen.has(cid)) diffs.push({ c: cid, d: m[cid].d, s: m[cid].s, del: true }); });
      if (!diffs.length) return;
      if (l.shared.role === "read") { loadList(l); reverted = true; return; }   // lecture seule : on remet la version commune
      diffs.forEach(x => { cache.out[U + "|" + x.c] = { l: U, c: x.c, d: x.d, s: x.s, del: x.del }; });
      changed = true;
    });
    // Propriétaire : nom et langues des listes / dossiers communs.
    data.lists.filter(shIsOwner).concat(data.folders.filter(shIsOwner)).forEach(o => {
      const row = cache.lists.find(r => r.id === o.shared.id);
      if (!row) return;
      const lg = data.folders.includes(o) ? folderLangs(o) : listLangs(o);
      // Langues d'appui calculées par chaque appareil (étape 31) : seuls le nom et la langue apprise sont envoyés ; support inchangé.
      const want = { name: o.name, target: lg.target, support: arr(row.support).slice().sort() };
      const have = { name: row.name, target: row.target, support: arr(row.support).slice().sort() };
      if (shStable(want) !== shStable(have) && shStable(want) !== shStable(cache.meta[o.shared.id] || null)) { cache.meta[o.shared.id] = want; changed = true; }
    });
    if (reverted && Date.now() - revertWarned > 5000) { revertWarned = Date.now(); setTimeout(() => toast(t("sh.readOnlyReverted")), 0); }
    if (changed) { saveCache(); scheduleFlush(); }
    else if (reverted) saveCache();
  }
  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; if (on() && navigator.onLine !== false) flushAll().then(n => { if (n) render(); }); }, 2500);
  }

  // --- Envoi de la file (cartes) et des noms / langues ---
  let flushing = null;
  function flushAll() {
    if (flushing) return flushing;
    flushing = (async () => {
      loadCache();
      let n = 0;
      for (const U of Object.keys(cache.meta)) {
        const m = cache.meta[U];
        try {
          await rpc("share_update", { p_list: U, p_name: m.name, p_target: m.target, p_support: m.support });
          const row = cache.lists.find(r => r.id === U);
          if (row) Object.assign(row, { name: m.name, target: m.target, support: m.support });
          delete cache.meta[U];
        } catch (e) {
          if (sbErrKind(e) === "net" || isMissing(e)) break;
          delete cache.meta[U];          // plus propriétaire ou liste supprimée : abandon
        }
      }
      const keys = Object.keys(cache.out);
      for (let i = 0; i < keys.length; i += SH_BATCH) {
        const part = keys.slice(i, i + SH_BATCH).map(k => cache.out[k]).filter(Boolean);
        if (!part.length) continue;
        const rows = part.map(o => ({ list_id: o.l, card_id: o.c, data: o.d, deleted: !!o.del }));
        const r = await withTimeout(Supa.client().from("shared_cards").upsert(rows, { onConflict: "list_id,card_id" }), 20000).catch(e => ({ error: e }));
        if (r && r.error) {
          if (sbErrKind(r.error) === "net" || isMissing(r.error)) break;
          // Plus le droit d'écrire (retiré, passé en lecture seule, liste supprimée) : on abandonne ces envois,
          // la prochaine synchro remet la version commune.
          part.forEach(o => { delete cache.out[o.l + "|" + o.c]; });
          continue;
        }
        part.forEach(o => {
          const k = o.l + "|" + o.c;
          if (cache.out[k] !== o) return;            // modifiée encore entre-temps : repartira
          delete cache.out[k];
          if (!cache.cards[o.l]) cache.cards[o.l] = { since: null, items: {} };
          cache.cards[o.l].items[o.c] = { d: o.d, s: o.s, del: !!o.del, by: me() };
        });
        n += part.length;
      }
      saveCache(true);
      return n;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  // --- Synchro complète ---
  async function sync(opts) {
    if (!on() || busy) return;
    busy = true;
    try {
      loadCache();
      if (navigator.onLine !== false) await flushAll();
      const rows = await rpc("my_shared_lists");
      status = "ok";
      cache.lists = arr(rows);
      // dirty : listes ou dossiers changés (enregistrés) ; seen : seulement des cartes (affichage rafraîchi)
      let dirty = applyLists(), seen = false;
      if (!(rv && rv.phase === "run")) {        // pas pendant une session de révision
        for (const row of cache.lists.filter(r => !r.is_folder)) {
          if (await pull(row.id)) seen = true;
        }
      }
      if (await convertNew()) dirty = true;
      saveCache(true);
      if (dirty) commitQuiet();
      if ((dirty || seen) && ["lists", "home", "review", "stats"].includes(currentScreen) && !(rv && rv.phase === "run")) renderScreen();
      refreshInvites(false);
      publishProgress(false);
    } catch (e) {
      if (isMissing(e)) status = "missing";
    } finally { busy = false; }
  }

  // Listes et dossiers communs (my_shared_lists) → state.lists / state.folders. Renvoie true si quelque chose a changé.
  function applyLists() {
    const rows = cache.lists, byId = new Map(rows.map(r => [r.id, r]));
    let changed = false;
    const notes = [];
    // Dossiers communs
    state.folders.filter(isSharedFolder).forEach(f => {
      const r = byId.get(f.shared.id);
      if (!r) { delete f.shared; changed = true; return; }                 // plus partagé : dossier normal
      const s = { id: r.id, role: r.role, owner: r.owner, ownerName: r.owner_ident || "" };
      if (r.team_id) s.team = r.team_id;              // dossier d'équipe (étape 54)
      if (shStable(s) !== shStable(f.shared)) { f.shared = s; changed = true; }
      if (r.role !== "owner" && f.name !== r.name && !cache.meta[r.id]) { f.name = r.name; changed = true; }
    });
    rows.filter(r => r.is_folder && !state.folders.some(f => isSharedFolder(f) && f.shared.id === r.id)).forEach(r => {
      // dossier commun accepté sur un autre appareil : on le crée ici
      const mine = r.my_folder && getFolder(r.my_folder);
      if (mine && !isSharedFolder(mine)) mine.shared = { id: r.id, role: r.role, owner: r.owner, ownerName: r.owner_ident || "" };
      else state.folders.push({ id: uid(), name: r.name, order: nextOrder(state.folders), shared: { id: r.id, role: r.role, owner: r.owner, ownerName: r.owner_ident || "" } });
      changed = true;
    });
    // Listes communes disparues (retiré, liste supprimée, plus amis…)
    state.lists.filter(isSharedList).forEach(l => {
      if (byId.has(l.shared.id)) return;
      const U = l.shared.id;
      if (l.shared.role === "owner") { delete l.shared; notes.push(t("sh.backPrivate", { name: l.name })); }   // ses cartes restent chez lui
      else {
        state.lists = state.lists.filter(x => x !== l);
        state.cards = state.cards.filter(c => c.listId !== l.id);
        notes.push(t("sh.gone", { name: l.name }));
      }
      if (state.sharedProgress) delete state.sharedProgress[U];
      if (state.__shLoaded instanceof Set) state.__shLoaded.delete(U);
      delete cache.cards[U];
      Object.keys(cache.out).forEach(k => { if (cache.out[k].l === U) delete cache.out[k]; });
      changed = true;
    });
    // Nouvelles listes communes, ou mises à jour (nom, langues, droit)
    rows.filter(r => !r.is_folder).forEach(r => {
      let l = state.lists.find(x => isSharedList(x) && x.shared.id === r.id);
      const s = { id: r.id, role: r.role, owner: r.owner, ownerName: r.owner_ident || "" };
      if (r.folder) s.folder = r.folder;
      if (r.team_id) s.team = r.team_id;              // liste d'équipe (étape 54)
      if (!l) {
        const fd = (r.folder && state.folders.find(f => isSharedFolder(f) && f.shared.id === r.folder)) || (r.my_folder && getFolder(r.my_folder)) || null;
        const fid = fd ? fd.id : null;
        let id = "sh_" + r.id;
        if (getList(id)) id = uid();
        l = { id, name: r.name, folderId: fid, order: nextOrder(listsIn(fid)), createdAt: Date.now(),
          target: r.target, shared: s };   // langue d'appui : celle du profil de chacun (étape 35)
        state.lists.push(l);
        if (r.role !== "owner") notes.push(t("sh.arrived", { name: r.name, id: r.owner_ident || "?" }));
        changed = true;
        return;
      }
      if (shStable(s) !== shStable(l.shared)) { l.shared = s; changed = true; }
      if (r.role !== "owner" || !cache.meta[r.id]) {
        if (r.role !== "owner" && l.name !== r.name) { l.name = r.name; changed = true; }
        if (r.role !== "owner" && l.target !== r.target) { l.target = r.target; changed = true; }   // appui propre à chacun (étape 35)
      }
    });
    if (notes.length) setTimeout(() => toast(notes.slice(0, 3).join(" · ")), 0);
    return changed;
  }

  // Cartes modifiées depuis la dernière synchro (10 s de marge, sans doublon). Renvoie true si state a changé.
  async function pull(U) {
    const l = state.lists.find(x => isSharedList(x) && x.shared.id === U);
    if (!l) return false;
    const first = !cache.cards[U];
    if (first) cache.cards[U] = { since: null, items: {} };
    const lc = cache.cards[U];
    const since = lc.since ? new Date(Date.parse(lc.since) - 10000).toISOString() : "1970-01-01T00:00:00Z";
    let rows = [], from = 0;
    for (;;) {
      const r = await withTimeout(Supa.client().from("shared_cards").select("card_id,data,deleted,updated_at,updated_by")
        .eq("list_id", U).gt("updated_at", since).order("updated_at", { ascending: true }).range(from, from + 999), 20000);
      if (r && r.error) throw r.error;
      const got = arr(r && r.data);
      rows = rows.concat(got);
      if (got.length < 1000) break;
      from += 1000;
    }
    const names = new Map();
    arr((cache.lists.find(x => x.id === (l.shared.folder || U)) || {}).members).forEach(m => names.set(m.user_id, m.identifiant));
    const row = cache.lists.find(x => x.id === U);
    if (row) names.set(row.owner, row.owner_ident);
    let changed = first;
    if (first) {               // première fois : on garde la progression déjà enregistrée
      rows.forEach(r => storeItem(lc, r));
      loadList(l);
      return true;
    }
    if (!(state.__shLoaded instanceof Set) || !state.__shLoaded.has(U)) loadList(l);
    rows.forEach(r => {
      const cid = String(r.card_id);
      const prev = lc.items[cid];
      const it = storeItem(lc, r);
      const pend = cache.out[U + "|" + cid];
      const other = r.updated_by && r.updated_by !== me();
      if (pend) {
        if (pend.s === it.s && !!pend.del === it.del) delete cache.out[U + "|" + cid];   // déjà envoyée
        else if (other) cache.flags[cid] = { by: names.get(r.updated_by) || "?", at: Date.now() };   // ma version repartira (dernière)
        return;
      }
      if (prev && prev.s === it.s && prev.del === it.del) return;
      if (other && prev) cache.flags[cid] = { by: names.get(r.updated_by) || "?", at: Date.now() };
      const idx = state.cards.findIndex(c => c.id === cid && c.listId === l.id);
      if (it.del) { if (idx >= 0) { state.cards.splice(idx, 1); changed = true; } return; }
      if (idx >= 0) {                   // mise à jour sur place (la progression reste)
        const c = state.cards[idx];
        Object.keys(c).forEach(k => { if (!SH_SKIP.includes(k) && !(k in it.d)) delete c[k]; });
        Object.assign(c, JSON.parse(JSON.stringify(it.d)));
      } else state.cards.push(cardFrom(U, cid, it, l.id, ((state.sharedProgress || {})[U] || {})[cid]));
      changed = true;
    });
    return changed;
  }
  function storeItem(lc, r) {
    const cid = String(r.card_id);
    const d = shContent(Object.assign({}, r.data || {}, { id: cid }));
    const it = { d, s: shStable(d), del: !!r.deleted, by: r.updated_by || "" };
    lc.items[cid] = it;
    if (r.updated_at && (!lc.since || Date.parse(r.updated_at) > Date.parse(lc.since))) lc.since = r.updated_at;
    return it;
  }

  // --- Propriétaire : liste ajoutée (ou déplacée) dans un de ses dossiers communs → partagée aussi ---
  async function convertNew() {
    let changed = false;
    for (const f of state.folders.filter(f => isSharedFolder(f) && f.shared.role === "owner")) {
      if (!cache.lists.some(r => r.id === f.shared.id)) continue;
      for (const l of listsIn(f.id).filter(l => !isSharedList(l))) {
        try { await makeCommon(l, f.shared.id); changed = true; } catch (e) { break; }
      }
    }
    return changed;
  }
  // Transforme une de mes listes en liste commune (cartes envoyées dans shared_cards). Renvoie l'id commun.
  async function makeCommon(l, folderU, onProgress) {
    if (isSharedList(l)) return l.shared.id;
    const lg = listLangs(l);
    const r = await rpc("share_create", { p_name: l.name, p_target: lg.target, p_support: lg.support, p_is_folder: false, p_folder: folderU || null });
    const U = r && r.id;
    if (!U) throw new Error("share_create");
    const cards = cardsOf(l.id);
    const items = {};
    try {
      for (let i = 0; i < cards.length; i += SH_BATCH) {
        const part = cards.slice(i, i + SH_BATCH).map(c => { const d = shContent(c); items[c.id] = { d, s: shStable(d), del: false, by: me() }; return { list_id: U, card_id: c.id, data: d, deleted: false }; });
        const w = await withTimeout(Supa.client().from("shared_cards").upsert(part, { onConflict: "list_id,card_id" }), 30000);
        if (w && w.error) throw w.error;
        if (onProgress) onProgress(Math.min(1, (i + SH_BATCH) / cards.length));
      }
    } catch (e) {
      try { await rpc("share_delete", { p_list: U }); } catch (e2) {}
      throw e;
    }
    loadCache();
    cache.cards[U] = { since: null, items };
    cache.lists.push({ id: U, is_folder: false, folder: folderU || null, owner: me(), owner_ident: myName(), name: l.name,
      target: lg.target, support: lg.support.slice(), role: "owner", members: [] });
    l.shared = { id: U, role: "owner", owner: me(), ownerName: myName() };
    if (folderU) l.shared.folder = folderU;
    if (!(state.__shLoaded instanceof Set)) defHidden(state, "__shLoaded", new Set());
    state.__shLoaded.add(U);
    defHidden(state, "__sh", true);
    saveCache(true);
    commitQuiet();
    return U;
  }
  async function makeCommonFolder(f, onProgress) {
    if (isSharedFolder(f)) { await convertNew(); return f.shared.id; }
    const lg = folderLangs(f);
    const r = await rpc("share_create", { p_name: f.name, p_target: lg.target, p_support: lg.support, p_is_folder: true, p_folder: null });
    const F = r && r.id;
    if (!F) throw new Error("share_create");
    loadCache();
    cache.lists.push({ id: F, is_folder: true, folder: null, owner: me(), owner_ident: myName(), name: f.name,
      target: lg.target, support: lg.support.slice(), role: "owner", members: [] });
    f.shared = { id: F, role: "owner", owner: me(), ownerName: myName() };
    commitQuiet();
    const lists = listsIn(f.id).filter(l => !isSharedList(l));
    for (let i = 0; i < lists.length; i++) {
      await makeCommon(lists[i], F, p => { if (onProgress) onProgress((i + p) / lists.length); });
    }
    return F;
  }

  // --- Progression personnelle publiée (vue par les amis selon la confidentialité) ---
  function progressItems() {
    const o = {};
    state.lists.filter(isSharedList).forEach(l => {
      if (!(state.__shLoaded instanceof Set) || !state.__shLoaded.has(l.shared.id)) return;
      const cs = cardsOf(l.id);
      const n = { known: 0, review: 0, unknown: 0 };   // catégories (FSRS depuis l'étape 47, langue principale de la carte)
      cs.forEach(c => { n[Leitner.category(c, primaryLang(c))]++; });
      o[l.shared.id] = { n: cs.length, su: n.known, rev: n.review, ps: n.unknown };
    });
    return o;
  }
  async function publishProgress(force) {
    if (!on() || status === "missing") return;
    const items = progressItems();
    if (!Object.keys(items).length) return;
    const k = shStable(items);
    if (!force && k === lastProgKey) return;
    try { await rpc("share_progress_publish", { p_items: items }); lastProgKey = k; } catch (e) {}
  }

  // --- Invitations ---
  async function refreshInvites(full) {
    if (!on()) { inviteCount = 0; return; }
    try {
      if (full) {
        invites = await rpc("my_share_invites"); invitesAt = Date.now();
        inviteCount = arr(invites && invites.incoming).length;
      } else inviteCount = num(Number(await rpc("share_incoming_count")), 0);
      status = "ok";
    } catch (e) { if (isMissing(e)) { status = "missing"; inviteCount = 0; } }
    Friends.renderBadge();
  }
  async function loadFriendsView() {
    if (!on()) return;
    try {
      const [inv, fp] = await Promise.all([rpc("my_share_invites"), rpc("friends_shared_progress")]);
      invites = inv; invitesAt = Date.now(); inviteCount = arr(inv && inv.incoming).length;
      friendsProg = {};
      arr(fp).forEach(x => { friendsProg[x.user_id] = arr(x.lists); });
      status = "ok";
    } catch (e) { if (isMissing(e)) status = "missing"; }
  }

  // --- Marques « modifiée par … » ---
  function flagOf(cid) {
    if (!cache) return null;
    const f = cache.flags[cid];
    if (!f) return null;
    if (Date.now() - num(f.at, 0) > SH_FLAG_DAYS * 86400000) { delete cache.flags[cid]; saveCache(); return null; }
    return f;
  }
  function clearFlag(cid) { if (cache && cache.flags[cid]) { delete cache.flags[cid]; saveCache(); } }
  function flagCount(listId) { if (!cache) return 0; return cardsOf(listId).filter(c => flagOf(c.id)).length; }
  function pendingCount() { return cache ? Object.keys(cache.out).length : 0; }
  function listRow(U) { return cache ? cache.lists.find(r => r.id === U) || null : null; }
  function dropList(U) {
    loadCache();
    delete cache.cards[U]; delete cache.meta[U];
    Object.keys(cache.out).forEach(k => { if (cache.out[k].l === U) delete cache.out[k]; });
    cache.lists = cache.lists.filter(r => r.id !== U && r.folder !== U);
    if (state.sharedProgress) delete state.sharedProgress[U];
    if (state.__shLoaded instanceof Set) state.__shLoaded.delete(U);
    saveCache(true);
  }

  // --- Lancement / arrêt ---
  function start() {
    stop();
    loadCache();
    if (!on()) return;
    status = "unknown";
    sync();
    refreshInvites(false);
    timer = setInterval(() => { if (on() && document.visibilityState !== "hidden") sync(); }, SH_POLL_MS);
  }
  function stop() { clearInterval(timer); timer = null; }
  function reset() {
    stop(); saveCache(true);
    cache = null; cacheUser = null; status = "unknown"; invites = null; inviteCount = 0; friendsProg = null; lastProgKey = "";
    view.busy = false;
  }
  try {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && timer) sync(); });
    window.addEventListener("online", () => { if (timer) sync(); });
  } catch (e) {}
  Storage.onBeforeSave(capture);

  return {
    on, rpc, errText, attach, capture, sync, flushAll, makeCommon, makeCommonFolder, publishProgress, refreshInvites, loadFriendsView,
    flagOf, clearFlag, flagCount, pendingCount, listRow, dropList, start, reset, loadCache, view,
    status: () => status, setStatus: s => { status = s; }, invites: () => invites, inviteCount: () => (on() ? inviteCount : 0),
    friendsProgress: () => friendsProg
  };
})();

// --- Partager : choix des amis puis « Envoyer une copie » ou « Liste commune » ---
// kind = "list" | "folder". Liste d'un dossier commun : le partage commun se fait par le dossier.
async function openShare(kind, id) {
  const obj = kind === "folder" ? getFolder(id) : getList(id);
  if (!obj) return;
  if (!Shared.on()) { openModal(t("sh.title"), el("p", null, t("sh.offline")), [{ label: t("sh.close") }]); return; }
  const close = openModal(t("sh.title"), el("p", "muted", t("am.loading")), [], { locked: true });
  let friends = [];
  try {
    const [d] = await Promise.all([Shared.rpc("my_friends"), Shared.rpc("share_incoming_count")]);
    friends = arr(d && d.friends);
    Shared.setStatus("ok");
  } catch (e) {
    close();
    if (alIsMissing(e)) { Shared.setStatus("missing"); openModal(t("sh.title"), el("p", "q-err", t("sh.missing")), [{ label: t("sh.close") }]); }
    else toast(Shared.errText(e));
    return;
  }
  close();
  if (!friends.length) { openModal(t("sh.title"), el("p", null, t("sh.noFriends")), [{ label: t("sh.close") }]); return; }
  const shared = kind === "folder" ? isSharedFolder(obj) : isSharedList(obj);
  const child = kind === "list" && isSharedList(obj) && !!obj.shared.folder;
  const commonOk = (!shared || shIsOwner(obj)) && !child;
  const top = shared ? (kind === "list" && obj.shared.folder ? obj.shared.folder : obj.shared.id) : null;
  const members = new Map(arr((top && Shared.listRow(top) || {}).members).map(m => [m.user_id, m]));
  const cards = kind === "folder" ? cardsUnder("folder", obj) : cardsOf(obj.id);
  const st = { mode: "copy", picks: new Map() };   // user_id → role
  const wrap = el("div", "sh-wrap");
  const draw = () => {
    wrap.textContent = "";
    wrap.appendChild(el("p", "muted", t(kind === "folder" ? "sh.whatFolder" : "sh.whatList", { name: obj.name, n: cards.length, l: kind === "folder" ? listsIn(obj.id).length : 1 })));
    const seg = el("div", "seg");
    [["copy", t("sh.modeCopy")], ["common", t("sh.modeCommon")]].forEach(([k, label]) => {
      const b = el("button", null, label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(st.mode === k));
      b.disabled = k === "common" && !commonOk;
      b.addEventListener("click", () => { st.mode = k; draw(); });
      seg.appendChild(b);
    });
    wrap.appendChild(formField(t("sh.mode"), seg));
    wrap.appendChild(el("div", "hint", t(st.mode === "copy" ? "sh.copyHint" : "sh.commonHint")));
    if (!commonOk) wrap.appendChild(el("div", "hint", t(child ? "sh.childHint" : "sh.notOwnerHint")));
    const box = el("div", "sh-friends");
    friends.forEach(f => {
      const row = el("div", "sh-friend");
      const lab = el("label", "check-row");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = st.picks.has(f.user_id);
      cb.addEventListener("change", () => { if (cb.checked) st.picks.set(f.user_id, st.picks.get(f.user_id) || "read"); else st.picks.delete(f.user_id); draw(); });
      const m = members.get(f.user_id);
      lab.append(cb, document.createTextNode(f.identifiant + (st.mode === "common" && m ? " (" + t("sh.alreadyMember") + ")" : "")));
      row.appendChild(lab);
      if (st.mode === "common" && st.picks.has(f.user_id)) {
        const sel = el("select", "input sh-role");
        [["read", t("sh.role.read")], ["write", t("sh.role.write")]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; sel.appendChild(o); });
        sel.value = st.picks.get(f.user_id);
        sel.setAttribute("aria-label", t("sh.roleFor", { id: f.identifiant }));
        sel.addEventListener("change", () => st.picks.set(f.user_id, sel.value));
        row.appendChild(sel);
      }
      box.appendChild(row);
    });
    wrap.appendChild(formField(t("sh.friends"), box));
  };
  draw();
  openModal(t("sh.titleName", { name: obj.name }), wrap, [
    { label: t("cancel") },
    { label: t("sh.send"), kind: "primary", onClick: () => {
      if (!st.picks.size) { toast(t("sh.pickFriend")); return false; }
      if (st.mode === "copy" && cards.length > 20000) { toast(t("sh.err.sh_big")); return false; }
      const picks = friends.filter(f => st.picks.has(f.user_id)).map(f => ({ user_id: f.user_id, identifiant: f.identifiant, role: st.picks.get(f.user_id) }));
      shSend(kind, obj, st.mode, picks);
    } }
  ]);
}
// Copie envoyée dans l'invitation : dossier (facultatif) + listes + cartes, sans progression.
function shPayload(kind, obj) {
  const lists = kind === "folder" ? listsIn(obj.id) : [obj];
  const lgOf = l => { const lg = listLangs(l); return { target: lg.target, support: lg.support.slice() }; };
  const out = { v: 1, what: kind, folder: null, lists: [] };
  if (kind === "folder") { const lg = folderLangs(obj); out.folder = { name: obj.name, target: lg.target, support: lg.support.slice() }; }
  lists.forEach(l => out.lists.push(Object.assign({ name: l.name }, lgOf(l), { cards: cardsOf(l.id).map(shContent) })));
  return out;
}
async function shSend(kind, obj, mode, picks) {
  const prog = openProgress(t("sh.sending"), t(mode === "copy" ? "sh.modeCopy" : "sh.modeCommon"));
  try {
    let res, n = 0;
    if (mode === "copy") {
      const payload = shPayload(kind, obj);
      payload.lists.forEach(l => { n += l.cards.length; });
      prog.set(0.4);
      res = await Shared.rpc("share_invite", { p_kind: "copy", p_what: kind, p_targets: picks.map(x => ({ user_id: x.user_id })),
        p_list: null, p_name: obj.name, p_payload: payload, p_cards: n, p_lists: payload.lists.length });
    } else {
      const U = kind === "folder" ? await Shared.makeCommonFolder(obj, f => prog.set(f * 0.9)) : await Shared.makeCommon(obj, null, f => prog.set(f * 0.9));
      res = await Shared.rpc("share_invite", { p_kind: "common", p_what: kind, p_targets: picks.map(x => ({ user_id: x.user_id, role: x.role })),
        p_list: U, p_name: obj.name });
    }
    prog.close();
    const ok = arr(res).filter(r => ["sent", "updated", "member"].includes(r.result));
    const ko = arr(res).filter(r => !["sent", "updated", "member"].includes(r.result));
    if (ok.length) Activity.log("share_sent", { kind: mode, what: kind, name: String(obj.name).slice(0, 60), n: ok.length, target: ok.map(r => r.identifiant).join(", ").slice(0, 120) });
    const msg = [];
    if (ok.length) msg.push(t("sh.sent", { ids: ok.map(r => r.identifiant).join(", ") }));
    if (ko.length) msg.push(t("sh.refused", { ids: ko.map(r => r.identifiant).join(", ") }));
    toast(msg.join(" · "));
    render();
    Shared.sync();
  } catch (e) {
    prog.close();
    if (alIsMissing(e)) Shared.setStatus("missing");
    toast(Shared.errText(e));
    render();
  }
}

// --- Gérer une liste ou un dossier commun ---
// Propriétaire : membres, droits, retirer, invitations en attente, supprimer. Membre : quitter (option « garder une copie »).
async function openShareManage(kind, id) {
  const obj = kind === "folder" ? getFolder(id) : getList(id);
  if (!obj || !obj.shared) return;
  const s = obj.shared;
  const top = kind === "list" && s.folder ? s.folder : s.id;
  const topFolder = state.folders.find(f => isSharedFolder(f) && f.shared.id === top) || null;
  const close = openModal(obj.name, el("p", "muted", t("am.loading")), [], { locked: true });
  let rows = null, inv = null, err = "";
  if (Shared.on()) {
    try { [rows, inv] = await Promise.all([Shared.rpc("my_shared_lists"), Shared.rpc("my_share_invites")]); }
    catch (e) { err = Shared.errText(e); if (alIsMissing(e)) Shared.setStatus("missing"); }
  } else err = t("sh.offline");
  close();
  const row = arr(rows).find(r => r.id === top) || Shared.listRow(top) || null;
  const wrap = el("div", "sh-wrap");
  const owner = s.role === "owner";
  wrap.appendChild(el("p", "muted", owner ? t(kind === "folder" || topFolder && top !== s.id ? "sh.ownFolder" : "sh.ownList")
    : t("sh.memberOf", { id: s.ownerName || "?", role: t("sh.role." + s.role) })));
  if (kind === "list" && s.folder) wrap.appendChild(el("p", "hint", t("sh.inFolder", { name: topFolder ? topFolder.name : (row && row.name) || "?" })));
  if (err) wrap.appendChild(el("p", "q-err", err));
  const busy = () => Shared.view.busy;
  const act = async (fn, after) => {
    if (busy()) return;
    Shared.view.busy = true;
    try { await fn(); if (after) after(); } catch (e) { toast(Shared.errText(e)); }
    Shared.view.busy = false;
  };
  const reopen = () => { closeMain(); openShareManage(kind, id); };
  // Membres
  const mem = arr(row && row.members);
  if (mem.length) {
    const box = el("div", "sh-members");
    mem.forEach(m => {
      const r = el("div", "am-row");
      const who = el("div", "am-who");
      who.append(el("div", "am-id", m.identifiant + (m.user_id === auth.sbUid ? " (" + t("am.rankMe") + ")" : "")),
        el("div", "muted am-sub", (m.role === "owner" ? t("sh.role.owner") : t("sh.role." + m.role)) + (m.active === false ? " · " + t("sh.notFriend") : "")));
      r.appendChild(who);
      if (owner && m.role !== "owner") {
        const btns = el("div", "am-btns");
        const sel = el("select", "input sh-role");
        [["read", t("sh.role.read")], ["write", t("sh.role.write")]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; sel.appendChild(o); });
        sel.value = m.role;
        sel.setAttribute("aria-label", t("sh.roleFor", { id: m.identifiant }));
        sel.addEventListener("change", () => act(() => Shared.rpc("share_set_role", { p_list: top, p_user: m.user_id, p_role: sel.value }),
          () => toast(t("sh.roleDone", { id: m.identifiant, role: t("sh.role." + sel.value) }))));
        const rm = el("button", "am-btn danger", t("sh.removeMember"));
        rm.type = "button";
        rm.addEventListener("click", () => openModal(t("sh.removeMember"), el("p", null, t("sh.removeAsk", { id: m.identifiant, name: obj.name })), [
          { label: t("cancel") },
          { label: t("sh.removeMember"), kind: "danger", onClick: () => { act(() => Shared.rpc("share_remove_member", { p_list: top, p_user: m.user_id }), () => {
            Activity.log("share_member_removed", { name: String((row && row.name) || obj.name).slice(0, 60), target: m.identifiant });
            toast(t("sh.removed", { id: m.identifiant })); reopen(); Shared.sync();
          }); } }
        ]));
        btns.append(sel, rm);
        r.appendChild(btns);
      }
      box.appendChild(r);
    });
    wrap.appendChild(formField(t("sh.members", { n: mem.length }), box));
  }
  // Invitations en attente (propriétaire)
  const pend = owner ? arr(inv && inv.outgoing).filter(x => x.list_id === top) : [];
  if (pend.length) {
    const box = el("div");
    pend.forEach(x => {
      const r = el("div", "am-row");
      const who = el("div", "am-who");
      who.append(el("div", "am-id", x.identifiant), el("div", "muted am-sub", t("sh.role." + (x.role || "read")) + " · " + queueDate(x.created_at)));
      const b = el("button", "am-btn", t("am.cancel"));
      b.type = "button";
      b.addEventListener("click", () => act(() => Shared.rpc("share_invite_cancel", { p_id: x.id }), () => { toast(t("sh.invCanceled", { id: x.identifiant })); reopen(); }));
      const btns = el("div", "am-btns"); btns.appendChild(b);
      r.append(who, btns);
      box.appendChild(r);
    });
    wrap.appendChild(formField(t("sh.pendingInv"), box));
  }
  const pendingSend = Shared.pendingCount();
  if (pendingSend) wrap.appendChild(el("p", "hint", t("sh.pendingSend", { n: pendingSend })));
  const actions = [];
  if (owner) {
    if (!(kind === "list" && s.folder)) actions.push({ label: t("sh.inviteMore"), onClick: () => { openShare(kind, id); } });
    actions.push({ label: t(kind === "folder" ? "sh.deleteFolder" : "sh.deleteList"), kind: "danger", onClick: () => { shConfirmDelete(kind, obj); } });
  } else {
    actions.push({ label: t("sh.copyOnly"), onClick: () => { openShare(kind, id); } });
    actions.push({ label: t(top !== s.id || kind === "folder" ? "sh.leaveFolder" : "sh.leave"), kind: "danger", onClick: () => { shConfirmLeave(kind, obj, top, row); } });
  }
  actions.push({ label: t("sh.close") });
  const closeMain = openModal(t("sh.manageTitle", { name: obj.name }), wrap, actions);
}
// Case « garder une copie » (cochée par défaut).
function shKeepBox(labelKey) {
  const lab = el("label", "check-row");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = true;
  lab.append(cb, document.createTextNode(t(labelKey)));
  return { node: lab, get: () => cb.checked };
}
// Listes locales concernées par un id commun (liste seule, ou dossier commun et toutes ses listes).
function shLocalLists(U) { return state.lists.filter(l => isSharedList(l) && (l.shared.id === U || l.shared.folder === U)); }
// Liste commune → liste normale (nouvel id local, cartes et progression gardées).
function shToPrivate(l, newId) {
  if (newId) {
    const nid = uid();
    state.cards.forEach(c => { if (c.listId === l.id) c.listId = nid; });
    if (lv.listId === l.id) lv.listId = nid;
    l.id = nid;
  }
  delete l.shared;
}
function shDropLists(lists) {
  const ids = new Set(lists.map(l => l.id));
  state.lists = state.lists.filter(l => !ids.has(l.id));
  state.cards = state.cards.filter(c => !ids.has(c.listId));
  if (ids.has(lv.listId)) lv.listId = null;
}
function shConfirmLeave(kind, obj, top, row) {
  const keep = shKeepBox("sh.keepCopy");
  const lists = shLocalLists(top);
  const body = el("div");
  body.append(el("p", null, t("sh.leaveAsk", { name: (row && row.name) || obj.name, id: (obj.shared && obj.shared.ownerName) || "?" })), keep.node);
  openModal(t("sh.leave"), body, [
    { label: t("cancel") },
    { label: t("sh.leave"), kind: "danger", onClick: () => {
      const k = keep.get();
      (async () => {
        try {
          // Copie gardée (étape 49) : images des autres membres recopiées dans mon dossier tant que j'y ai encore accès
          if (k && typeof Images !== "undefined") { const ids = new Set(lists.map(l => l.id)); await Images.adopt(state.cards.filter(c => ids.has(c.listId) && c.image)); }
          await Shared.rpc("share_leave", { p_list: top });
          const fd = state.folders.find(f => isSharedFolder(f) && f.shared.id === top);
          if (fd) delete fd.shared;
          lists.forEach(l => { const U = l.shared.id; if (k) shToPrivate(l, true); Shared.dropList(U); });
          if (!k) shDropLists(lists);
          Shared.dropList(top);
          commit();
          Activity.log("share_left", { name: String((row && row.name) || obj.name).slice(0, 60), target: (obj.shared && obj.shared.ownerName) || "", keep: k });
          toast(t(k ? "sh.leftKept" : "sh.left", { name: (row && row.name) || obj.name }));
        } catch (e) { toast(Shared.errText(e)); }
      })();
    } }
  ]);
}
function shConfirmDelete(kind, obj) {
  const U = obj.shared.id;
  const isFolder = kind === "folder";
  const lists = isFolder ? shLocalLists(U) : [obj];
  const keep = shKeepBox("sh.keepMine");
  const body = el("div");
  body.append(el("p", null, t(isFolder ? "sh.deleteFolderAsk" : "sh.deleteAsk", { name: obj.name, l: lists.length })), keep.node);
  openModal(t(isFolder ? "sh.deleteFolder" : "sh.deleteList"), body, [
    { label: t("cancel") },
    { label: t("delete"), kind: "danger", onClick: () => {
      const k = keep.get();
      (async () => {
        try {
          // Copie gardée (étape 49) : images des autres membres recopiées dans mon dossier avant la suppression
          if (k && typeof Images !== "undefined") { const ids = new Set(lists.map(l => l.id)); await Images.adopt(state.cards.filter(c => ids.has(c.listId) && c.image)); }
          const r = await Shared.rpc("share_delete", { p_list: U });
          if (isFolder) delete obj.shared;
          lists.forEach(l => {
            const LU = l.shared.id;
            if (k) {
              shToPrivate(l, false);
              // liste d'un dossier commun gardée : sortie du dossier (sinon elle serait repartagée avec lui)
              if (!isFolder && l.folderId && isSharedFolder(getFolder(l.folderId))) { l.folderId = null; l.order = nextOrder(listsIn(null)); }
            }
            Shared.dropList(LU);
          });
          if (!k) {
            shDropLists(lists);
            if (isFolder) { state.folders = state.folders.filter(f => f !== obj); sortedFolders().forEach((x, i) => { x.order = i; }); }
          }
          Shared.dropList(U);
          commit();
          Activity.log("share_deleted", { what: kind, name: String(obj.name).slice(0, 60), members: num(r && r.members, 0), keep: k });
          toast(t("sh.deleted", { name: obj.name }));
        } catch (e) { toast(Shared.errText(e)); }
      })();
    } }
  ]);
}

// --- Invitations reçues (écran Amis) : Ajouter (choix du dossier) / Refuser ---
function shInviteLabel(x) {
  const k = "sh.inv." + (x.kind === "common" ? "common" : "copy") + (x.what === "folder" ? "Folder" : "List");
  let s = t(k, { id: x.identifiant, name: x.name });
  const bits = [t("lists.count", { n: num(Number(x.cards), 0) })];
  if (x.what === "folder") bits.push(t("sh.nLists", { n: num(Number(x.lists), 0) }));
  if (x.kind === "common") bits.push(t("sh.role." + (x.role || "read")));
  return { title: s, sub: bits.join(" · ") };
}
function shInvitesCard() {
  const inv = Shared.invites();
  if (!inv) return null;
  const inc = arr(inv.incoming), out = arr(inv.outgoing);
  if (!inc.length && !out.length) return null;
  const c = el("div", "card");
  if (inc.length) {
    c.appendChild(el("h2", null, t("sh.invTitle", { n: inc.length })));
    inc.forEach(x => {
      const lb = shInviteLabel(x);
      c.appendChild(amPersonRow({ identifiant: lb.title }, lb.sub, [
        [t("sh.add"), "primary", () => shAccept(x)],
        [t("am.decline"), "", () => shDecline(x)]
      ]));
    });
  }
  if (out.length) {
    c.appendChild(el("h3", "fc-h4", t("sh.invOut", { n: out.length })));
    out.forEach(x => {
      const lb = shInviteLabel(Object.assign({}, x, { identifiant: x.identifiant }));
      c.appendChild(amPersonRow({ identifiant: x.identifiant }, x.name + " · " + lb.sub, [
        [t("am.cancel"), "", () => shRun(() => Shared.rpc("share_invite_cancel", { p_id: x.id }), t("sh.invCanceled", { id: x.identifiant }))]
      ]));
    });
  }
  return c;
}
async function shRun(fn, okText) {
  if (Shared.view.busy) return;
  Shared.view.busy = true;
  try { await fn(); if (okText) toast(okText); } catch (e) { toast(Shared.errText(e)); }
  Shared.view.busy = false;
  await Shared.loadFriendsView();
  if (currentScreen === "friends") renderFriends();
}
function shDecline(x) {
  return shRun(async () => {
    await Shared.rpc("share_invite_answer", { p_id: x.id, p_accept: false, p_folder: null });
    Activity.log("share_declined", { kind: x.kind, what: x.what, name: String(x.name).slice(0, 60), target: x.identifiant });
  }, t("sh.declined", { name: x.name }));
}
function shAccept(x) {
  if (x.what === "folder") { shAcceptInto(x, null); return; }
  const sel = folderSelect("", true);
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", shInviteLabel(x).title));
  wrap.appendChild(formField(t("sh.whereTo"), sel));
  openModal(t("sh.add"), wrap, [
    { label: t("cancel") },
    { label: t("sh.add"), kind: "primary", onClick: () => {
      if (sel.value === "__new__") { openFolderName(null, nf => { commitQuiet(); shAcceptInto(x, nf.id); }); return; }
      shAcceptInto(x, sel.value || null);
    } }
  ]);
}
function shAcceptInto(x, folderId) {
  return shRun(async () => {
    if (x.kind === "copy") {
      if (!state.lists.some(l => l.copiedFrom === x.id)) {
        const payload = await Shared.rpc("share_invite_payload", { p_id: x.id });
        const before = new Set(state.cards.map(c => c.id));
        shAddCopy(payload || {}, x, folderId);
        commit();
        const added = state.cards.filter(c => !before.has(c.id));
        if (typeof Images !== "undefined" && added.some(c => c.image)) { await Images.adopt(added); commit(); }   // étape 49 : images recopiées chez moi
        Dict.afterAdd(added.map(c => c.id));   // dictionnaire commun (étape 36)
      }
      await Shared.rpc("share_invite_answer", { p_id: x.id, p_accept: true, p_folder: null });
    } else {
      let made = null;
      if (x.what === "folder") {
        made = { id: uid(), name: x.name || "?", order: nextOrder(state.folders), shared: { id: x.list_id, role: x.role || "read", owner: x.user_id, ownerName: x.identifiant } };
        state.folders.push(made);
        folderId = made.id;
        commitQuiet();
      }
      try { await Shared.rpc("share_invite_answer", { p_id: x.id, p_accept: true, p_folder: folderId }); }
      catch (e) { if (made) { state.folders = state.folders.filter(f => f !== made); commitQuiet(); } throw e; }
      await Shared.sync();
    }
    Activity.log("share_accepted", { kind: x.kind, what: x.what, name: String(x.name).slice(0, 60), target: x.identifiant });
  }, t(x.kind === "copy" ? "sh.addedCopy" : "sh.addedCommon", { name: x.name }));
}
// Copie acceptée : dossier (si c'est un dossier), listes et cartes ajoutées, progression à zéro. Renvoie le nombre de cartes.
function shAddCopy(payload, x, folderId) {
  let fid = folderId || null, n = 0;
  const now = Date.now();
  if (payload.what === "folder" || payload.folder) {
    const pf = payload.folder || {};
    const nf = Object.assign({ id: uid(), name: String(pf.name || x.name || "?").slice(0, 200), order: nextOrder(state.folders), copiedFrom: x.id }, normLangPair(pf));
    state.folders.push(nf);
    fid = nf.id;
  }
  arr(payload.lists).forEach(pl => {
    if (!pl || typeof pl !== "object") return;
    const nl = Object.assign({ id: uid(), name: String(pl.name || x.name || "?").slice(0, 200), folderId: fid,
      order: nextOrder(listsIn(fid)), createdAt: now, copiedFrom: x.id }, normLangPair(pl));
    state.lists.push(nl);
    arr(pl.cards).forEach(cd => {
      if (!cd || typeof cd !== "object") return;
      const c = shWithProg(normalizeCard(Object.assign({}, cd, { id: uid(), listId: nl.id })), null);
      if (cardHasContent(c)) { state.cards.push(c); n++; }
    });
  });
  return n;
}
// Écran Amis : progression d'un ami sur les listes partagées avec moi (selon sa confidentialité).
function shFriendProgress(userId) {
  const fp = Shared.friendsProgress();
  if (!fp) return "—";
  const lists = arr(fp[userId]);
  if (!lists.length) return el("span", "muted", t("sh.noProgress"));
  const box = el("div", "sh-prog");
  lists.forEach(x => {
    const n = num(Number(x.n), 0), su = num(Number(x.su), 0);
    const line = el("div", "sh-prog-row");
    line.append(el("span", "sh-prog-name", "👥 " + x.name), el("span", "muted", " " + t("sh.progVal", { su, n, rev: num(Number(x.rev), 0), ps: num(Number(x.ps), 0) })));
    box.appendChild(line);
  });
  return box;
}
// Petit libellé « partagée » d'une liste ou d'un dossier.
function shTag(o) {
  if (!o || !o.shared) return "";
  return "👥 " + (o.shared.role === "owner" ? t("sh.byMe") : t("sh.byOwner", { id: o.shared.ownerName || "?" })) + (o.shared.role === "read" ? " · " + t("sh.role.read") : "")
    + (o.shared.team ? " · " + t("tm.teamList") : "");   // liste d'équipe (étape 54)
}

// --- Fiche du compte (admin) : partages et invitations ---
function fcShares() {
  const sec = fcSec(t("sh.fc.title"), "fc-shares");
  const s = fc.shares;
  if (!s) { sec.appendChild(el("p", "q-note", fc.sharesErr || "—")); return sec; }
  const who = (id, name) => {
    const b = el("button", "link-btn am-fc-who", name || "?");
    b.type = "button";
    b.addEventListener("click", () => openAccountFiche(id, fc.from));
    return b;
  };
  const owned = arr(s.owned);
  sec.appendChild(el("h4", "fc-h4", t("sh.fc.owned", { n: owned.length })));
  if (!owned.length) sec.appendChild(el("p", "muted", t("am.fc.none")));
  owned.forEach(o => {
    const p = el("div", "sh-fc-row");
    p.appendChild(el("div", null, (o.is_folder ? "📁 " : "") + o.name + " · " + t("lists.count", { n: num(Number(o.cards), 0) }) + (o.is_folder ? " · " + t("sh.nLists", { n: num(Number(o.lists), 0) }) : "")));
    const m = el("div", "am-fc-list");
    if (!arr(o.members).length) m.appendChild(el("span", "muted", t("sh.fc.noMember")));
    arr(o.members).forEach(x => { m.append(who(x.user_id, x.identifiant + " (" + t("sh.role." + x.role) + ")")); });
    p.appendChild(m);
    sec.appendChild(p);
  });
  const mem = arr(s.member_of);
  sec.appendChild(el("h4", "fc-h4", t("sh.fc.member", { n: mem.length })));
  if (!mem.length) sec.appendChild(el("p", "muted", t("am.fc.none")));
  mem.forEach(o => {
    const p = el("div", "sh-fc-row");
    p.append(document.createTextNode((o.is_folder ? "📁 " : "") + o.name + " · " + t("sh.role." + o.role) + (o.active === false ? " · " + t("sh.notFriend") : "") + " · "), who(o.owner, o.owner_ident));
    sec.appendChild(p);
  });
  const invRows = (list, dir) => {
    const a = arr(list);
    if (!a.length) return el("p", "muted", t("am.fc.none"));
    return fcTable([t("sh.fc.date"), t(dir === "sent" ? "sh.fc.to" : "sh.fc.from"), t("sh.fc.what"), t("sh.fc.status")],
      a.map(x => [admDate(x.created_at), x.identifiant, t(x.kind === "common" ? "sh.modeCommon" : "sh.modeCopy") + " · " + (x.what === "folder" ? "📁 " : "") + x.name
        + (x.role ? " · " + t("sh.role." + x.role) : "") + " · " + t("lists.count", { n: num(Number(x.cards), 0) }), t("sh.st." + x.status)]), 9);
  };
  sec.appendChild(el("h4", "fc-h4", t("sh.fc.sent", { n: arr(s.sent).length })));
  sec.appendChild(invRows(s.sent, "sent"));
  sec.appendChild(el("h4", "fc-h4", t("sh.fc.received", { n: arr(s.received).length })));
  sec.appendChild(invRows(s.received, "received"));
  return sec;
}
function fcSharedCount() { return fc.shares ? arr(fc.shares.owned).length + arr(fc.shares.member_of).length : "—"; }
