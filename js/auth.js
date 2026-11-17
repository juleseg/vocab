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
// Sélecteur de langue de l'interface, visible sur l'écran de connexion.
function authLangSeg() {
  const seg = el("div", "seg");
  [["ko", "한국어"], ["fr", "Français"], ["en", "English"]].forEach(([code, label]) => {
    const b = el("button", null, label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.settings.uiLang === code));
    b.addEventListener("click", () => {
      state.settings.uiLang = code; savePrefs(); applyI18n(); renderSyncStatus(Storage.getMode());
      renderAuth(); // tous les textes, messages et erreurs compris, sont relus dans la nouvelle langue
    });
    seg.appendChild(b);
  });
  const f = formField(t("auth.lang"), seg);
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
  // Profil de langues du nouveau compte (étape 35) : langue de l'interface (sélecteur en haut), première langue apprise
  // et sa langue d'appui facultative (pas pour le premier compte qui reçoit les anciennes données : migration).
  if (creating && !(first && auth.legacy && !auth.reg.migrated)) {
    const tg = langSelect(f.target, null, v => { f.target = v; if (f.support === v) f.support = null; renderAuth(); });
    box.appendChild(formField(t("auth.target"), tg, false, t("auth.targetHint")));
    const sp = langSelect(f.support || "", t("prof.none"), v => { f.support = v || null; }, [f.target]);
    box.appendChild(formField(t("prof.support"), sp, false, t("prof.supportHint")));
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
    await enterSupabase(session, target);
    toast(t("auth.welcome", { id }));
  } catch (e) { authErrKind(sbErrKind(e)); }
}

