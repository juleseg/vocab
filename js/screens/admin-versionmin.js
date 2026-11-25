"use strict";

// === ADMINISTRATION : VERSIONS — VERSION MINIMALE ACCEPTÉE (ÉTAPE 88) ===
// Administration → Notifications → onglet « Versions » (npReleaseTab, js/screens/admin-release.js) : carte « Version
// minimale acceptée ». Serveur : claude/supabase-etape88.sql ; côté utilisateur : js/version-minimale.js (VerMin).
// - Réglage actuel (0 = désactivé), qui l'a réglé, et ce que le serveur reçoit de CET appareil (en-tête x-app-version) :
//   s'il ne reçoit pas la version, rien ne peut être réglé au-dessus de 0 (le serveur le refuse aussi : vm_self).
// - Champ « Version minimale » de 0 à la version de cet appareil ; aperçu « N appareils actifs seraient bloqués »
//   (admin_min_version_preview : appareils vus ces 30 derniers jours, compte admin non compté).
// - « Enregistrer » → confirmation avec le nombre d'appareils et de comptes → admin_min_version_set (journal côté serveur :
//   admin_release / min_version). Le compte admin n'est jamais bloqué : il peut toujours revenir ici remettre 0.
// Droits : lecture notif.see ou notif.release (cases de l'onglet Versions) ; réglage notif.release. L'onglet est en lecture
// seule sans notif.release (modRO, js/screens/admin-notifications.js). Script SQL absent : message, aucune erreur.
const vmAd = { started: false, loading: false, missing: false, err: "", data: null, val: null, prev: null, prevFor: null, seq: 0, busy: false };

