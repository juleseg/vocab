"use strict";

// === ADMINISTRATION → DEMANDES À CLAUDE → « MISE À JOUR AUTOMATIQUE » (ÉTAPE 80) ===
// Carte de réglage de la mise à jour automatique par Claude (js/auto-maj.js) : interrupteur général + nombre maximum de
// cartes par jour et par compte. Valeur dans app_settings (clé claude_auto = { on, max }) ; défaut : activée, 200 cartes.
// Lecture : claude_auto_get() (tout compte connecté) ; écriture : admin_claude_auto_set(on, max), ADMIN SEULEMENT, contrôlée
// par le serveur (claude/supabase-etape80.sql). Un modérateur voit la carte en lecture seule. Script absent : message
// « Lancez le script SQL de l'étape 80 » (et rien n'est automatique dans l'appli).
// Appelée par renderAdminReq (js/screens/admin-demandes.js) avec typeof.
// Rien n'est exécuté au chargement qui dépende de js/auto-maj.js (chargé après) : valeurs par défaut posées à la 1re ouverture.
const amjAd = { on: true, max: 0, saved: false, started: false, missing: false, err: "", busy: false, used: null };
function amjAdRerender() { if (currentScreen === "adminreq") renderAdminReq(); }
function amjAdIsMissing(e) {
  const code = String((e && e.code) || ""), msg = String((e && (e.message || e.msg)) || "");
  return ["PGRST202", "42883"].includes(code) || /could not find|does not exist|schema cache/i.test(msg);
}
function amjAdApply(r) {
  if (!r || typeof r !== "object") return;
  if (typeof r.on === "boolean") amjAd.on = r.on;
  const m = Number(r.max);
  if (Number.isInteger(m) && m >= AMJ_MAX_MIN && m <= AMJ_MAX_MAX) amjAd.max = m;
  amjAd.saved = !!r.saved;
  try { AutoMaj.setCfg(r); } catch (e) {}
}
async function amjAdLoad() {
  amjAd.started = true;
  try {
    const r = await aqRpc("claude_auto_get");
    amjAd.missing = false; amjAd.err = "";
    amjAdApply(r);
  } catch (e) { amjAd.missing = amjAdIsMissing(e); amjAd.err = amjAd.missing ? "" : aqErrText(e); }
  try { amjAd.used = await AutoMaj.dayCount(); } catch (e) { amjAd.used = null; }   // mon propre compte, pour repère
  amjAdRerender();
}
function amjAdCard(root) {
  if (!amjAd.started) { amjAd.on = AMJ_DEF.on; amjAd.max = AMJ_DEF.max; amjAdLoad(); }
  const c = el("div", "card aqc amj-ad");
  c.id = "amjCard";
  c.appendChild(el("h3", "aq-h", t("amj.ad.h")));
  c.appendChild(el("p", "hint", t("amj.ad.help")));
  if (amjAd.missing) { c.appendChild(el("div", "np-msg", t("amj.ad.missing"))); root.appendChild(c); return; }
  if (amjAd.err) c.appendChild(el("div", "q-err", amjAd.err));
  const lab = el("label", "gen-chk amj-ad-on");
  const cb = el("input"); cb.type = "checkbox"; cb.id = "amjOn"; cb.checked = amjAd.on;
  lab.append(cb, document.createTextNode(t("amj.ad.on")));
  c.appendChild(lab);
  const row = el("div", "rl-news-row");
  const num = el("input", "input rl-news-n");
  num.type = "number"; num.id = "amjMax"; num.min = String(AMJ_MAX_MIN); num.max = String(AMJ_MAX_MAX); num.step = "10"; num.inputMode = "numeric";
  num.value = String(amjAd.max); num.setAttribute("aria-label", t("amj.ad.max"));
  row.append(num, el("span", "amj-ad-unit", t("amj.ad.unit")));
  c.appendChild(row);
  const prev = el("p", "rl-news-prev");
  prev.id = "amjPrev";
  const save = el("button", "btn primary", t("aqc.save"));
  save.type = "button"; save.id = "amjSave";
  const cur = () => {
    const raw = String(num.value).trim(), v = Number(raw);
    return raw !== "" && Number.isInteger(v) && v >= AMJ_MAX_MIN && v <= AMJ_MAX_MAX ? { ok: true, on: cb.checked, max: v } : { ok: false };
  };
  const upd = () => {
    const r = cur();
    prev.textContent = !r.ok ? t("amj.ad.invalid", { a: AMJ_MAX_MIN, b: AMJ_MAX_MAX })
      : (r.on ? t("amj.ad.prevOn", { n: r.max }) : t("amj.ad.prevOff")) + (amjAd.saved ? "" : " " + t("amj.ad.default"));
    prev.classList.toggle("q-err", !r.ok);
    save.disabled = !r.ok || amjAd.busy;
  };
  cb.addEventListener("change", () => { amjAd.on = cb.checked; upd(); });
  num.addEventListener("input", () => { const v = Number(num.value); if (Number.isInteger(v)) amjAd.max = v; upd(); });
  save.addEventListener("click", async () => {
    const r = cur();
    if (!r.ok || amjAd.busy) return;
    amjAd.busy = true; upd();
    try {
      const res = await aqRpc("admin_claude_auto_set", { p_on: r.on, p_max: r.max });
      amjAd.err = ""; amjAdApply(res);
      toast(t("amj.ad.saved"));
      if (r.on) AutoMaj.kick("admin", AMJ_SOON_MS);
    } catch (e) {
      toast(amjAdIsMissing(e) ? t("amj.ad.missing") : String((e && e.hint) || "") === "ca_bad" ? t("amj.ad.invalid", { a: AMJ_MAX_MIN, b: AMJ_MAX_MAX }) : aqErrText(e));
    }
    amjAd.busy = false;
    amjAdRerender();
  });
  c.append(prev, save);
  if (amjAd.used != null) c.appendChild(el("p", "hint amj-ad-used", t("amj.ad.used", { n: amjAd.used })));
  upd();
  // Écriture réservée à l'admin (le serveur refuse les autres) : carte en lecture seule pour un modérateur.
  if (!auth.isAdmin) { c.querySelectorAll("input, button").forEach(x => { x.disabled = true; }); c.appendChild(el("p", "hint", t("amj.ad.adminOnly"))); }
  root.appendChild(c);
}
