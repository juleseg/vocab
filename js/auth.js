"use strict";

// === CONNEXION ===
// Deux modes, choisis au lancement (INIT) :
//  - "supabase" (config.js rempli) : Supabase Auth. Email technique <identifiant>@vocab.local, mot de passe = SHA-256(identifiant:PIN).
//    Profil (fonction my_profile) : identifiant, PIN à changer (admin à l'installation, PIN réinitialisé par l'admin), admin.
//    « Rester connecté » : session Supabase gardée sur l'appareil (sinon oubliée à la fermeture du navigateur).
//  - "local" (artifact Claude ou navigateur sans config) : registre des comptes comme avant (PIN haché avec un sel, jamais en clair).
//    Migration : le premier compte créé reçoit les anciennes données (après proposition d'export), une seule fois.
// Identifiant : insensible à la casse, espaces retirés, lettres/chiffres/tirets (2 à 20). PIN : 4 à 6 chiffres.
// Identifiant inconnu à la connexion : proposition de créer le compte.
const auth = {
  mode: "local", view: "loading", reg: { accounts: [], migrated: false }, legacy: null, backupAsked: false, busy: false,
  msg: null, err: null, isAdmin: false, sbUid: null, lastPin: "", forceId: "", forceTarget: null, blocked: null,
  form: { id: "", pin: "", pin2: "", target: LANG_DEFAULT, support: null }
};

function rememberMe() { try { return localStorage.getItem(CONFIG.LS_REMEMBER) !== "0"; } catch (e) { return true; } }
function setRememberMe(v) { try { localStorage.setItem(CONFIG.LS_REMEMBER, v ? "1" : "0"); } catch (e) {} }
function normId(s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); }
function validId(s) { return /^[a-z0-9-]{2,20}$/.test(s); }
function validPin(s) { return /^\d{4,6}$/.test(s); }
function clearAuthForm() { const o = auth.form || {}; auth.form = { id: "", pin: "", pin2: "", target: o.target || LANG_DEFAULT, support: isLang(o.support) ? o.support : null }; auth.msg = null; auth.err = null; }
// Messages de l'écran de connexion : gardés sous forme de clé (+ variables) et traduits à l'affichage,
// pour suivre immédiatement un changement de langue. authError : erreur affichée dans l'écran (plus de bulle éphémère).
function authError(key, vars) { auth.err = { key, vars: vars || null }; if (!Storage.getUser()) renderAuth(); }
function authErrKind(kind) { authError({ net: "auth.err.net", exists: "auth.err.exists", confirm: "auth.err.confirm", same: "auth.err.same", wrong: "auth.err.wrong" }[kind] || "auth.err.server"); }
async function hashPin(pin, salt) {
  const txt = salt + ":" + pin;
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch (e) { // repli si crypto.subtle est absent
    let h = 2166136261;
    for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); }
    return "f" + (h >>> 0).toString(16);
  }
}
// Langue et thème de l'écran de connexion (gardés sur l'appareil).
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(CONFIG.LS_PREFS) || "null");
    if (p && ["ko", "fr", "en"].includes(p.uiLang)) state.settings.uiLang = p.uiLang;
    if (p && ["light", "dark", "auto"].includes(p.theme)) state.settings.theme = p.theme;
  } catch (e) {}
}
function savePrefs() {
  try { localStorage.setItem(CONFIG.LS_PREFS, JSON.stringify({ uiLang: state.settings.uiLang, theme: state.settings.theme })); } catch (e) {}
}
function errText(kind) {
  return t({ net: "auth.err.net", exists: "auth.err.exists", confirm: "auth.err.confirm", same: "auth.err.same", wrong: "auth.err.wrong" }[kind] || "auth.err.server");
}

