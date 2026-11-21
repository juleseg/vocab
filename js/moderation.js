"use strict";

// === MODÉRATEURS ET RÔLES (ÉTAPE 66) ===
// Rôles : admin (table admins, tout) ; super modérateur (nomme et retire des modos, crée et modifie des catégories, jamais
// plus de pouvoirs que les siens) ; modérateurs rangés par catégories (nom + cases cochées), plusieurs catégories possibles
// (les pouvoirs s'additionnent) + cases « à lui seul ». Le modo travaille dans l'écran Administration FILTRÉ : il ne voit
// que les parties et les boutons de ses cases. Le SERVEUR contrôle chaque action (has_perm / perm_guard dans les fonctions
// security definer et les règles RLS, claude/supabase-etape66.sql) : cacher un bouton n'est qu'un confort.
// Cases : liste exacte dans MOD_GROUPS (= mod_perm_catalog() en SQL) ; une case « agir » donne aussi le « voir » de sa
// partie (et « voir les données » pour import / copie). Mes cases : RPC mod_me (au lancement, à chaque ouverture de
// l'Administration ou des Réglages, au plus une fois par 20 s ; toujours relues à l'ouverture de l'accueil de l'Administration
// et après un refus du serveur dans aqRpc), gardées sur l'appareil (vocabfr.mod:<compte>) pour le hors connexion.
// Rôle retiré : le serveur refuse tout de suite ; l'écran se ferme au refus suivant (ou au prochain rafraîchissement).
// Un bouton réservé : modGate(nœud, "case|case2") ; un bloc en lecture seule : modRO(bloc, "case") ; une action de fenêtre :
// { perm: "case" } (openModal, js/core.js). L'admin voit tout comme avant (Mod.can → toujours vrai).
const MOD_GROUPS = [
  ["dash", ["dash.see"]],
  ["accounts", ["accounts.see", "accounts.data", "accounts.block", "accounts.pin", "accounts.streak", "accounts.import", "accounts.copy", "accounts.delete"]],
  ["dict", ["dict.see", "dict.decide", "dict.edit", "dict.conflict", "dict.claude"]],
  ["claude", ["claude.see", "claude.act", "claude.cadence"]],
  ["notif", ["notif.see", "notif.send", "notif.release", "ann.see", "ann.act"]],
  ["msg", ["msg.see", "msg.send", "msg.cheers"]],
  ["ideas", ["ideas.see", "ideas.act", "ideas.reward"]],
  ["errors", ["errors.see", "errors.act"]],
  ["log", ["log.see"]],
  ["teams", ["teams.see", "teams.act"]],
  ["backups", ["backups.see", "backups.act"]],
  ["reports", ["reports.see", "reports.act"]]   // étape 84 : signalements de cartes (décochée par défaut)
];
// Cases sensibles : jamais cochées d'office (données personnelles, suppression de compte, sauvegardes et restauration).
const MOD_SENSITIVE = ["accounts.data", "accounts.import", "accounts.copy", "accounts.delete", "backups.see", "backups.act"];
// Écrans de l'Administration et case nécessaire pour les ouvrir ("admin" : au moins une case).
const MOD_SCREEN = {
  admin: "", adminacc: "accounts.see", adminfiche: "accounts.see", adminreq: "claude.see", adminlog: "log.see",
  adminann: "ann.see", admintpl: "accounts.copy", adminpush: "notif.see", admindict: "dict.see", adminerr: "errors.see",
  adminbk: "backups.see", adminidea: "ideas.see", adminmsg: "msg.see", adminteam: "teams.see", adminmod: "mods.manage",
  adminsig: "reports.see"   // étape 84
};
// Alertes de modération (send-push version 44) : sorte → case nécessaire.
const MOD_ALERTS = [["dict_conflicts", "dict.see"], ["dict_props", "dict.decide"], ["ideas", "ideas.see"],
  ["messages", "msg.see"], ["errors", "errors.see"], ["claude", "claude.see"]];

// « voir » de la partie d'une case (accounts.block → accounts.see) ; import / copie donnent aussi accounts.data.
function modImplied(p) {
  const out = [];
  const g = MOD_GROUPS.find(([, ps]) => ps.includes(p));
  if (g && !p.endsWith(".see")) { const see = p.split(".")[0] + ".see"; if (g[1].includes(see)) out.push(see); }
  if (p === "accounts.import" || p === "accounts.copy") out.push("accounts.data");
  return out;
}