// Supabase : profil du compte (identifiant, PIN à changer, admin), puis ouverture des données.
// Hors connexion : dernier profil connu sur cet appareil, s'il s'agit du même compte.
async function enterSupabase(session, target) {
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
  await startUser(id, null, target, userUuid);
  Ann.check();   // annonces de l'admin (étape 27), après l'ouverture des données
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
async function startUser(id, preset, target, sbUid) {
  await startUserData(id, preset, target, sbUid);
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
  Dict.start();  // dictionnaire commun (étape 36) : envois en attente, liaison des cartes, sens modifiés
}
// Données du compte : locales tout de suite (cache), puis comparaison avec les données en ligne (syncWithRemote).
// target : profil d'un nouveau compte { lang, support } (ou code de langue) — liste « Démo » dans cette langue.
async function startUserData(id, preset, target, sbUid) {
  Storage.setUser(id, sbUid);
  Storage.setSession(id);
  resetViews();
  Storage.hold();
  const ctx = { oldLocal: false, rawV1: null, localChanged: !!preset };
  if (preset) state = preset;
  else {
    const local = Storage.readLocal();
    if (local) { state = normalizeData(local.data); ctx.oldLocal = local.old; if (dataVersion(local.data) < DATA_VERSION) ctx.rawV1 = local.data; }
    else {
      const ui = state.settings.uiLang, theme = state.settings.theme; // choix de l'écran de connexion
      const tg = target && typeof target === "object" ? target.lang : target, sp = target && typeof target === "object" ? target.support : null;
      state = addDemoList(emptyData(tg, sp)); // nouveau compte (ou nouvel appareil) : liste "Démo"
      state.settings.uiLang = ui; state.settings.theme = theme;
      state.updatedAt = 0;                    // 0 = une version en ligne existante passe devant
    }
  }
  Shared.reset();
  Shared.attach(state);   // cartes des listes communes (cache de l'appareil, étape 30)
  document.body.classList.remove("auth");
  render();
  showScreen(screenFromHash());
  await syncWithRemote(id, ctx, true);
}

// Comparaison avec les données en ligne : au lancement (first = true : migrations puis Storage.release),
// au retour de la connexion, et en cas de conflit détecté pendant un envoi (ctx.conflict).
// Règles : identiques → rien ; en ligne plus récentes et pas de modification locale non envoyée → on les prend ;
// en ligne plus récentes ET modifications locales non envoyées (ou conflit) → on demande lesquelles garder ;
// locales plus récentes → envoi.
// Ancien format (un seul bloc) ou modèle plus ancien que DATA_VERSION (v1, v2) : export JSON de sécurité, puis enregistrement
// découpé dans la version actuelle (v3 : toutes les cartes existantes en type "vocab").
let syncBusy = false;
async function syncWithRemote(id, ctx, first) {
  if (syncBusy && !first) return;
  syncBusy = true;
  try {
    ctx = ctx || {};
    let oldRemote = false, rawV1 = ctx.rawV1 || null;
    const remote = await Storage.initRemote();
    if (Storage.getUser() !== id) return;
    if (remote) {
      const r = normalizeData(remote.data);
      const S = Storage.getSynced(), l = num(state.updatedAt, 0);
      const legacyFmt = remote.old || dataVersion(remote.data) < 2;
      let take = null, asked = false;            // "remote" | "local" | null (identiques)
      if (legacyFmt) take = r.updatedAt >= l ? "remote" : "local";
      else if (r.updatedAt !== l) {
        const localDirty = !!ctx.localChanged || (l > 0 && (S === null || l > S));
        if (ctx.conflict || (r.updatedAt > l && localDirty)) {
          take = await askConflict(state, r); asked = true;
          Activity.log("conflict", { choice: take, local: state.cards.length, remote: r.cards.length });
        }
        else take = r.updatedAt > l ? "remote" : "local";
      }
      Storage.setConflictOpen(false);
      if (Storage.getUser() !== id) return;
      if (take === "remote") {
        state = r;
        Shared.attach(state);   // étape 30
        oldRemote = remote.old;
        rawV1 = dataVersion(remote.data) < DATA_VERSION ? remote.data : null;
        if (!oldRemote && !rawV1) Storage.markSynced(state);
        render();
      } else if (take === null) {
        // Identiques, mais en ligne dans un ancien modèle (ex. v4 → v5, étape 35) : rien n'est marqué « déjà en ligne »,
        // les morceaux migrés partent (index en dernier), après l'export de sécurité.
        if (dataVersion(remote.data) < DATA_VERSION && !remote.old) rawV1 = rawV1 || remote.data;
        else Storage.markSynced(state);
      }
      else if (asked) {                          // « garder cet appareil » : tout renvoyer
        Storage.forceFullPush(remote.keys, r.updatedAt);
        state.updatedAt = Math.max(Date.now(), r.updatedAt + 1);
      }
      // Série : modifications de l'admin écrites en ligne dans la clé streak (étape 28), même si les données
      // de cet appareil sont gardées. Appliquées par Streak.tick (au lancement, ou ci-dessous).
      try { streakMerge(state.streak, remote.data && remote.data.streak); } catch (e) {}
    }
    if (ctx.oldLocal || oldRemote || rawV1) {
      // Sauvegarde de sécurité (on n'attend pas plus d'une minute une réponse à la demande d'enregistrement).
      const name = (rawV1 ? "sauvegarde-avant-v" + DATA_VERSION + "-" : "sauvegarde-avant-migration-") + id + "-" + todayStr() + ".json";
      try { await withTimeout(exportData(rawV1 || state, name), 60000); } catch (e) {}
      if (Storage.getUser() !== id) return;
    }
    if (!state.updatedAt) state.updatedAt = Date.now();
    if (rawV1) state.updatedAt = Math.max(Date.now(), state.updatedAt + 1); // la nouvelle version du modèle passe devant l'ancienne partout
    if (first) Storage.release();
    Storage.save(state);        // local tout de suite, en ligne regroupé (seulement si les données en ligne ont été lues)
    const migKey = rawV1 ? (dataVersion(rawV1) < 2 ? "save.migratedV2" : dataVersion(rawV1) < 3 ? "save.migratedV3" : dataVersion(rawV1) < 4 ? "save.migratedV4" : "save.migratedV5") : "save.migrated";
    if (ctx.oldLocal && Storage.dropOldLocal(state)) toast(t(migKey));
    else if (oldRemote || rawV1) toast(t(migKey));
    if (!first) { Streak.tick(true); render(); }
  } finally { syncBusy = false; }
}
// Fenêtre de conflit (ne se ferme pas en touchant le fond). Renvoie "remote" ou "local".
function askConflict(localData, remoteData) {
  Storage.setConflictOpen(true);
  const fmt = ts => { try { return ts ? new Date(ts).toLocaleString(state.settings.uiLang) : "—"; } catch (e) { return "—"; } };
  return new Promise(res => {
    const p = el("p", null, t("conflict.text", {
      rdate: fmt(remoteData.updatedAt), rcards: remoteData.cards.length,
      ldate: fmt(localData.updatedAt), lcards: localData.cards.length
    }));
    openModal(t("conflict.title"), p, [
      { label: t("conflict.remote"), kind: "primary", onClick: () => res("remote") },
      { label: t("conflict.local"), onClick: () => res("local") }
    ], { locked: true });
  });
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
  Dict.reset();   // dictionnaire commun (étape 36)
  Ann.reset();
  Streak.reset();
  Friends.reset();
  Shared.reset();
  UserStatus.reset();
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