// Affiche l'écran de connexion. view : "loading" | "login" | "create" | "force" (nouveau PIN obligatoire) | "libError"
// | "blocked" (compte bloqué par l'admin, étape 27 : déjà déconnecté).
function showAuth(view) {
  const v = view || "login";
  if (v !== auth.view && v !== "loading" && auth.view !== "loading") auth.err = null;
  auth.view = v;
  document.body.classList.add("auth");
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-auth"));
  applyTheme();
  applyI18n();
  renderSyncStatus(Storage.getMode());
  renderAuth();
}
function pinInput(value, onInput) {
  const i = el("input", "input auth-pin");
  i.type = "password"; i.inputMode = "numeric"; i.pattern = "[0-9]*"; i.maxLength = 6; i.autocomplete = "off";
  i.value = value || "";
  i.addEventListener("input", () => { i.value = i.value.replace(/\D/g, "").slice(0, 6); onInput(i.value); });
  return i;
}
// Langue de l'appli, choisie sur l'écran de connexion (en haut) ou dans le bloc « Tes langues » de la création de compte.
function authPickUi(code) {
  state.settings.uiLang = code; savePrefs(); applyI18n(); renderSyncStatus(Storage.getMode());
  renderAuth(); // tous les textes, messages et erreurs compris, sont relus dans la nouvelle langue
}
function authLangSeg() {
  const f = lxField(t("auth.lang"), lxAppSeg(authPickUi));
  f.classList.add("auth-lang");
  return f;
}
function authErrBox() {
  const d = el("div", "auth-msg err", t(auth.err.key, auth.err.vars));
  d.setAttribute("role", "alert");
  return d;
}
function renderAuth() {
  const root = $("#screen-auth");
  root.textContent = "";
  root.appendChild(authLangSeg());
  if (auth.view === "loading") { root.appendChild(el("div", "empty", t("auth.loading"))); return; }
  if (auth.view === "libError") {
    const c = el("div", "card");
    c.appendChild(el("p", null, t("auth.err.lib")));
    const b = el("button", "btn primary", t("auth.retry"));
    b.addEventListener("click", () => location.reload());
    c.appendChild(b);
    root.appendChild(c);
    return;
  }
  if (auth.view === "force") { renderForcePin(root); return; }
  if (auth.view === "blocked") { renderBlocked(root); return; }
  const sbMode = auth.mode === "supabase";
  const first = !sbMode && !auth.reg.accounts.length;
  const creating = first || auth.view === "create";
  const f = auth.form;
  // Création de compte (étape 52, complément) : les trois langues dans l'ordre, dans la carte (pas en haut) ; pas pour le
  // premier compte qui reçoit les anciennes données (migration : pas de profil de langues choisi ici).
  const langBlock = creating && !(first && auth.legacy && !auth.reg.migrated);
  if (langBlock) { const top = root.querySelector(".auth-lang"); if (top) top.remove(); }

  const box = el("div", "card");
  box.appendChild(el("h2", null, t(first ? "auth.firstTitle" : creating ? "auth.createTitle" : "auth.loginTitle")));
  if (auth.msg) box.appendChild(el("div", "auth-msg", t(auth.msg.key, auth.msg.vars)));
  if (auth.err) box.appendChild(authErrBox());
  const idInp = textInput(f.id, "");
  idInp.autocomplete = "username"; idInp.spellcheck = false;
  idInp.setAttribute("autocapitalize", "off"); idInp.setAttribute("autocorrect", "off");
  idInp.addEventListener("input", () => { f.id = idInp.value; });
  box.appendChild(formField(t("auth.id"), idInp, false, creating ? t("auth.idHint") : null));
  const pinInp = pinInput(f.pin, v => { f.pin = v; });
  box.appendChild(formField(t("auth.pin"), pinInp, false, creating ? t("auth.pinHint") : null));
  let pin2Inp = null;
  if (creating) { pin2Inp = pinInput(f.pin2, v => { f.pin2 = v; }); box.appendChild(formField(t("auth.pin2"), pin2Inp)); }
  // Profil de langues du nouveau compte (étape 35 ; noms, ordre, aperçu et « ? » : étape 52, complément) :
  // 1. langue de l'appli, 2. première langue apprise, 3. sa langue d'aide facultative, puis l'aperçu d'une carte.
  if (langBlock) {
    const lb = el("div", "lx-block");
    lb.appendChild(lxHead("h3", t("lx.title")));
    lb.appendChild(lxField(t("lx.app"), lxAppSeg(authPickUi), t("lx.appHint")));
    const tg = langSelect(f.target, null, v => { f.target = v; if (f.support === v) f.support = null; renderAuth(); });
    lb.appendChild(lxField(t("lx.target"), tg, t("lx.targetHint")));
    let pv = null;
    const sp = langSelect(f.support || "", t("prof.none"), v => {
      f.support = v || null;
      const n = lxPreview(f.target, f.support); pv.replaceWith(n); pv = n;   // aperçu en direct, sans redessiner l'écran
    }, [f.target]);
    lb.appendChild(lxField(t("lx.help"), sp, t("lx.helpHint")));
    pv = lxPreview(f.target, f.support);
    lb.appendChild(pv);
    box.appendChild(lb);
  }
  // Rester connecté
  const rem = el("label", "check");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = rememberMe();
  cb.addEventListener("change", () => setRememberMe(cb.checked));
  rem.append(cb, el("span", null, t("auth.remember")));
  box.appendChild(rem);
  root.appendChild(box);

  // Anciennes données à rattacher au premier compte (mode local)
  if (first && auth.legacy && !auth.reg.migrated) {
    const m = el("div", "card auth-mig");
    m.appendChild(el("p", null, t("auth.migrate", { lists: auth.legacy.lists.length, cards: auth.legacy.cards.length })));
    const b = el("button", "btn", t("auth.backup"));
    b.addEventListener("click", () => backupLegacy(false));
    m.appendChild(b);
    root.appendChild(m);
  }

  const submit = () => { if (creating) doCreate(); else doLogin(); };
  [idInp, pinInp, pin2Inp].forEach(i => i && i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }));
  const btns = el("div", "btns");
  const go = el("button", "btn primary", t(creating ? "auth.create" : "auth.login"));
  go.addEventListener("click", submit);
  btns.appendChild(go);
  if (!first) {
    const sw = el("button", "link-btn", t(creating ? "auth.toLogin" : "auth.toCreate"));
    sw.addEventListener("click", () => { clearAuthForm(); showAuth(creating ? "login" : "create"); });
    btns.appendChild(sw);
  }
  root.appendChild(btns);
  root.appendChild(el("div", "hint auth-store", t(sbMode ? "auth.storeSupa" : Storage.isCloud() ? "auth.storeCloud" : "auth.storeLocal")));
}

