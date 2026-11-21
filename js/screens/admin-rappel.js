"use strict";

// === ADMINISTRATION : RAPPEL RÉGULIER D'ACTIVER LES NOTIFICATIONS (ÉTAPE 74) ===
// Carte « Rappel régulier » en haut de l'onglet « Inviter à activer » de Administration → Notifications (npInviteTab,
// js/screens/admin-invite.js). Réglages du bandeau de l'Accueil (js/rappel-notifs.js) : interrupteur général, fréquence
// (tous les X jours, 1 à 60, 7 par défaut), nombre maximum de rappels par appareil (1 à 20, 5 par défaut), texte en ko / fr / en
// (textes par défaut de l'appli proposés, modifiables ; une langue vide prend le texte d'une autre langue), aperçu.
// Lecture : notif_reminder_get (tout compte connecté). Écriture : admin_notif_reminder_set, réservée à l'admin et aux
// modérateurs qui ont la case « notif.send » (contrôle SERVEUR, perm_guard ; ici l'onglet est déjà en lecture seule sans elle :
// modRO de renderAdminPush). Le serveur note la modification au journal (admin_push, action reminder_set) sous le nom de la personne.
// Compteurs : admin_notif_reminder_stats(jours) — événements push_invite_* de l'étape 38 avec l'origine « reminder ».
// Hors connexion : dernières valeurs connues (cache de NotifRappel) ; script SQL de l'étape 74 absent : message, valeurs par défaut.
const nra = { started: false, loading: false, missing: false, offline: false, err: "", val: null, form: null, saving: false,
  stats: null, statsErr: "", statsLoading: false, days: 30, at: 0, dirty: false };
function nraRerender() { if (typeof niRerender === "function") niRerender(); }
function nraIsMissing(e) {
  const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
  return ["PGRST202", "42883", "PGRST205", "42P01"].includes(code) || /could not find|does not exist|schema cache/i.test(msg);
}
// Textes du formulaire : ceux de l'admin s'il en a enregistré, sinon les textes par défaut des 3 langues.
function nraDefaultTexts() { const o = {}; AN_LANGS.forEach(l => { o[l] = (I18N[l] && I18N[l]["nrp.def"]) || ""; }); return o; }
function nraFormOf(v) {
  const s = v || {};
  const has = s && s.text && AN_LANGS.some(l => String(s.text[l] || "").trim());
  const text = has ? Object.assign({ ko: "", fr: "", en: "" }, s.text) : nraDefaultTexts();
  return { on: s.on !== false, every: s.every, max: s.max, text };
}
async function nraLoad() {
  nra.loading = true; nra.err = "";
  nraRerender();
  try {
    const r = await aqRpc("notif_reminder_get");
    nra.val = NotifRappel.apply(r);   // même cache que le bandeau de cet appareil
    nra.missing = false; nra.offline = false;
  } catch (e) {
    if (nraIsMissing(e)) { nra.missing = true; nra.val = NotifRappel.apply(null); }
    else { nra.val = NotifRappel.settings(); nra.offline = sbErrKind(e) === "net"; if (!nra.offline) nra.err = aqErrText(e); }
  }
  nra.form = nraFormOf(nra.val);
  nra.loading = false; nra.dirty = false; nra.at = Date.now();
  nraRerender();
  if (!nra.missing) nraLoadStats();
}
async function nraLoadStats() {
  nra.statsLoading = true; nra.statsErr = "";
  nraRerender();
  try { nra.stats = await aqRpc("admin_notif_reminder_stats", { p_days: nra.days }); }
  catch (e) { nra.stats = null; nra.statsErr = nraIsMissing(e) ? t("nrp.adm.missing") : aqErrText(e); }
  nra.statsLoading = false;
  nraRerender();
}
function nraStateText(v) {
  return t("nrp.adm.state", { s: v.on ? t("nrp.adm.stateOn", { d: v.every, m: v.max }) : t("nrp.adm.stateOff") });
}
async function nraSave() {
  const f = nra.form;
  const every = parseInt(f.every, 10), max = parseInt(f.max, 10);
  if (!(every >= 1 && every <= 60 && max >= 1 && max <= 20)) { toast(t("nrp.adm.err.bad")); return; }
  const text = {};
  AN_LANGS.forEach(l => { text[l] = String(f.text[l] || "").trim(); });
  if (AN_LANGS.some(l => text[l].length > 300)) { toast(t("nrp.adm.err.text")); return; }
  nra.saving = true; nraRerender();
  try {
    const r = await aqRpc("admin_notif_reminder_set", { p_on: !!f.on, p_every: every, p_max: max, p_text: text });
    nra.val = NotifRappel.apply(r);
    nra.form = nraFormOf(nra.val); nra.dirty = false; nra.at = Date.now();
    toast(t("nrp.adm.saved"));
    if (typeof NotifRappel.reset === "function") NotifRappel.reset();
  } catch (e) {
    const h = String((e && e.hint) || "");
    toast(h === "nr_bad" ? t("nrp.adm.err.bad") : h === "nr_text" ? t("nrp.adm.err.text") : nraIsMissing(e) ? t("nrp.adm.missing")
      : (typeof modErrText === "function" ? modErrText(e) : aqErrText(e)));
  }
  nra.saving = false;
  nraRerender();
  nraLoadStats();
}