const Mod = (() => {
  let me = null, loadedFor = null, at = 0, busy = null, missing = false;
  function key() { return CONFIG.LS_USER_PREFIX + "mod:" + (Storage.getUser() || ""); }
  function norm(r) {
    return { admin: !!r.admin, mod: !!r.mod, super: !!r.super, perms: arr(r.perms).map(String),
             categories: arr(r.categories).map(c => ({ id: String(c.id || ""), name: String(c.name || "") })),
             off: arr(r.alerts_off || r.off).map(String) };
  }
  // Valeur gardée sur l'appareil pour ce compte (hors connexion).
  function ensure() {
    const u = Storage.getUser() || "";
    if (loadedFor === u) return;
    loadedFor = u; me = null; at = 0;
    try { const c = JSON.parse(localStorage.getItem(key()) || "null"); if (c && Array.isArray(c.perms)) me = norm(c); } catch (e) {}
  }
  function save() { try { if (me) localStorage.setItem(key(), JSON.stringify(me)); } catch (e) {} }
  function usable() { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); }
  async function refresh(force) {
    ensure();
    if (!usable()) return me;
    if (!force && at && Date.now() - at < 20000) return me;
    if (busy) return busy;
    const who = Storage.getUser();
    busy = (async () => {
      try {
        const r = await aqRpc("mod_me");
        if (who === Storage.getUser()) {
          const before = JSON.stringify(me);
          me = norm(r || {}); missing = false; at = Date.now(); save();
          if (before !== JSON.stringify(me)) changed();
        }
      } catch (e) { if (alIsMissing(e)) missing = true; }
      finally { busy = null; }
      return me;
    })();
    return busy;
  }
  // Rôle ou cases changés : l'écran ouvert est refait (et quitté s'il n'est plus permis : showScreen).
  function changed() {
    try {
      if (!Storage.getUser() || typeof currentScreen === "undefined") return;
      if (currentScreen === "settings" || ADMIN_SCREENS.includes(currentScreen)) showScreen(currentScreen);
    } catch (e) {}
  }
  function admin() { return !!(typeof auth !== "undefined" && auth.isAdmin); }
  function can(p) { if (admin()) return true; ensure(); return !!(me && me.perms.includes(p)); }
  function allow(spec) { return String(spec || "").split("|").some(p => p && can(p)); }
  function any() { if (admin()) return true; if (auth.mode !== "supabase") return false; ensure(); return !!(me && me.perms.length); }
  function canScreen(s) {
    if (!(s in MOD_SCREEN)) return true;
    if (admin()) return true;
    return s === "admin" ? any() : allow(MOD_SCREEN[s]);
  }
  function info() { ensure(); return me; }
  function setOff(off) { ensure(); if (me) { me.off = arr(off).map(String); save(); } }
  function reset() { me = null; loadedFor = null; at = 0; busy = null; }
  // Bloc en lecture seule : champs et boutons d'action désactivés (liens, lignes à ouvrir, pages et onglets gardés).
  function readOnly(box) {
    if (!box || admin()) return;
    box.classList.add("mod-ro");
    box.querySelectorAll("input, select, textarea, button").forEach(n => {
      if (n.matches("[data-mod-keep], .link-btn, .item, .ad-pager button, .seg button, .al-row, .q-item")) return;
      n.disabled = true;
    });
  }
  return { refresh, can, allow, any, canScreen, info, setOff, reset, readOnly, isMissing: () => missing };
})();

// Nœud réservé à une case (ou à l'une des cases « a|b ») : caché sans elle (le serveur refuse de toute façon).
function modGate(node, spec) {
  if (node && !Mod.allow(spec)) { node.hidden = true; node.setAttribute("data-mod-off", spec); }
  return node;
}
// Bloc en lecture seule sans la case « agir ».
function modRO(box, spec) { if (box && !Mod.allow(spec)) Mod.readOnly(box); return box; }
// Texte d'une erreur de gestion des modérateurs (hint mod_*), sinon le texte habituel de l'administration.
function modErrText(e) {
  const h = String((e && e.hint) || "");
  if (/^mod_/.test(h) && h !== "mod_denied" && I18N.fr["mod.err." + h]) return t("mod.err." + h);
  if (h === "mod_denied" || String((e && e.code) || "") === "42501") return t("mod.denied");
  if (alIsMissing(e)) return t("mod.missing");
  return aqErrText(e);
}
function modPermLabel(p) { return t("mod.p." + p); }

