"use strict";

// ====================================================================================================
// js/storage-supabase.js — SUPABASE · EXPORT / IMPORT (3e morceau de l'ancien js/storage.js, étape 65)
// Client Supabase (Supa), puis export et import JSON. Chargé juste après js/storage-sync.js, avant js/cards.js.
// ====================================================================================================

// === SUPABASE ===
// Client Supabase, chargé seulement si config.js est rempli (window.APP_CONFIG = { SUPABASE_URL, SUPABASE_ANON_KEY }).
// Clé publique (« publishable » ou « anon ») uniquement : jamais la clé service_role / secrète.
// Connexion : email technique <identifiant>@vocab.local (jamais affiché), mot de passe = SHA-256(identifiant + ":" + PIN).
// Fonctions SQL utilisées (voir supabase.sql) : username_exists, my_profile, touch_last_seen, pin_changed,
// admin_list_accounts, admin_reset_pin, admin_delete_account. Données : table user_data (une ligne par morceau).
function inClaude() { return !!(window.claude && typeof window.claude.use === "function"); }

// SHA-256 en hexadécimal (crypto.subtle, sinon calcul en JavaScript : même résultat).
async function sha256Hex(str) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { return sha256Js(str); }
}
function sha256Js(str) {
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  const H = [], K = [];
  for (let n = 2, c = 0; c < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (!prime) continue;
    if (c < 8) H[c] = (Math.pow(n, 1 / 2) * 4294967296) | 0;
    K[c++] = (Math.pow(n, 1 / 3) * 4294967296) | 0;
  }
  const b = Array.from(new TextEncoder().encode(str)), len = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  for (let i = 7; i >= 0; i--) b.push(i >= 4 ? 0 : (len >>> (8 * i)) & 255);
  const w = new Array(64);
  for (let j = 0; j < b.length; j += 64) {
    for (let i = 0; i < 16; i++) w[i] = (b[j + 4 * i] << 24) | (b[j + 4 * i + 1] << 16) | (b[j + 4 * i + 2] << 8) | b[j + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + w[i - 7] + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10))) | 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    [a, bb, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

// Type d'erreur Supabase → "net" | "wrong" | "exists" | "confirm" | "same" | "server".
function sbErrKind(e) {
  const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || e || "");
  if (navigator.onLine === false || /fetch|network|timeout|load failed/i.test(msg) || (e && (e.name === "AuthRetryableFetchError" || e.status === 0))) return "net";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) return "wrong";
  if (code === "user_already_exists" || /already registered|already exists/i.test(msg)) return "exists";
  if (code === "confirm" || code === "email_not_confirmed" || /not confirmed/i.test(msg)) return "confirm";
  if (code === "same_password" || /different from the old/i.test(msg)) return "same";
  return "server";
}