async function doLogin() {
  if (auth.busy) return;
  const id = normId(auth.form.id), pin = auth.form.pin;
  if (id.length < 2) { authError("auth.err.id"); return; }
  if (!validPin(pin)) { authError("auth.err.pin"); return; }
  auth.busy = true;
  try {
    if (auth.mode === "supabase") { await sbLogin(id, pin); return; }
    let a = auth.reg.accounts.find(x => x.id === id);
    if (!a && Storage.isCloud()) { auth.reg = await Storage.loadAccounts(); a = auth.reg.accounts.find(x => x.id === id); } // créé sur un autre appareil
    if (!a && validId(id)) { offerCreate(id); return; }
    if (!a || (await hashPin(pin, a.salt)) !== a.pinHash) { authError("auth.err.wrong"); return; }
    clearAuthForm();
    await startUser(id, null);
  } finally { auth.busy = false; }
}
// Identifiant inconnu : on passe à la création, identifiant et PIN gardés (il reste la confirmation).
function offerCreate(id) {
  auth.form.id = id; auth.form.pin2 = "";
  auth.msg = { key: "auth.unknown", vars: { id } };
  showAuth("create");
}
async function sbLogin(id, pin) {
  try {
    const session = await Supa.signIn(id, pin);
    auth.lastPin = pin;
    auth.loginVia = "pin";
    clearAuthForm();
    await enterSupabase(session);
  } catch (e) {
    const k = sbErrKind(e);
    if (k !== "wrong") { authErrKind(k); return; }
    let exists = true;
    try { exists = await Supa.usernameExists(id); } catch (e2) {}
    if (!exists && validId(id)) offerCreate(id);
    else authError("auth.err.wrong");
  }
}

async function doCreate() {
  if (auth.busy) return;
  const f = auth.form, id = normId(f.id);
  if (!validId(id)) { authError("auth.err.id"); return; }
  if (!validPin(f.pin)) { authError("auth.err.pin"); return; }
  if (f.pin !== f.pin2) { authError("auth.err.pin2"); return; }
  auth.busy = true;
  try {
    const target = { lang: f.target, support: f.support };   // profil de langues du nouveau compte (étape 35)
    if (auth.mode === "supabase") { await sbCreate(id, f.pin, target); return; }
    auth.reg = await Storage.loadAccounts(); // registre à jour (autre appareil)
    if (auth.reg.accounts.some(a => a.id === id)) { authError("auth.err.exists"); return; }
    const migrate = !auth.reg.migrated && !!auth.legacy;
    if (migrate && !auth.backupAsked) { askBackup(); return; }
    const salt = uid();
    auth.reg.accounts.push({ id, salt, pinHash: await hashPin(f.pin, salt), createdAt: Date.now() });
    auth.reg.migrated = true; // anciennes données rattachées une seule fois, au premier compte
    await Storage.saveAccounts(auth.reg);
    let preset = null;
    if (migrate) { preset = normalizeData(auth.legacy); preset.updatedAt = Date.now(); }
    auth.legacy = null;
    clearAuthForm();
    Tutorial.markNew(id);   // étape 40 : tutoriel lancé tout seul pour ce nouveau compte
    if (typeof AccNotif !== "undefined") AccNotif.markNew(id);   // étape 71 (sans effet en mode local : pas de notifications)
    await startUser(id, preset, target);
    toast(t(migrate ? "auth.migrated" : "auth.welcome", { id }));
  } finally { auth.busy = false; }
}
async function sbCreate(id, pin, target) {
  try {
    if (await Supa.usernameExists(id)) { authError("auth.err.exists"); return; }
    const session = await Supa.signUp(id, pin);
    auth.lastPin = pin;
    auth.loginVia = "create";
    clearAuthForm();
    Tutorial.markNew(id);   // étape 40 : tutoriel lancé tout seul pour ce nouveau compte
    if (typeof AccNotif !== "undefined") AccNotif.markNew(id);   // étape 71 : rappels proposés juste après la création
    await enterSupabase(session, target);
    toast(t("auth.welcome", { id }));
  } catch (e) { authErrKind(sbErrKind(e)); }
}