// --- Grille des cases (catégorie, cases « à lui seul ») ---
// sel : Set des cases cochées (modifié sur place) ; mine : Set des cases que l'appelant peut donner (null = toutes).
function modPermGrid(sel, mine) {
  const wrap = el("div", "mod-grid");
  wrap.appendChild(el("p", "hint", t("mod.implied")));
  wrap.appendChild(el("p", "hint mod-sens-help", t("mod.sensHelp")));
  const boxes = {};
  const paint = () => Object.keys(boxes).forEach(p => { boxes[p].checked = sel.has(p); });
  const set = (p, on) => {
    if (on) { sel.add(p); modImplied(p).forEach(x => { if (!mine || mine.has(x)) sel.add(x); }); }
    else {
      sel.delete(p);
      // retirer un « voir » retire les « agir » qui en dépendent
      MOD_GROUPS.forEach(([, ps]) => ps.forEach(x => { if (modImplied(x).includes(p)) sel.delete(x); }));
    }
    paint();
  };
  const quick = el("div", "lv-links mod-quick");
  const all = el("button", "link-btn", t("mod.allSafe")); all.type = "button";
  all.addEventListener("click", () => { MOD_GROUPS.forEach(([, ps]) => ps.forEach(p => { if (!MOD_SENSITIVE.includes(p) && (!mine || mine.has(p))) sel.add(p); })); paint(); });
  const none = el("button", "link-btn", t("mod.noneAll")); none.type = "button";
  none.addEventListener("click", () => { sel.clear(); paint(); });
  quick.append(all, none);
  wrap.appendChild(quick);
  MOD_GROUPS.forEach(([g, ps]) => {
    const sec = el("div", "mod-grp");
    sec.appendChild(el("h4", null, t("mod.g." + g)));
    ps.forEach(p => {
      const lab = el("label", "mod-perm");
      const cb = el("input"); cb.type = "checkbox"; cb.value = p;
      const ok = !mine || mine.has(p);
      cb.disabled = !ok;
      if (!ok) lab.title = t("mod.notMine");
      cb.addEventListener("change", () => set(p, cb.checked));
      boxes[p] = cb;
      const txt = el("span", "mod-perm-t", modPermLabel(p));
      const tags = el("span", "mod-perm-k");
      tags.appendChild(el("span", "tag", t(p.endsWith(".see") || p === "accounts.data" ? "mod.see" : "mod.act")));
      if (MOD_SENSITIVE.includes(p)) tags.appendChild(el("span", "tag warn", "⚠ " + t("mod.sensitive")));
      lab.append(cb, txt, tags);
      if (!ok) lab.classList.add("mod-perm-off");
      sec.appendChild(lab);
    });
    wrap.appendChild(sec);
  });
  paint();
  return wrap;
}

// --- Accueil de l'Administration d'un modérateur : mon rôle et mes alertes ---
function modHomeCard() {
  const m = Mod.info() || { perms: [], categories: [], off: [] };
  const c = el("div", "card mod-me");
  c.appendChild(el("h3", null, t("mod.me.title")));
  const tags = el("div", "adm-tags");
  if (m.super) tags.appendChild(el("span", "tag", t("mod.me.super")));
  if (tags.childNodes.length) c.appendChild(tags);
  const cats = arr(m.categories).map(x => x.name).filter(Boolean);
  if (cats.length) c.appendChild(el("p", null, t("mod.me.cats", { list: cats.join(", ") })));
  const n = arr(m.perms).filter(p => p.includes(".")).length;
  c.appendChild(el("p", n ? "muted" : "q-err", n ? t("mod.me.count", { n }) : t("mod.me.none")));
  const kinds = MOD_ALERTS.filter(([, p]) => Mod.can(p));
  if (kinds.length) {
    c.appendChild(el("h4", "mod-al-h", t("mod.al.title")));
    c.appendChild(el("p", "hint", t("mod.al.help")));
    const off = new Set(arr(m.off));
    kinds.forEach(([k]) => {
      const lab = el("label", "mod-perm");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = !off.has(k);
      cb.addEventListener("change", async () => {
        if (cb.checked) off.delete(k); else off.add(k);
        try { const r = await aqRpc("mod_alerts_set", { p_off: [...off] }); Mod.setOff(arr(r && r.alerts_off)); toast(t("mod.al.saved")); }
        catch (e) { cb.checked = !cb.checked; toast(modErrText(e)); }
      });
      lab.append(cb, el("span", "mod-perm-t", t("mod.al." + k)));
      c.appendChild(lab);
    });
  }
  return c;
}