function vmAdRerender() { if (typeof rlRerender === "function") rlRerender(); }
function vmAdErrText(e) {
  const h = String((e && e.hint) || "");
  if (/^vm_/.test(h) && I18N.fr["vm.ad.err." + h]) return t("vm.ad.err." + h);
  if (alIsMissing(e)) return t("vm.ad.missing");
  return modErrText(e);
}
async function vmAdLoad() {
  vmAd.started = true; vmAd.loading = true; vmAd.err = "";
  try {
    vmAd.data = await aqRpc("admin_min_version_get");
    vmAd.missing = false;
    if (vmAd.val === null) vmAd.val = num(Number(vmAd.data && vmAd.data.min), 0);
  } catch (e) { vmAd.missing = alIsMissing(e); vmAd.err = vmAd.missing ? "" : vmAdErrText(e); }
  vmAd.loading = false;
  vmAdRerender();
}
// Prévision pour la valeur n (null si le calcul échoue). Garde la dernière réponse (vmAd.prev pour vmAd.prevFor).
async function vmAdPreview(n) {
  const id = ++vmAd.seq;
  try {
    const r = await aqRpc("admin_min_version_preview", { p_version: n });
    if (id !== vmAd.seq) return undefined;
    vmAd.prev = r || null; vmAd.prevFor = n;
  } catch (e) {
    if (id !== vmAd.seq) return undefined;
    vmAd.prev = null; vmAd.prevFor = n;
  }
  return vmAd.prev;
}
function vmAdPrevText(n, p) {
  if (n === 0) return t("vm.ad.prev0");
  if (!p) return t("vm.ad.prevUnknown");
  const b = num(Number(p.blocked), 0), a = num(Number(p.accounts), 0), all = num(Number(p.active), 0);
  return b ? t("vm.ad.prev", { n, b: dashFmt(b), a: dashFmt(a), t: dashFmt(all) }) : t("vm.ad.prevNone", { n, t: dashFmt(all) });
}
async function vmAdSave(n) {
  if (vmAd.busy) return;
  vmAd.busy = true; vmAdRerender();
  try {
    vmAd.data = await aqRpc("admin_min_version_set", { p_version: n });
    vmAd.val = num(Number(vmAd.data && vmAd.data.min), 0);
    vmAd.err = "";
    toast(n ? t("vm.ad.saved", { n }) : t("vm.ad.savedOff"));
  } catch (e) { toast(vmAdErrText(e)); }
  vmAd.busy = false;
  vmAdRerender();
}
function vmAdConfirm(n) {
  const body = el("div");
  if (n === 0) body.appendChild(el("p", null, t("vm.ad.confirmOff")));
  else {
    const p = vmAd.prevFor === n ? vmAd.prev : null;
    const b = p ? num(Number(p.blocked), 0) : -1;
    body.appendChild(el("p", "vm-ad-warn", b < 0 ? t("vm.ad.confirmUnknown")
      : b ? t("vm.ad.confirm", { b: dashFmt(b), a: dashFmt(num(Number(p.accounts), 0)) }) : t("vm.ad.confirmNone")));
    body.appendChild(el("p", "muted", t("vm.ad.confirmHint")));
  }
  openModal(t("vm.ad.confirmTitle", { n }), body, [
    { label: t("cancel") },
    { label: n ? t("vm.ad.go", { n }) : t("vm.ad.goOff"), kind: n ? "danger" : "primary", perm: "notif.release", onClick: () => { vmAdSave(n); } }
  ]);
}
function vmAdCard(root) {
  if (!vmAd.started) vmAdLoad();
  const c = el("div", "card vm-ad");
  c.id = "vmAdCard";
  c.appendChild(el("h3", "np-h3", t("vm.ad.h")));
  c.appendChild(el("p", "hint", t("vm.ad.help")));
  root.appendChild(c);
  if (vmAd.missing) { c.appendChild(el("div", "np-msg", t("vm.ad.missing"))); return; }
  if (vmAd.err) c.appendChild(el("div", "q-err", vmAd.err));
  if (!vmAd.data) { if (vmAd.loading) c.appendChild(el("div", "muted", t("admin.loading"))); return; }
  const d = vmAd.data, me = parseInt(APP_VERSION, 10) || 0;
  const cur = num(Number(d.min), 0), seen = num(Number(d.seen), 0);
  const kv = (k, v, cls) => { const r = el("div", "rl-kv" + (cls ? " " + cls : "")); r.append(el("span", null, k), el("b", null, v)); c.appendChild(r); };
  let who = "";
  if (d.by && d.updated_at) who = " · " + t("vm.ad.by", { who: String(d.by), date: rlDate(d.updated_at) });
  kv(t("vm.ad.cur"), (cur ? t("vm.ad.on", { n: cur }) : t("vm.ad.off")) + who, cur ? "vm-ad-on" : "");
  kv(t("vm.ad.seen"), seen ? t("vm.ad.seenOk", { v: seen }) : t("vm.ad.seenNo"), seen ? "" : "vm-ad-bad");
  if (d.hook === false || d.policy === false) c.appendChild(el("div", "np-msg vm-ad-bad", t("vm.ad.notPlugged")));

  const max = seen > 0 ? Math.min(seen, me || seen) : 0;
  const row = el("div", "vm-ad-row");
  const inp = el("input", "input vm-ad-n");
  inp.type = "number"; inp.id = "vmAdMin"; inp.min = "0"; inp.max = String(max); inp.step = "1"; inp.inputMode = "numeric";
  inp.value = String(vmAd.val === null ? cur : vmAd.val);
  inp.setAttribute("aria-label", t("vm.ad.label"));
  const lab = el("label", "vm-ad-lab", t("vm.ad.label"));
  lab.htmlFor = "vmAdMin";
  const save = el("button", "btn primary", t("vm.ad.save"));
  save.type = "button"; save.id = "vmAdSave";
  row.append(inp, save);
  c.append(lab, row);
  c.appendChild(el("p", "hint", max ? t("vm.ad.max", { v: max }) : t("vm.ad.maxNone")));
  const prev = el("p", "vm-ad-prev");
  prev.id = "vmAdPrev"; prev.setAttribute("role", "status");
  c.appendChild(prev);
  const read = () => {
    const raw = String(inp.value).trim(), v = Number(raw);
    return raw !== "" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
  };
  let tm = null;
  const upd = () => {
    const v = read();
    prev.classList.toggle("q-err", v === null);
    save.disabled = v === null || v === cur || vmAd.busy;
    if (v === null) { prev.textContent = t("vm.ad.invalid", { v: max }); return; }
    vmAd.val = v;
    if (v === 0 || vmAd.prevFor === v) { prev.textContent = vmAdPrevText(v, vmAd.prevFor === v ? vmAd.prev : null); return; }
    prev.textContent = t("vm.ad.prevWait");
    clearTimeout(tm);
    tm = setTimeout(async () => {
      const r = await vmAdPreview(v);
      if (r !== undefined && read() === v && prev.isConnected) prev.textContent = vmAdPrevText(v, r);
    }, 350);
  };
  inp.addEventListener("input", upd);
  save.addEventListener("click", async () => {
    const v = read();
    if (v === null || v === cur || vmAd.busy) return;
    if (v > 0 && vmAd.prevFor !== v) { clearTimeout(tm); await vmAdPreview(v); }
    vmAdConfirm(v);
  });
  upd();
}