const Supa = (() => {
  let client = null;
  const AUTH_KEY = "vocabfr.sb.auth";
  // Configuration lue dans config.js ; valeurs d'exemple ou vides = pas de Supabase.
  function cfg() {
    const c = (window.APP_CONFIG && typeof window.APP_CONFIG === "object") ? window.APP_CONFIG : {};
    const url = String(c.SUPABASE_URL || "").trim(), key = String(c.SUPABASE_ANON_KEY || "").trim();
    if (!/^https:\/\/\S+$/.test(url) || key.length < 20 || /REMPLACER|VOTRE|xxxx/i.test(url + key)) return null;
    return { url: url.replace(/\/+$/, ""), key };
  }
  function configured() { return !!cfg(); }
  function loadLib() {
    if (window.supabase && typeof window.supabase.createClient === "function") return Promise.resolve();
    return withTimeout(new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = CONFIG.SB_CDN; sc.onload = res; sc.onerror = () => rej(new Error("cdn"));
      document.head.appendChild(sc);
    }), 15000);
  }
  // « Rester connecté » : session Supabase dans localStorage, sinon dans sessionStorage (oubliée à la fermeture).
  const authStorage = {
    getItem(k) { try { const v = localStorage.getItem(k); return v !== null ? v : sessionStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) {
      try {
        if (rememberMe()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
        else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
      } catch (e) {}
    },
    removeItem(k) { try { localStorage.removeItem(k); } catch (e) {} try { sessionStorage.removeItem(k); } catch (e) {} }
  };
  async function init() {
    const c = cfg();
    if (!c) return false;
    try {
      await loadLib();
      client = window.supabase.createClient(c.url, c.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStorage, storageKey: AUTH_KEY },
        // Étape 41 : fetch surveillé (erreurs des appels Supabase et de send-push → journal des erreurs).
        // Étape 48 : portillon des écritures (Release.gateFetch) sous le fetch surveillé : rien n'est écrit tant que
        // l'appli doit être mise à jour.
        global: typeof ErrLog !== "undefined" ? { fetch: ErrLog.wrapFetch(typeof Release !== "undefined" ? Release.gateFetch : undefined) }
              : typeof Release !== "undefined" ? { fetch: Release.gateFetch } : {}
      });
      return true;
    } catch (e) { client = null; return false; }
  }
  const T = 15000;
  const ok = r => { if (r && r.error) throw r.error; return r ? r.data : null; };
  function email(id) { return id + "@" + CONFIG.SB_EMAIL_DOMAIN; }
  function password(id, pin) { return sha256Hex(id + ":" + pin); }
  async function session() { return ok(await withTimeout(client.auth.getSession(), T)).session || null; }
  async function signIn(id, pin) {
    return ok(await withTimeout(client.auth.signInWithPassword({ email: email(id), password: await password(id, pin) }), T)).session;
  }
  async function signUp(id, pin) {
    const d = ok(await withTimeout(client.auth.signUp({ email: email(id), password: await password(id, pin) }), T));
    if (!d || !d.session) throw { code: "confirm" };   // confirmation par email encore activée
    return d.session;
  }
  async function signOut() {
    try { await withTimeout(client.auth.signOut({ scope: "local" }), 5000); } catch (e) {}
    authStorage.removeItem(AUTH_KEY);
  }
  async function rpc(name, args) { return ok(await withTimeout(client.rpc(name, args || {}), T)); }
  // Nouveau PIN pour le compte connecté (puis « PIN à changer » retiré).
  async function setPin(id, pin) {
    ok(await withTimeout(client.auth.updateUser({ password: await password(id, pin) }), T));
    await rpc("pin_changed");
  }
  // Administration : lignes user_data d'un compte (RLS : réservé à l'admin pour les autres comptes).
  async function readRows(userUuid) {
    return arr(ok(await withTimeout(client.from("user_data").select("key,data").eq("user_id", userUuid), T * 2)));
  }
  // Remplace toutes les lignes d'un compte : morceaux, puis index, puis suppression des anciennes clés.
  async function writeRows(userUuid, rows) {
    const old = arr(ok(await withTimeout(client.from("user_data").select("key").eq("user_id", userUuid), T))).map(r => r.key);
    const pieces = rows.filter(r => r.key !== "index"), idx = rows.filter(r => r.key === "index");
    for (let i = 0; i < pieces.length; i += 5) {
      ok(await withTimeout(client.from("user_data").upsert(pieces.slice(i, i + 5).map(r => ({ user_id: userUuid, key: r.key, data: r.data }))), T));
    }
    if (idx.length) ok(await withTimeout(client.from("user_data").upsert({ user_id: userUuid, key: "index", data: idx[0].data }), T));
    const keep = new Set(rows.map(r => r.key));
    const del = old.filter(k => !keep.has(k));
    for (let i = 0; i < del.length; i += 50) {
      ok(await withTimeout(client.from("user_data").delete().eq("user_id", userUuid).in("key", del.slice(i, i + 50)), T));
    }
  }
  return {
    configured, init, client: () => client, password, session, signIn, signUp, signOut, setPin, readRows, writeRows,
    usernameExists: id => rpc("username_exists", { p_identifiant: id }),
    myProfile: () => rpc("my_profile"),
    touch: () => rpc("touch_last_seen"),
    listAccounts: () => rpc("admin_list_accounts"),
    resetPin: (userUuid, pwd) => rpc("admin_reset_pin", { p_user_id: userUuid, p_password: pwd }),
    deleteAccount: userUuid => rpc("admin_delete_account", { p_user_id: userUuid })
  };
})();

// === EXPORT / IMPORT ===
// Exporte data (par défaut : les données du compte connecté).
// Renvoie "saved" (fichier enregistré) ou "text" (fenêtre avec le texte à copier).
async function exportData(data, filename) {
  const json = JSON.stringify(data || state, null, 2);
  filename = filename || ("vocabulaire-francais-" + (Storage.getUser() ? Storage.getUser() + "-" : "") + todayStr() + ".json");
  try {
    const dl = window.claude && typeof window.claude.use === "function" ? await window.claude.use("downloads") : null;
    if (dl) { await dl.save({ filename, data: json }); toast(t("export.done")); return "saved"; }
  } catch (e) { /* refusé ou indisponible : on passe au plan B */ }
  if (!inClaude()) {          // navigateur (GitHub Pages) : téléchargement d'un fichier .json
    try {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast(t("export.done"));
      return "saved";
    } catch (e) {}
  }
  showExportText(json);
  return "text";
}
function showExportText(json) {
  const wrap = document.createElement("div");
  const p = document.createElement("p"); p.textContent = t("export.fallback");
  const ta = document.createElement("textarea"); ta.readOnly = true; ta.value = json;
  wrap.append(p, ta);
  openModal(t("export.title"), wrap, [
    { label: t("copy"), kind: "primary", onClick: () => {
      try { navigator.clipboard.writeText(json).then(() => toast(t("copied")), () => { ta.select(); }); }
      catch (e) { ta.select(); }
      return false;
    } },
    { label: t("close") }
  ]);
}