// Supabase : profil du compte (identifiant, PIN à changer, admin), puis ouverture des données.
// Hors connexion : dernier profil connu sur cet appareil, s'il s'agit du même compte.
// Étape 77 : un seul passage à la fois pour un même compte (un 2e appel pendant l'ouverture attend le 1er, sans tout refaire).
let enterRun = null;
function enterSupabase(session, target) {
  const u = session && session.user && session.user.id;
  if (enterRun && enterRun.uid === u) return enterRun.p;
  const p = enterSupabaseRun(session, target).finally(() => { if (enterRun && enterRun.p === p) enterRun = null; });
  enterRun = { uid: u, p };
  return p;
}
async function enterSupabaseRun(session, target) {
  const userUuid = session.user.id;
  let prof = null;
  try { prof = await Supa.myProfile(); }
  catch (e) {
    try { const c = JSON.parse(localStorage.getItem(CONFIG.LS_SB_PROFILE) || "null"); if (c && c.uid === userUuid) prof = c; } catch (e2) {}
    if (!prof) throw e;
  }
  const id = normId((prof && prof.identifiant) || String(session.user.email || "").split("@")[0]);
  // Compte bloqué par l'admin (étape 27) : écran « Compte bloqué » avec la raison, puis déconnexion (données gardées).
  if (prof && prof.blocked === true) { await showBlocked(id, prof.blocked_reason); return; }
  auth.sbUid = userUuid;
  auth.isAdmin = !!(prof && prof.is_admin);
  try { localStorage.setItem(CONFIG.LS_SB_PROFILE, JSON.stringify({ uid: userUuid, identifiant: id, is_admin: auth.isAdmin })); } catch (e) {}
  if (prof && prof.must_change_pin) {
    auth.forceId = id; auth.forceTarget = target || null;
    auth.form = { id: "", pin: "", pin2: "", target: auth.form.target, support: auth.form.support };
    showAuth("force");
    return;
  }
  Supa.touch().catch(() => {});
  if (!(await startUser(id, null, target, userUuid))) return;   // étape 77 : compte quitté avant la lecture en ligne
  Mod.refresh(true);   // étape 66 : rôle de modérateur et cases (Réglages → Administration si au moins une case)
  // Fenêtres du lancement, l'une après l'autre (étape 38) : annonces de l'admin (étape 27), puis invitation à activer
  // les notifications (fenêtre de première ouverture ou invitation de l'admin). Migration / sauvegarde : déjà faites.
  // Étape 39 : puis « Quoi de neuf » (une fois par nouvelle version).
  // Étape 40 : puis le tutoriel (nouveau compte, ou « Reprendre le tutoriel ? » s'il a été interrompu).
  // Étape 52 : puis les récompenses d'idées pas encore reçues (réservées sur le serveur, puis appliquées une fois) et un
  // message si l'équipe a répondu à une idée.
  // Étape 54 : puis les récompenses d'objectif d'équipe (+30 XP, badge « Équipe en or »), réservées puis appliquées une fois.
  // Étape 71 : nouveau compte (ou premier lancement de l'appli installée) : la fenêtre des notifications passe AVANT les
  // annonces, juste après la création du compte (AccNotif.early, js/accueil-notifs.js).
  const notifFirst = typeof AccNotif !== "undefined" && AccNotif.early(id);
  (notifFirst ? NotifInvite.check().finally(() => Ann.check()) : Ann.check().finally(() => NotifInvite.check()))
    .finally(() => WhatsNew.check()).finally(() => Ideas.check()).finally(() => Teams.check()).finally(() => Tutorial.check());
}
// Compte bloqué (étape 27) : déconnexion tout de suite (session oubliée sur l'appareil), puis écran avec la raison.
// Rien n'est envoyé ni effacé : les données du compte restent en ligne et dans le cache de l'appareil.
async function showBlocked(id, reason) {
  auth.blocked = { id, reason: String(reason || "").trim() };
  auth.sbUid = null; auth.isAdmin = false; auth.lastPin = ""; auth.loginVia = null;
  try { localStorage.removeItem(CONFIG.LS_SB_PROFILE); } catch (e) {}
  Storage.setUser(null);
  Storage.setSession(null);
  await Supa.signOut();
  clearAuthForm();
  showAuth("blocked");
}
function renderBlocked(root) {
  const b = auth.blocked || { id: "", reason: "" };
  const box = el("div", "card blk-card");
  box.setAttribute("role", "alert");
  box.appendChild(el("h2", null, t("blk.title")));
  box.appendChild(el("p", null, t("blk.text", { id: b.id || "?" })));
  const r = el("div", "blk-reason");
  r.appendChild(el("div", "muted blk-lbl", t("blk.reason")));
  r.appendChild(el("div", "blk-txt", b.reason || "—"));
  box.appendChild(r);
  box.appendChild(el("p", "muted blk-help", t("blk.help")));
  root.appendChild(box);
  const ok = el("button", "btn primary", t("blk.ok"));
  ok.addEventListener("click", () => { auth.blocked = null; showAuth("login"); });
  root.appendChild(ok);
}
// Écran bloquant : nouveau PIN obligatoire (admin à la première connexion, ou PIN réinitialisé par l'admin).
function renderForcePin(root) {
  const f = auth.form;
  const box = el("div", "card");
  box.appendChild(el("h2", null, t("auth.forceTitle")));
  box.appendChild(el("p", "muted", t("auth.forceText")));
  if (auth.err) box.appendChild(authErrBox());
  const p1 = pinInput(f.pin, v => { f.pin = v; }), p2 = pinInput(f.pin2, v => { f.pin2 = v; });
  box.appendChild(formField(t("pin.new"), p1));
  box.appendChild(formField(t("pin.new2"), p2));
  [p1, p2].forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doForcePin(); } }));
  root.appendChild(box);
  const btns = el("div", "btns");
  const go = el("button", "btn primary", t("auth.forceGo"));
  go.addEventListener("click", doForcePin);
  const out = el("button", "link-btn", t("account.logout"));
  out.addEventListener("click", () => logout());
  btns.append(go, out);
  root.appendChild(btns);
}
async function doForcePin() {
  if (auth.busy) return;
  const f = auth.form;
  if (!validPin(f.pin)) { authError("auth.err.pin"); return; }
  if (f.pin !== f.pin2) { authError("auth.err.pin2"); return; }
  if (auth.lastPin && f.pin === auth.lastPin) { authError("auth.err.same"); return; }
  auth.busy = true;
  try {
    await Supa.setPin(auth.forceId, f.pin);
    auth.lastPin = "";
    Activity.log("pin_change", { forced: true });   // gardé pour le compte qui s'ouvre juste après
    const target = auth.forceTarget;
    clearAuthForm();
    toast(t("pin.done"));
    const s = await Supa.session();
    if (s) await enterSupabase(s, target); else showAuth("login");
  } catch (e) { authErrKind(sbErrKind(e)); }
  finally { auth.busy = false; }
}

