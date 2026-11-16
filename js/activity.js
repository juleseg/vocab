"use strict";

// === JOURNAL D'ACTIVITÉ ===
// Mode Supabase seulement (script supabase-etape24.sql). Sans le script, ou hors mode Supabase : rien n'est envoyé,
// l'appli marche comme avant. Jamais d'erreur visible pour l'utilisateur.
// - Événements (table activity_log) : login, session, cards_added, import, validate, claude_request, pin_change, logout,
//   sync_error, conflict, admin_*. data = petit objet, jamais le contenu des cartes.
//   session (étape 26) : data.by_list = { id de liste: nombre de cartes révisées } (30 listes max), pour le classement
//   « listes les plus révisées » et la fiche du compte.
// - File locale par compte (localStorage vocabfr.activity:q:<identifiant>), envoyée regroupée toutes les 30 s, à la mise
//   en arrière-plan et au retour de la connexion (fonction activity_add). Chaque événement a un id (uuid) choisi ici :
//   un renvoi après une coupure n'est gardé qu'une fois. Un événement ne quitte la file qu'après un envoi réussi.
// - login : 1 par heure max (connexion, ou ouverture avec une session déjà ouverte).
// - cards_added : regroupé, 1 événement par liste et par heure (envoyé une heure après le premier ajout, ou à la déconnexion).
// - Appareil (table devices) : device_id gardé dans localStorage (vocabfr.device), fiche mise à jour au lancement (device_touch).
function uuid4() {
  try { if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID(); } catch (e) {}
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let deviceIdMem = null;
function deviceId() {
  if (deviceIdMem) return deviceIdMem;
  const K = CONFIG.LS_USER_PREFIX + "device";
  try { const v = localStorage.getItem(K); if (v && UUID_RE.test(v)) return (deviceIdMem = v); } catch (e) {}
  deviceIdMem = uuid4();
  try { localStorage.setItem(K, deviceIdMem); } catch (e) {}
  return deviceIdMem;
}
// Type (phone | tablet | desktop), système et navigateur déduits du user agent ; installed = appli installée (standalone).
function deviceInfo() {
  const ua = String(navigator.userAgent || ""), touch = (navigator.maxTouchPoints || 0) > 1;
  let os = "";
  if (/iPhone|iPod/.test(ua)) os = "iOS";
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) os = "iPadOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  let type = "desktop";
  if (os === "iPadOS" || /Tablet/i.test(ua) || (os === "Android" && !/Mobile/.test(ua))) type = "tablet";
  else if (os === "iOS" || /Mobi/.test(ua)) type = "phone";
  let browser = "";
  if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
  else if (/Edg(e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/OPR\/|OPiOS|Opera/.test(ua)) browser = "Opera";
  else if (/Firefox|FxiOS/.test(ua)) browser = "Firefox";
  else if (/Chrome|CriOS|Chromium/.test(ua)) browser = "Chrome";
  else if (/Safari/.test(ua)) browser = "Safari";
  let installed = false;
  try {
    installed = navigator.standalone === true ||
      ["standalone", "fullscreen", "minimal-ui"].some(m => window.matchMedia && window.matchMedia("(display-mode: " + m + ")").matches);
  } catch (e) {}
  return { type, os, browser, installed };
}

const Activity = (() => {
  const SEND_MS = 30000, BATCH = 100, MAX_LOCAL = 600, KEEP_MS = 7 * 86400000;
  const LOGIN_GAP = 3600000, ADD_GAP = 3600000, SYNC_ERR_GAP = 600000;
  let who = null, q = [], adds = {}, early = [], timer = null, inflight = null;
  let status = "unknown";              // unknown | ok | missing (script de l'étape 24 pas lancé)
  let deviceDone = false, lastSyncErr = 0;
  function on() { return auth.mode === "supabase"; }
  function usable() { return on() && !!who && !!auth.sbUid && !!Supa.client() && status !== "missing"; }
  function key(part) { return CONFIG.LS_USER_PREFIX + "activity:" + part + ":" + who; }
  function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load() {
    const now = Date.now();
    q = arr(lsGet(key("q"), [])).filter(e => e && UUID_RE.test(String(e.id)) && e.kind && now - Date.parse(e.at || 0) < KEEP_MS);
    const a = lsGet(key("adds"), {});
    adds = a && typeof a === "object" && !Array.isArray(a) ? a : {};
  }
  function storeQ() { if (!who) return; if (q.length) lsSet(key("q"), q); else { try { localStorage.removeItem(key("q")); } catch (e) {} } }
  function storeAdds() { if (who) lsSet(key("adds"), adds); }
  // Petites valeurs seulement : nombres, booléens, textes courts.
  function clean(data) {
    const o = {};
    if (!data || typeof data !== "object") return o;
    Object.keys(data).slice(0, 15).forEach(k => {
      const v = data[k];
      if (typeof v === "number" && isFinite(v)) o[k] = Math.round(v * 100) / 100;
      else if (typeof v === "boolean") o[k] = v;
      else if (typeof v === "string") o[k] = v.slice(0, 120);
      else if (k === "by_list" && v && typeof v === "object" && !Array.isArray(v)) {
        // { id de liste: nombre de cartes } (événement session, étape 26) : 30 listes max, jamais de contenu
        const m = {};
        Object.keys(v).slice(0, 30).forEach(id => { const n = v[id]; if (id.length <= 60 && typeof n === "number" && isFinite(n) && n > 0) m[id] = Math.round(n); });
        o[k] = m;
      }
    });
    return o;
  }
  function make(kind, data, at) {
    const d = at ? new Date(at) : new Date();
    return { id: uuid4(), kind, day: todayStr(d), at: d.toISOString(), data: clean(data), device_id: deviceId() };
  }
  function push(ev) {
    q.push(ev);
    if (q.length > MAX_LOCAL) q = q.slice(-MAX_LOCAL);
    storeQ();
  }
  // Enregistre un événement (jamais bloquant, jamais d'erreur). Sans compte ouvert (nouveau PIN obligatoire) : gardé
  // pour le compte qui s'ouvre ensuite.
  function log(kind, data) {
    try {
      if (!on()) return;
      const ev = make(kind, data);
      if (!who) { early.push(ev); if (early.length > 10) early.shift(); return; }
      push(ev);
    } catch (e) {}
  }
  // login : 1 par heure max sur cet appareil.
  function maybeLogin(via) {
    const k = key("login"), last = Number(lsGet(k, 0)) || 0;
    if (Date.now() - last < LOGIN_GAP) return;
    lsSet(k, Date.now());
    log("login", { via: via || "resume", version: APP_VERSION });
  }
  // Cartes ajoutées à la main : un seul événement par liste et par heure.
  function cardsAdded(listId, n) {
    try {
      if (!on() || !who || !listId || !(n > 0)) return;
      const a = adds[listId];
      if (a && Date.now() - a.since < ADD_GAP) a.n += n;
      else {
        if (a) emitAdd(listId);
        const l = getList(listId);
        adds[listId] = { n, since: Date.now(), list: l ? String(l.name).slice(0, 60) : "" };
      }
      storeAdds();
    } catch (e) {}
  }
  function emitAdd(listId) {
    const a = adds[listId];
    delete adds[listId];
    if (a && a.n > 0) push(make("cards_added", { n: a.n, list: a.list }, a.since));
  }
  function emitDueAdds(all) {
    let changed = false;
    Object.keys(adds).forEach(id => { if (all || Date.now() - num(adds[id].since, 0) >= ADD_GAP) { emitAdd(id); changed = true; } });
    if (changed) storeAdds();
  }
  // Erreur de synchro (pas « hors ligne ») : 1 toutes les 10 min max.
  function syncError(msg) {
    if (!on() || !who || Date.now() - lastSyncErr < SYNC_ERR_GAP) return;
    lastSyncErr = Date.now();
    log("sync_error", { msg: String(msg || "").slice(0, 120) });
  }
  function isMissing(e) {
    const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
    return ["PGRST202", "42883", "PGRST205", "42P01"].includes(code) || /could not find|does not exist|schema cache/i.test(msg);
  }
  // Envoi regroupé (100 par appel). Échec : tout reste dans la file, nouvel essai au prochain passage.
  function flush() {
    if (!usable() || !q.length) return Promise.resolve(false);
    if (inflight) return inflight;
    const u = who, batch = q.slice(0, BATCH), cl = Supa.client();
    inflight = (async () => {
      try {
        const r = await withTimeout(cl.rpc("activity_add", { p_events: batch }), 15000);
        if (r && r.error) throw r.error;
        status = "ok";
        if (who === u) {
          const sent = new Set(batch.map(e => e.id));
          q = q.filter(e => !sent.has(e.id));
          storeQ();
        }
        return true;
      } catch (e) { if (isMissing(e)) status = "missing"; return false; }
    })().then(ok => {
      inflight = null;
      if (ok && who === u && q.length) return flush();
      return ok;
    });
    return inflight;
  }
  async function touchDevice() {
    if (deviceDone || !usable()) return;
    const d = deviceInfo();
    try {
      const r = await withTimeout(Supa.client().rpc("device_touch", {
        p_device: deviceId(), p_type: d.type, p_os: d.os, p_browser: d.browser, p_installed: d.installed,
        p_version: APP_VERSION, p_lang: state.settings.uiLang
      }), 15000);
      if (r && r.error) throw r.error;
      deviceDone = true; status = "ok";
    } catch (e) { if (isMissing(e)) status = "missing"; }
  }
  function tick() { emitDueAdds(false); flush(); }
  // Ouverture d'un compte (après startUserData). via : "pin" | "create" | "resume".
  function start(via) {
    stop();
    if (!on() || !Storage.getUser()) { early = []; return; }
    who = Storage.getUser();
    status = "unknown"; deviceDone = false;
    load();
    early.forEach(push); early = [];
    maybeLogin(via);
    emitDueAdds(false);
    timer = setInterval(tick, SEND_MS);
    touchDevice().then(() => flush());
  }
  function stop() { clearInterval(timer); timer = null; who = null; q = []; adds = {}; }
  // Déconnexion : événement logout, ajouts en attente, envoi (5 s max), puis arrêt. Ce qui n'est pas parti reste
  // sur l'appareil et partira à la prochaine ouverture du même compte.
  async function end() {
    if (!who) return;
    log("logout", {});
    emitDueAdds(true);
    try { await withTimeout(flush(), 5000); } catch (e) {}
    stop();
  }
  // Fin de session de révision (une seule fois par session).
  function session(s, ids, n) {
    try {
      if (!s || s.logged || !ids.length) return;
      s.logged = true;
      const cards = ids.map(id => state.cards.find(c => c.id === id)).filter(Boolean);
      const langs = [...new Set(cards.map(c => cardLangs(c).target))];
      const byList = {};                                 // ids des listes révisées + nombre de cartes (étape 26)
      cards.forEach(c => { byList[c.listId] = (byList[c.listId] || 0) + 1; });
      log("session", {
        mode: s.mode, cards: ids.length, known: n.known, review: n.review, unknown: n.unknown,
        seconds: Math.round((Date.now() - num(s.startedAt, Date.now())) / 1000),
        lists: Object.keys(byList).length, lang: langs.join(","), by_list: byList
      });
    } catch (e) {}
  }
  try {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { emitDueAdds(false); flush(); } });
    window.addEventListener("pagehide", () => { flush(); });
    window.addEventListener("online", () => { if (who) { touchDevice(); flush(); } });
  } catch (e) {}
  return {
    log, cardsAdded, syncError, session, start, end, flush,
    status: () => status, pending: () => q.length, active: () => !!who
  };
})();