// target (administration) : { id, apply(data) } pour importer dans un autre compte ; sinon le compte connecté.
let importTarget = null;
function openImport(target) {
  importTarget = target && typeof target.apply === "function" ? target : null;
  const wrap = document.createElement("div");
  const fileBtn = document.createElement("button");
  fileBtn.className = "btn"; fileBtn.textContent = t("import.file");
  const lab = document.createElement("p"); lab.className = "muted"; lab.style.margin = "16px 0 6px"; lab.textContent = t("import.paste");
  const ta = document.createElement("textarea"); ta.placeholder = '{ "version": 2, ... }';
  wrap.append(fileBtn, lab, ta);
  let closeFn = null;
  fileBtn.addEventListener("click", () => { if (closeFn) closeFn(); $("#importFile").click(); });
  closeFn = openModal(t("import.title"), wrap, [
    { label: t("cancel") },
    { label: t("next"), kind: "primary", onClick: () => importFromText(ta.value) ? undefined : false }
  ]);
}
function onImportFile(e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const r = new FileReader();
  r.onload = () => importFromText(String(r.result || ""));
  r.onerror = () => toast(t("import.error"));
  r.readAsText(f);
}
function importFromText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { toast(t("import.error")); return false; }
  if (!looksLikeAppData(raw)) { toast(t("import.error")); return false; }
  const data = normalizeData(raw);
  importConfirm(data, importTarget);
  return true;
}
// Étape 77 : l'import remplace TOUT le compte → confirmation forte (listes et cartes avant / après, case « J'ai compris »),
// puis copie de sécurité OBLIGATOIRE de ce qui est remplacé (copie locale, sinon fichier téléchargé) ; sans copie : rien n'est importé.
// tg (administration) : { id, read() → données actuelles du compte, apply(data) }.
async function importConfirm(data, tg) {
  let cur = state;
  if (tg) {
    try { cur = typeof tg.read === "function" ? await tg.read() : null; }
    catch (e) { toast(t("gf.imp.readErr")); return; }
  }
  const count = d => ({ lists: arr(d && d.lists).length, cards: arr(d && d.cards).length });
  const wrap = el("div");
  if (tg) wrap.appendChild(el("p", null, t("gf.imp.who", { id: tg.id })));
  wrap.appendChild(el("p", "gf-warn", t("gf.imp.warn")));
  const tbl = el("div", "gf-imp");
  tbl.appendChild(el("p", null, t("gf.imp.before", count(cur))));
  tbl.appendChild(el("p", null, t("gf.imp.after", count(data))));
  wrap.appendChild(tbl);
  wrap.appendChild(el("p", "muted", t("gf.imp.copy")));
  const lab = el("label", "check gf-imp-ok"), cb = el("input");
  cb.type = "checkbox";
  lab.append(cb, el("span", null, t("gf.imp.check")));
  wrap.appendChild(lab);
  let busy = false, close = null;
  const who = Storage.getUser();
  close = openModal(t("import.title"), wrap, [
    { label: t("cancel") },
    { label: t("gf.imp.go"), kind: "danger", onClick: () => {
      if (!cb.checked || busy) return false;
      busy = true;
      (async () => {
        let kept = !Guard.hasContent(cur) || await Guard.backup("import", cur, who, tg ? tg.id : "");
        if (!kept) {
          try { kept = (await exportData(cur, "copie-avant-import-" + (tg ? tg.id : who) + "-" + todayStr() + ".json")) === "saved"; } catch (e) { kept = false; }
        }
        if (!kept || Storage.getUser() !== who) { busy = false; toast(t("gf.copyErr")); return; }
        close();
        if (tg) { tg.apply(data).then(() => toast(t("admin.importDone", { id: tg.id })), () => toast(t("admin.err"))); return; }
        Guard.allow("import");   // le garde-fou laisse passer cet envoi (choix explicite, copie faite)
        Activity.log("import_json", { local: arr(cur && cur.cards).length, cards: data.cards.length });
        state = data; Shared.attach(state); applyTheme(); commit(); toast(t("import.done"));
      })();
      return false;
    } }
  ]);
  const go = Array.from(document.querySelectorAll(".modal-bg .btn.danger")).pop();
  if (go) { go.disabled = true; cb.addEventListener("change", () => { go.disabled = !cb.checked; }); }
}