// Réglages : changer de PIN (ancien + nouveau + confirmation), dans les deux modes.
function openChangePin() {
  const f = { old: "", n1: "", n2: "" };
  const wrap = el("div");
  wrap.appendChild(formField(t("pin.old"), pinInput("", v => { f.old = v; })));
  wrap.appendChild(formField(t("pin.new"), pinInput("", v => { f.n1 = v; })));
  wrap.appendChild(formField(t("pin.new2"), pinInput("", v => { f.n2 = v; })));
  let close = null, busy = false;
  close = openModal(t("pin.title"), wrap, [
    { label: t("cancel") },
    { label: t("save"), kind: "primary", onClick: () => {
      if (!busy) { busy = true; changePin(f).then(done => { busy = false; if (done && close) close(); }); }
      return false;
    } }
  ]);
}
async function changePin(f) {
  if (!validPin(f.n1)) { toast(t("auth.err.pin")); return false; }
  if (f.n1 !== f.n2) { toast(t("auth.err.pin2")); return false; }
  if (f.n1 === f.old) { toast(t("auth.err.same")); return false; }
  const id = Storage.getUser();
  if (!id) return false;
  if (auth.mode === "supabase") {
    try { await Supa.signIn(id, f.old); }        // vérifie l'ancien PIN
    catch (e) { const k = sbErrKind(e); toast(k === "wrong" ? t("pin.err.old") : errText(k)); return false; }
    try { await Supa.setPin(id, f.n1); }
    catch (e) { toast(errText(sbErrKind(e))); return false; }
    Activity.log("pin_change", {});
  } else {
    const reg = await Storage.loadAccounts();
    const a = reg.accounts.find(x => x.id === id);
    if (!a || !validPin(f.old) || (await hashPin(f.old, a.salt)) !== a.pinHash) { toast(t("pin.err.old")); return false; }
    a.salt = uid();
    a.pinHash = await hashPin(f.n1, a.salt);
    await Storage.saveAccounts(reg);
    auth.reg = reg;
  }
  toast(t("pin.done"));
  return true;
}

// Proposition d'export de sécurité avant la migration.
function askBackup() {
  openModal(t("auth.backupTitle"), el("p", null, t("auth.backupAsk")), [
    { label: t("auth.backupYes"), kind: "primary", onClick: () => { backupLegacy(true); } },
    { label: t("auth.backupNo"), onClick: () => { auth.backupAsked = true; doCreate(); } }
  ]);
}
// Si l'export passe par la fenêtre texte, on attend que la personne copie puis appuie à nouveau sur « Créer le compte ».
async function backupLegacy(thenCreate) {
  if (!auth.legacy) return;
  const r = await exportData(auth.legacyRaw || auth.legacy, "vocabulaire-francais-sauvegarde-" + todayStr() + ".json");
  auth.backupAsked = true;
  if (thenCreate && r === "saved") doCreate();
}