// Carte (dessinée à chaque rendu de l'onglet ; les champs écrivent dans nra.form sans redessiner).
function nraCard(root) {
  // Relu à la première ouverture, puis au retour sur l'onglet après 1 min (jamais pendant une saisie pas enregistrée).
  if (!nra.started || (!nra.loading && !nra.saving && !nra.dirty && Date.now() - nra.at > 60000)) { nra.started = true; nraLoad(); }
  const c = el("div", "card nra");
  c.id = "nraCard";
  c.appendChild(el("h3", "np-h3", "🔔 " + t("nrp.adm.title")));
  c.appendChild(el("p", "hint", t("nrp.adm.intro")));
  if (nra.loading && !nra.form) { c.appendChild(el("p", "muted", t("admin.loading"))); root.appendChild(c); return; }
  if (nra.missing) c.appendChild(el("div", "card np-msg nra-missing", t("nrp.adm.missing")));
  if (nra.offline) c.appendChild(el("p", "hint nra-offline", t("nrp.adm.offline")));
  if (nra.err) c.appendChild(el("p", "q-err", nra.err));
  if (!nra.form) { nra.val = NotifRappel.settings(); nra.form = nraFormOf(nra.val); }
  const f = nra.form;
  c.appendChild(el("p", "hint nra-state", nraStateText(nra.val || NotifRappel.settings())));
  if (typeof Mod !== "undefined" && !Mod.allow("notif.send")) c.appendChild(el("p", "hint nra-ro", t("nrp.adm.ro")));
  const box = el("div", "nra-form");
  if (nra.missing) box.hidden = true;
  // Interrupteur général
  const lab = el("label", "check-row");
  const cb = el("input"); cb.type = "checkbox"; cb.id = "nraOn"; cb.checked = !!f.on;
  cb.addEventListener("change", () => { f.on = cb.checked; nra.dirty = true; });
  lab.append(cb, el("span", null, t("nrp.adm.on")));
  box.appendChild(lab);
  // Fréquence et maximum
  const numIn = (id, v, min, max, on) => {
    const i = el("input", "input"); i.type = "number"; i.id = id; i.min = String(min); i.max = String(max); i.step = "1"; i.inputMode = "numeric";
    i.value = String(v);
    i.addEventListener("input", () => { on(i.value); nra.dirty = true; });
    return i;
  };
  const row = el("div", "nra-row");
  row.append(formField(t("nrp.adm.every"), numIn("nraEvery", f.every, 1, 60, v => { f.every = v; })),
             formField(t("nrp.adm.max"), numIn("nraMax", f.max, 1, 20, v => { f.max = v; })));
  box.appendChild(row);
  // Textes par langue + aperçu (langue de l'interface, sinon repli)
  box.appendChild(el("h4", "fc-h4", t("nrp.adm.text")));
  box.appendChild(el("p", "hint", t("nrp.adm.textHint")));
  const prev = el("div", "nra-prev");
  const paintPrev = () => {
    prev.textContent = "";
    const tx = NotifRappel.textFor({ text: f.text }, state.settings.uiLang);
    prev.appendChild(NotifRappel.view(tx.text, tx.lang !== state.settings.uiLang ? tx.lang : null));
    prev.querySelectorAll("button").forEach(b => { b.tabIndex = -1; b.setAttribute("aria-hidden", "true"); b.dataset.modKeep = "1"; });
  };
  const wrap = el("div", "np-texts");
  AN_LANGS.forEach(l => {
    const lb = el("div", "np-lang");
    lb.appendChild(el("div", "np-lang-h", langName(l, l) + " (" + l.toUpperCase() + ")"));
    const ta = el("textarea", "input"); ta.rows = 2; ta.maxLength = 300; ta.lang = l; ta.id = "nraText-" + l;
    ta.value = f.text[l] || "";
    ta.addEventListener("input", () => { f.text[l] = ta.value; nra.dirty = true; paintPrev(); });
    lb.appendChild(ta);
    wrap.appendChild(lb);
  });
  box.appendChild(wrap);
  const def = el("button", "link-btn", t("nrp.adm.default"));
  def.type = "button"; def.id = "nraDefault";
  def.addEventListener("click", () => { f.text = nraDefaultTexts(); nra.dirty = true; nraRerender(); });
  box.appendChild(def);
  box.appendChild(el("div", "np-lang-h", t("nrp.adm.preview")));
  paintPrev();
  box.appendChild(prev);
  const save = el("button", "btn primary", nra.saving ? t("np.busy") : t("nrp.adm.save"));
  save.type = "button"; save.id = "nraSave";
  save.disabled = nra.saving;
  save.addEventListener("click", nraSave);
  box.appendChild(modGate(save, "notif.send"));
  c.appendChild(box);
  // Suivi du rappel
  if (!nra.missing) {
    const h = el("div", "nra-stats-h");
    h.appendChild(el("h4", "fc-h4", t("nrp.adm.stats")));
    const sel = npSelect([7, 30, 90].map(d => [String(d), t("nrp.adm.days", { n: d })]), String(nra.days), v => { nra.days = clampInt(v, 1, 366, 30); nraLoadStats(); });
    sel.id = "nraDays"; sel.dataset.modKeep = "1";
    h.appendChild(sel);
    c.appendChild(h);
    const nums = el("div", "np-nums nra-stats");
    nums.id = "nraStats";
    if (nra.statsLoading && !nra.stats) nums.appendChild(el("span", "muted", t("admin.loading")));
    else if (nra.statsErr) nums.appendChild(el("span", "q-err", nra.statsErr));
    else if (nra.stats) {
      const k = (key, cls) => { const d = el("div", "np-num" + (cls ? " " + cls : "")); d.dataset.k = key; d.append(el("b", null, dashFmt(nra.stats[key])), el("span", null, t("nrp.st." + key))); nums.appendChild(d); };
      k("shown"); k("devices"); k("accounts"); k("enabled", "ok"); k("later"); k("install"); k("denied"); k("help");
    }
    c.appendChild(nums);
  }
  root.appendChild(c);
}