// Ouvre un compte, puis lance la vérification hebdomadaire (une fois les données en ligne arrivées).
// sbUid : identifiant Supabase du compte (mode Supabase).
// Étape 77 : un seul passage à la fois pour un même compte (double exécution → doublons de listes) ; sur un nouvel appareil,
// rien ne démarre (série, amis, listes communes, demandes à Claude, dictionnaire…) avant la première lecture en ligne
// réussie. Renvoie false si le compte a été quitté entre-temps.
let startRun = null;
function startUser(id, preset, target, sbUid) {
  if (startRun && startRun.id === id) return startRun.p;
  const p = startUserRun(id, preset, target, sbUid).finally(() => { if (startRun && startRun.p === p) startRun = null; });
  startRun = { id, p };
  return p;
}
async function startUserRun(id, preset, target, sbUid) {
  await startUserData(id, preset, target, sbUid);
  if (!(await Guard.ready(id))) return false;
  Streak.reset();
  Streak.tick(true);   // série : modifications de l'admin, jours manqués (gels), messages au lancement (étape 28)
  Activity.start(auth.loginVia || "resume");   // journal (mode Supabase) : login 1 par heure max, fiche appareil, envois
  Friends.start();   // amis (étape 29) : résumé public publié au lancement, badge des demandes reçues
  Shared.start();    // listes communes (étape 30) : envois en attente, nouvelles cartes, invitations
  UserStatus.reset(); UserStatus.publish();   // résumé pour les notifications (étape 32)
  Push.start();      // notifications (étape 32) : état de cet appareil, clic sur une notification
  auth.loginVia = null;
  autoWeeklyCheck(id);
  Queue.start(); // file d'attente Claude (mode Supabase) : réponses arrivées pendant l'absence
  if (typeof AutoMaj !== "undefined") AutoMaj.start();   // étape 80 : mise à jour automatique (cases vides demandées à Claude toutes seules)
  if (typeof ConjQ !== "undefined") ConjQ.start();       // étape 83 : anciennes cartes de conjugaison floues proposées à Claude
  if (typeof Sgl !== "undefined") Sgl.start();           // étape 84 : pastille « Merci, corrigé » des signalements traités
  if (typeof SglC !== "undefined") SglC.start();         // étape 85 : correction proposée par Claude pour une carte personnelle signalée
  Dict.start();  // dictionnaire commun (étape 36) : envois en attente, liaison des cartes, sens modifiés
  Images.start();   // images (étape 49) : images des sens, place utilisée, ménage (30 s après le lancement)
  if (auth.mode !== "supabase") WhatsNew.check().finally(() => Tutorial.check());   // étapes 39 et 40 (en mode Supabase : après annonces et invitation, enterSupabase)
  return true;
}
// Données du compte : locales tout de suite (cache), puis comparaison avec les données en ligne (syncWithRemote).
// target : profil d'un nouveau compte { lang, support } (ou code de langue) — liste « Démo » dans cette langue.
// Nouveau compte (ou compte vraiment vide en ligne) : liste « Démo » dans la langue choisie, langue et thème de l'écran de connexion.
function demoData(target) {
  const ui = state.settings.uiLang, theme = state.settings.theme; // choix de l'écran de connexion
  const tg = target && typeof target === "object" ? target.lang : target, sp = target && typeof target === "object" ? target.support : null;
  const d = addDemoList(emptyData(tg, sp));
  d.settings.uiLang = ui; d.settings.theme = theme;
  d.updatedAt = 0;                    // 0 = une version en ligne existante passe devant
  return d;
}
async function startUserData(id, preset, target, sbUid) {
  Storage.setUser(id, sbUid);
  Storage.setSession(id);
  resetViews();
  Storage.hold();
  const ctx = { oldLocal: false, rawV1: null, localChanged: !!preset };
  if (preset) state = preset;
  else {
    const local = Storage.readLocal();
    if (local) {
      // Étape 77 : copie de sécurité locale avant toute conversion de format (ancien bloc unique ou format < DATA_VERSION).
      if (local.old || dataVersion(local.data) < DATA_VERSION) await Guard.backup("conversion", local.data, id);
      state = normalizeData(local.data); ctx.oldLocal = local.old; if (dataVersion(local.data) < DATA_VERSION) ctx.rawV1 = local.data;
    }
    else if (Storage.hasRemote()) {
      // Étape 77 : rien sur cet appareil pour ce compte (nouvel appareil, nouveau compte, cache effacé) : AUCUNE liste « Démo »
      // tant que le serveur n'a pas été lu. Écran « Chargement de tes listes… », rien n'est modifiable ni envoyé.
      // La « Démo » n'est créée que si le compte est vraiment vide en ligne (syncWithRemote).
      const ui = state.settings.uiLang, theme = state.settings.theme; // choix de l'écran de connexion
      state = emptyData();
      state.settings.uiLang = ui; state.settings.theme = theme;
      Guard.wait(id, target || null);
    }
    else state = demoData(target);   // sans données en ligne possibles (navigateur seul) : liste « Démo » comme avant
  }
  Fusion.track(state);   // étape 78 : état de départ suivi tout de suite (une modification faite avant la lecture en ligne est vue)
  Shared.reset();
  Shared.attach(state);   // cartes des listes communes (cache de l'appareil, étape 30)
  document.body.classList.remove("auth");
  render();
  showScreen(screenFromHash());
  // Étape 78 : si la comparaison échoue sur une erreur imprévue, les enregistrements ne restent jamais retenus en mémoire
  // (Storage.hold) : ils reprennent sur l'appareil ; l'erreur remonte comme avant.
  try { await syncWithRemote(id, ctx, true); }
  catch (e) { Storage.release(); throw e; }
}

// Comparaison avec les données en ligne : au lancement (first = true : migrations puis Storage.release),
// au retour de la connexion, et en cas de conflit détecté pendant un envoi (ctx.conflict).
// Règles (étape 78) : identiques → rien ; l'appareil n'a rien à envoyer → version en ligne ; le serveur n'a pas changé depuis
// la dernière synchro → envoi ; les deux ont changé (ou conflit vu pendant un envoi) → fusion.
// Ancien format (un seul bloc) ou modèle plus ancien que DATA_VERSION (v1, v2) : export JSON de sécurité, puis enregistrement
// découpé dans la version actuelle (v3 : toutes les cartes existantes en type "vocab").
// Étape 77 : nouvel appareil (Guard.waiting) : le serveur est TOUJOURS lu d'abord et ses données gagnent ; lecture ratée →
// rien n'est écrit ni daté, écran « Réessayer » ; compte vraiment vide en ligne → liste « Démo ». Lecture ratée sur un appareil
// qui a déjà les données : elles restent affichées, mais ne sont plus datées « maintenant » (elles ne passent plus devant le serveur).
// ctx.guard = "remote" : « Utiliser la version en ligne » (garde-fou). Copie de sécurité locale avant tout remplacement de données
// de l'appareil pas encore envoyées, et avant toute conversion de format.
// Étape 78 : plus de fenêtre « quelles données garder ». Le serveur a changé depuis la dernière synchro (égalité des dates
// d'index seulement, jamais de comparaison d'horloges) ET l'appareil a des modifications non envoyées (suivi de js/fusion.js)
// → FUSION par liste et par carte (Fusion.merge) ; versions perdantes gardées avant (Fusion.keep, sinon rien n'est fait) ;
// message à l'utilisateur (Fusion.notify). Appareil sans modification : il prend le serveur. Serveur inchangé : l'appareil envoie.
// Pendant une session de révision : la comparaison attend la fin de la session (Fusion.later), rien n'est envoyé entre-temps.
let syncBusy = false;
async function syncWithRemote(id, ctx, first) {
  if (syncBusy && !first) {
    // Étape 78 : un conflit vu pendant un envoi n'est jamais oublié (les envois restent arrêtés tant qu'il n'est pas traité).
    if (ctx && ctx.conflict) setTimeout(() => { if (Storage.getUser() === id) syncWithRemote(id, ctx, false); }, 1500);
    return;
  }
  if (!first && !(ctx && ctx.guard) && Fusion.inSession()) {   // étape 78
    Fusion.later(() => { if (Storage.getUser() === id) syncWithRemote(id, ctx, false); });
    return;
  }
  syncBusy = true;
  try {
    ctx = ctx || {};
    const fresh = Guard.waiting(id);
    let oldRemote = false, rawV1 = ctx.rawV1 || null;
    const remote = await Storage.initRemote();
    if (Storage.getUser() !== id) return;
    const readFailed = remote === null && Storage.hasRemote();
    if (readFailed && fresh) { Guard.waitFailed(); return; }   // rien d'affiché, rien d'envoyé ; nouvel essai toutes les 20 s
    if (remote === undefined && fresh) {                        // compte vraiment vide en ligne : « Démo » (nouveau compte)
      state = demoData(Guard.target());
      Fusion.synced(); Fusion.track(state); Fusion.demo(state);   // étape 78 : « Démo » pas encore touchée (une version en ligne passerait devant)
      Shared.attach(state);
      render();
    }
    let fusion = null;                                          // étape 78 : résultat d'une fusion appliquée
    if (remote) {
      const r = normalizeData(remote.data);
      const S = Storage.getSynced(), l = num(state.updatedAt, 0);
      const legacyFmt = remote.old || dataVersion(remote.data) < 2;
      // Étape 78 : modifications de l'appareil pas encore envoyées = suivi de js/fusion.js (sans horloge) ; appareil d'avant
      // la version 78 (aucun suivi) : ancienne règle, dates de l'appareil.
      const wasLegacy = Fusion.legacy();
      const localDirty = !!ctx.localChanged || Fusion.dirty(l > 0 && (S === null || l > S));
      const serverMoved = S === null || r.updatedAt !== S;     // le serveur a changé depuis la dernière synchro de cet appareil
      let take = null;                           // "remote" | "local" | "merge" | null (identiques)
      if (fresh || ctx.guard === "remote" || Fusion.demoOnly(state)) take = "remote";   // étape 77 : nouvel appareil, ou choix « Utiliser la version en ligne »
      else if (legacyFmt) take = r.updatedAt >= l ? "remote" : "local";
      else if (r.updatedAt !== l || ctx.conflict) {
        if (!localDirty && !ctx.conflict) take = "remote";     // rien à envoyer : la version en ligne
        else if (!serverMoved && !ctx.conflict) take = "local"; // serveur inchangé : l'appareil envoie
        else take = "merge";                                   // les deux ont bougé : fusion
      }
      if (take === "merge") {
        const res = Fusion.merge(state, r);
        // Versions perdantes gardées AVANT d'appliquer. Copie impossible : rien n'est fait ni envoyé, nouvel essai plus tard.
        if (!(await Fusion.keep(res, id))) {
          if (Storage.getUser() !== id) return;
          Storage.setConflictOpen(true);
          toast(t("gf.copyErr"));
          if (first) Storage.release();
          setTimeout(() => { if (Storage.getUser() === id) syncWithRemote(id, { conflict: true }, false); }, CONFIG.RETRY_MS);
          return;
        }
        if (Storage.getUser() !== id) return;
        Activity.log("merge", { local: res.n.local, remote: res.n.remote, cards: res.n.merged, coll: res.items.length });
        state = res.data;
        Fusion.track(state);
        Shared.attach(state);   // étape 30
        Fusion.merged(res);
        Storage.mergedOn(r.updatedAt);                         // l'appareil contient la version en ligne lue : l'envoi suivant n'est pas un conflit
        Guard.setBase(r);                                      // garde-fou : base = version en ligne lue…
        Guard.noteDeleted(res.goneR);                          // … moins ses cartes supprimées ici (pierres tombales) : suppressions voulues
        state.updatedAt = Math.max(Date.now(), r.updatedAt + 1);
        rawV1 = dataVersion(remote.data) < DATA_VERSION ? remote.data : rawV1;
        fusion = res;
        render();
      }
      Storage.setConflictOpen(false);
      if (Storage.getUser() !== id) return;
      if (take === "remote") {
        // Étape 77 : copie de ce que l'appareil avait de plus. Étape 78 : aussi, une fois, pour un appareil d'avant la version 78
        // (son suivi des modifications n'existe pas encore).
        if (!fresh && (localDirty || ctx.guard === "remote" || wasLegacy) && Guard.hasContent(state) && !Fusion.demoOnly(state)) {
          await Guard.backup("remplacement", state, id);
          if (Storage.getUser() !== id) return;
        }
        if (ctx.guard === "remote") Activity.log("guard_online", { local: state.cards.length, remote: r.cards.length });
        state = r;
        Fusion.track(state);    // étape 78
        Shared.attach(state);   // étape 30
        oldRemote = remote.old;
        rawV1 = dataVersion(remote.data) < DATA_VERSION ? remote.data : null;
        if (!oldRemote && !rawV1) Storage.markSynced(state);
        else { Fusion.synced(); if (!oldRemote) Storage.mergedOn(r.updatedAt); }   // étape 78 : conversion de format : l'envoi qui suit n'est pas un conflit
        render();
      } else if (take === null) {
        // Identiques, mais en ligne dans un ancien modèle (ex. v4 → v5, étape 35) : rien n'est marqué « déjà en ligne »,
        // les morceaux migrés partent (index en dernier), après l'export de sécurité.
        if (dataVersion(remote.data) < DATA_VERSION && !remote.old) { rawV1 = rawV1 || remote.data; Fusion.synced(); Storage.mergedOn(r.updatedAt); }
        else Storage.markSynced(state);
      }
      else if (take === "local" && legacyFmt) Storage.mergedOn(r.updatedAt);
      // Étape 77 : appareil d'avant la version 77 (pas encore de base) dont le serveur n'a pas changé depuis sa dernière synchro.
      else if (take === "local" && !Guard.base() && S !== null && r.updatedAt === S) Guard.setBase(r);
      // Série : modifications de l'admin écrites en ligne dans la clé streak (étape 28), même si les données
      // de cet appareil sont gardées. Appliquées par Streak.tick (au lancement, ou ci-dessous).
      try { streakMerge(state.streak, remote.data && remote.data.streak); } catch (e) {}
    }
    if (ctx.oldLocal || oldRemote || rawV1) {
      // Étape 77 : copie de sécurité locale du format d'origine en ligne (celle de l'appareil est faite à l'ouverture).
      if (remote && (oldRemote || (rawV1 && rawV1 === remote.data))) await Guard.backup("conversion", remote.data, id);
      // Sauvegarde de sécurité (on n'attend pas plus d'une minute une réponse à la demande d'enregistrement).
      const name = (rawV1 ? "sauvegarde-avant-v" + DATA_VERSION + "-" : "sauvegarde-avant-migration-") + id + "-" + todayStr() + ".json";
      try { await withTimeout(exportData(rawV1 || state, name), 60000); } catch (e) {}
      if (Storage.getUser() !== id) return;
    }
    if (!readFailed) {   // étape 77 : jamais daté « maintenant » sans avoir pu lire le serveur
      if (!state.updatedAt) state.updatedAt = Date.now();
      if (rawV1) state.updatedAt = Math.max(Date.now(), state.updatedAt + 1); // la nouvelle version du modèle passe devant l'ancienne partout
    }
    if (first || fresh) Storage.release();
    Storage.save(state);        // local tout de suite, en ligne regroupé (seulement si les données en ligne ont été lues)
    const migKey = rawV1 ? (dataVersion(rawV1) < 2 ? "save.migratedV2" : dataVersion(rawV1) < 3 ? "save.migratedV3" : dataVersion(rawV1) < 4 ? "save.migratedV4" : dataVersion(rawV1) < 5 ? "save.migratedV5" : dataVersion(rawV1) < 6 ? "save.migratedV6" : dataVersion(rawV1) < 7 ? "save.migratedV7" : dataVersion(rawV1) < 8 ? "save.migratedV8" : "save.migratedV9") : "save.migrated";
    if (ctx.oldLocal && Storage.dropOldLocal(state)) toast(t(migKey));
    else if (oldRemote || rawV1) toast(t(migKey));
    if (fresh) Guard.done(id);   // étape 77 : le reste de l'ouverture du compte peut démarrer (startUser)
    if (!first) { if (!fresh) Streak.tick(true); render(); }
    if (fusion) Fusion.notify(fusion);   // étape 78 : « fusionné », ou la liste des cartes modifiées des deux côtés
  } finally { syncBusy = false; }
}
// Vues en mémoire remises à zéro au changement de compte (aucune donnée touchée).
function resetViews() {
  rv.phase = "config"; rv.cfg = null; rv.s = null;
  lv.listId = null; lv.query = ""; lv.reorder = false;
  stv.lang = ""; stv.scope = "";
  quizHideAnswer = false;
  pvReset();
  adm.list = null; adm.error = false;
  al.data = null; al.err = ""; al.page = 0; al.missing = false; al.f = { user: "", kind: "", days: "7" };
}

async function logout() {
  await Activity.end();   // journal : logout + envoi de ce qui attend (5 s max)
  await Push.end();       // notifications : cet appareil ne reçoit plus celles de ce compte (étape 32)
  await Storage.flushWait();
  Queue.reset();
  if (typeof AutoMaj !== "undefined") AutoMaj.reset();   // étape 80
  if (typeof ConjQ !== "undefined") ConjQ.reset();       // étape 83
  if (typeof Sgl !== "undefined") Sgl.reset();           // étape 84
  if (typeof SglC !== "undefined") SglC.reset();         // étape 85
  if (typeof ClNew !== "undefined") ClNew.reset();       // étape 80
  Dict.reset();   // dictionnaire commun (étape 36)
  Ann.reset();
  NotifInvite.reset();   // étape 38
  WhatsNew.reset();      // étape 39
  Tutorial.reset();      // étape 40
  Streak.reset();
  Friends.reset();
  Shared.reset();
  UserStatus.reset();
  Mod.reset();   // étape 66 : rôle de modérateur oublié (relu au prochain compte)
  Storage.setUser(null);
  Storage.setSession(null);
  if (auth.mode === "supabase") {
    await Supa.signOut();
    auth.isAdmin = false; auth.sbUid = null;
    try { localStorage.removeItem(CONFIG.LS_SB_PROFILE); } catch (e) {}
  }
  resetViews();
  const settings = state.settings; // garder langue et thème sur l'écran de connexion
  state = emptyData();
  state.settings = settings;
  clearAuthForm();
  showAuth("loading");
  if (auth.mode !== "supabase") auth.reg = await Storage.loadAccounts();
  showAuth("login");
}
