"use strict";

// ====================================================================================================
// js/garde-fou.js — GARDE-FOU DES DONNÉES DU COMPTE (étape 77)
// Chargé juste après js/storage-supabase.js (avant js/cards.js). N'exécute rien au chargement (déclarations seulement).
// 1) Première connexion d'un appareil (rien en local pour ce compte) : le serveur est lu AVANT tout. Pendant ce temps,
//    écran « Chargement de tes listes… » (rien n'est modifiable) et AUCUNE écriture (Storage.hold). Lecture ratée :
//    « Réessayer », jamais de liste « Démo ». La « Démo » n'existe que si le compte est vraiment vide en ligne (aucune ligne).
// 2) Avant chaque écriture en ligne (Storage.doFlush) : refus si l'envoi ferait disparaître une liste présente en ligne,
//    une langue, ou ferait fortement baisser le nombre de cartes — sauf ce que CET appareil a supprimé lui-même
//    (comparaison avec la « base » : dernier état connu à la fois de l'appareil et du serveur, clé locale vocabfr.guard:<compte>).
//    Refus : rien n'est envoyé, copie de sécurité de l'appareil, fenêtre « Les données de ton compte semblent incomplètes.
//    Rien n'a été envoyé. » avec « Utiliser la version en ligne » / « Garder cet appareil » (avec confirmation).
// 3) Copies de sécurité locales (IndexedDB « vocab-copies », GF_COPIES_MAX par compte) avant toute conversion de format,
//    tout remplacement du compte et tout import ; visibles dans Réglages → Compte et données → « Copies de sécurité ».
// Les listes communes (étape 30) ne comptent pas : leurs cartes sont dans shared_cards, jamais dans user_data.
// Étape 78 : la fusion (js/fusion.js) passe AVANT le garde-fou : quand le serveur a changé, l'appareil fusionne d'abord, puis
// l'envoi est vérifié ici comme avant. Les versions perdantes d'une fusion sont gardées ici (type « fusion », GF_FUSION_MAX).
// ====================================================================================================

const GF_DROP_MIN = 30;        // baisse de cartes refusée : au moins 30 cartes…
const GF_DROP_RATIO = 0.5;     // … ET plus de la moitié des cartes des listes connues
const GF_COPIES_MAX = 5;       // copies de sécurité gardées par compte sur l'appareil
const GF_FUSION_MAX = 20;      // étape 78 : fusions gardées par compte (versions perdantes des collisions), comptées à part
const GF_LOT_MAX = 3;          // étape 89 : copies « avant une modification par lots » gardées par compte, comptées à part
const GF_DB = "vocab-copies", GF_STORE = "copies";

const Guard = (() => {
  let waitId = null, waitTarget = null, waitErr = false;   // compte en attente de sa première lecture en ligne
  let readyFns = [];
  let allowWhy = null;   // écriture permise une fois (choix explicite : import, « Garder cet appareil ») ; effacée après l'envoi
  let refusing = false;  // fenêtre du garde-fou ouverte : Storage n'écrit rien

  // --- Résumé d'un état (listes personnelles, cartes par liste, langues) ---
  function langsOf(data) {
    const s = new Set(), ok = x => typeof x === "string" && x && (typeof isLang !== "function" || isLang(x));
    const st = data && data.settings;
    arr(st && st.learning).forEach(x => { if (x && ok(x.lang)) s.add(x.lang); });
    arr(data && data.folders).forEach(f => { if (f && ok(f.target)) s.add(f.target); });
    arr(data && data.lists).forEach(l => {
      if (!l || (typeof isSharedList === "function" && isSharedList(l))) return;
      if (ok(l.target)) s.add(l.target);
      arr(l.targets).forEach(x => { if (ok(x)) s.add(x); });
    });
    return Array.from(s).sort();
  }
  function summary(data) {
    const lists = {};
    arr(data && data.lists).forEach(l => {
      if (l && l.id && !(typeof isSharedList === "function" && isSharedList(l))) lists[l.id] = { n: 0, name: String(l.name || "") };
    });
    let cards = 0;
    arr(data && data.cards).forEach(c => { if (c && lists[c.listId]) { lists[c.listId].n++; cards++; } });
    return { lists, cards, langs: langsOf(data) };
  }

  // --- Base : dernier état connu à la fois de cet appareil et du serveur ---
  function baseKey() { const u = Storage.getUser(); return u ? CONFIG.LS_USER_PREFIX + "guard:" + u : null; }
  function base() {
    const k = baseKey();
    if (!k) return null;
    try { const b = JSON.parse(localStorage.getItem(k) || "null"); return b && b.lists && typeof b.lists === "object" ? b : null; } catch (e) { return null; }
  }
  // data : état complet ; at : updatedAt de l'index en ligne qui correspond (par défaut data.updatedAt).
  function setBase(data, at) {
    const k = baseKey();
    if (!k || !data) return;
    const s = summary(data), lists = {};
    Object.keys(s.lists).forEach(id => { lists[id] = s.lists[id].n; });
    try { localStorage.setItem(k, JSON.stringify({ at: num(at, num(data.updatedAt, 0)), lists, langs: s.langs, del: 0 })); } catch (e) {}
  }
  // Cartes supprimées volontairement sur cet appareil depuis la base (suppression, doublons retirés, « Remplacer » d'un import).
  // Étape 89 : n négatif = suppression annulée (bouton « Annuler » d'une modification par lots) ; jamais sous zéro.
  function noteDeleted(n) {
    const k = baseKey(), b = base();
    n = num(Number(n), 0);
    if (!k || !b || !n) return;
    b.del = Math.max(0, num(b.del, 0) + n);
    try { localStorage.setItem(k, JSON.stringify(b)); } catch (e) {}
  }
  // Renvoie null (envoi permis) ou { lists: [{ id, name }], langs: [codes], drop: { was, now } | null }.
  // rem : résumé des listes et langues en ligne (null = le serveur n'a pas changé depuis la base, ou n'a rien).
  function check(data, rem) {
    if (allowWhy) return null;
    const loc = summary(data), b = base() || { lists: {}, langs: [], del: 0 };
    const out = { lists: [], langs: [], drop: null };
    if (rem) {
      Object.keys(rem.lists).forEach(id => { if (!loc.lists[id] && !(id in b.lists)) out.lists.push({ id, name: rem.lists[id].name }); });
      rem.langs.forEach(L => { if (!loc.langs.includes(L) && !arr(b.langs).includes(L)) out.langs.push(L); });
    }
    // Cartes : celles des listes de la base encore présentes ici, comparées à toutes les cartes de l'appareil
    // (une carte déplacée vers une nouvelle liste compte toujours), moins les suppressions faites ici.
    let was = 0;
    Object.keys(b.lists).forEach(id => { if (loc.lists[id]) was += num(b.lists[id], 0); });
    const now = loc.cards + num(b.del, 0);
    if (was - now >= GF_DROP_MIN && now < was * (1 - GF_DROP_RATIO)) out.drop = { was, now: loc.cards };
    return out.lists.length || out.langs.length || out.drop ? out : null;
  }
  function allow(why) { allowWhy = why || "user"; }
  function allowed() { return !!allowWhy; }
  // Après un envoi réussi : la base devient ce qui vient d'être écrit ; l'autorisation unique est consommée.
  function written(sum, at) {
    const k = baseKey();
    allowWhy = null;
    if (!k || !sum) return;
    const lists = {};
    Object.keys(sum.lists).forEach(id => { lists[id] = sum.lists[id].n; });
    try { localStorage.setItem(k, JSON.stringify({ at: num(at, 0), lists, langs: sum.langs, del: 0 })); } catch (e) {}
  }
  function isOpen() { return refusing; }

  // --- Copies de sécurité locales (IndexedDB) ---
  function db() {
    return new Promise((res, rej) => {
      try {
        if (typeof indexedDB === "undefined" || !indexedDB) { rej(new Error("no indexedDB")); return; }
        const rq = indexedDB.open(GF_DB, 1);
        rq.onupgradeneeded = () => {
          const d = rq.result;
          if (!d.objectStoreNames.contains(GF_STORE)) d.createObjectStore(GF_STORE, { keyPath: "id", autoIncrement: true }).createIndex("acc", "acc");
        };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error || new Error("indexedDB"));
        rq.onblocked = () => rej(new Error("blocked"));
      } catch (e) { rej(e); }
    });
  }
  function tx(d, mode, fn) {
    return new Promise((res, rej) => {
      const t0 = d.transaction(GF_STORE, mode), st = t0.objectStore(GF_STORE);
      let out;
      t0.oncomplete = () => res(out);
      t0.onerror = () => rej(t0.error || new Error("tx"));
      t0.onabort = () => rej(t0.error || new Error("abort"));
      out = fn(st);
    });
  }
  function reqP(rq) { return new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
  async function listRaw(acc) {
    const d = await db();
    try {
      let rows = [];
      await tx(d, "readonly", st => { const rq = st.index("acc").getAll(acc); rq.onsuccess = () => { rows = arr(rq.result); }; });
      return rows.sort((a, b) => b.at - a.at);
    } finally { d.close(); }
  }
  // kind : "refus" | "remplacement" | "enligne" | "conversion" | "import" | "fusion" (étape 78 : versions perdantes d'une
  // fusion, js/fusion.js). Renvoie l'identifiant de la copie gardée (nombre > 0), sinon false.
  // note : précision affichée (ex. compte importé par l'administration). cnt (fusion) : { lists, cards } à afficher.
  async function backupNow(kind, data, acc, note, cnt) {
    const who = acc || Storage.getUser();
    if (!who || !data || typeof data !== "object") return false;
    // Étape 89 : trois familles comptées à part (une copie d'une famille n'en chasse jamais une d'une autre).
    const fam = k => k === "fusion" ? "fusion" : k === "lot" ? "lot" : "copie";
    const json = JSON.stringify(data), fu = fam(kind);
    const rec = { acc: who, kind: String(kind || "copie"), at: Date.now(), v: num(Number(data.version), 0),
      lists: cnt ? num(cnt.lists, 0) : arr(data.lists).length, cards: cnt ? num(cnt.cards, 0) : arr(data.cards).length, note: String(note || "").slice(0, 40), json };
    const d = await db();
    try {
      let id = 0;
      await tx(d, "readwrite", st => { const rq = st.add(rec); rq.onsuccess = () => { id = rq.result; }; });
      const rows = [];
      await tx(d, "readonly", st => { const rq = st.index("acc").getAll(who); rq.onsuccess = () => { rows.push(...arr(rq.result)); }; });
      // Étape 78 : les fusions ont leur propre limite (elles ne chassent jamais une copie de sécurité, et inversement).
      const old = rows.filter(r => fam(r.kind) === fu).sort((a, b) => b.at - a.at).slice(fu === "fusion" ? GF_FUSION_MAX : fu === "lot" ? GF_LOT_MAX : GF_COPIES_MAX);
      if (old.length) await tx(d, "readwrite", st => { old.forEach(r => st.delete(r.id)); });
      return id || true;
    } finally { d.close(); }
  }
  // Étape 78 : copies d'un type (les plus récentes d'abord) ; réécriture du contenu d'une copie (élément repris d'une fusion).
  async function copies(kind) { return (await listRaw(Storage.getUser())).filter(r => r.kind === kind); }
  async function copyPut(id, data) {
    const d = await db();
    try {
      await tx(d, "readwrite", st => { const rq = st.get(id); rq.onsuccess = () => { const r = rq.result; if (r) { r.json = JSON.stringify(data); st.put(r); } }; });
    } finally { d.close(); }
  }
  async function backup(kind, data, acc, note, cnt) {
    try { return (await withTimeout(backupNow(kind, data, acc, note, cnt), 8000)) || false; }
    catch (e) { try { if (typeof ErrLog !== "undefined") ErrLog.sync("copie : " + String((e && e.message) || e).slice(0, 80), e); } catch (x) {} return false; }
  }
  // Données avec du contenu (au moins une liste personnelle ou une carte) : seules celles-là valent une copie.
  function hasContent(data) { return !!(data && (arr(data.cards).length || arr(data.lists).some(l => l && !(typeof isSharedList === "function" && isSharedList(l))))); }

  // --- Première connexion de l'appareil : attente de la lecture en ligne ---
  function wait(id, target) { waitId = id; waitTarget = target || null; waitErr = false; paintWait(); }
  function waiting(id) { return !!waitId && waitId === id; }
  function target() { return waitTarget; }
  function waitFailed() { if (!waitId) return; waitErr = true; paintWait(); }
  function done(id) {
    if (!waitId || waitId !== id) return;
    waitId = null; waitTarget = null; waitErr = false;
    paintWait();
    const fns = readyFns; readyFns = [];
    fns.forEach(f => { try { f(true); } catch (e) {} });
  }
  // Promesse : true quand le compte est prêt (lu en ligne, ou données locales), false si le compte a changé entre-temps.
  function ready(id) {
    if (!waiting(id)) return Promise.resolve(Storage.getUser() === id);
    return new Promise(res => { readyFns.push(ok => res(ok && Storage.getUser() === id)); });
  }
  // Changement de compte (Storage.setUser) : tout est oublié, les attentes répondent false.
  function userChanged() {
    const fns = readyFns; readyFns = [];
    waitId = null; waitTarget = null; waitErr = false; allowWhy = null; refusing = false;
    try { if (typeof Fusion !== "undefined") Fusion.userChanged(); } catch (e) {}   // étape 78
    paintWait();
    fns.forEach(f => { try { f(false); } catch (e) {} });
  }
  function paintWait() {
    let box = document.getElementById("gfWait");
    const show = !!waitId && !(Storage.isPaused && Storage.isPaused());   // « Mise à jour nécessaire » : écran de js/release.js
    if (!show) { if (box) box.remove(); return; }
    if (!box) { box = el("div", "gf-wait"); box.id = "gfWait"; box.setAttribute("role", "status"); document.body.appendChild(box); }
    box.textContent = "";
    const c = el("div", "gf-wait-box");
    if (!waitErr) {
      c.appendChild(el("div", "gf-spin"));
      c.appendChild(el("p", "gf-wait-t", t("gf.loading")));
      c.appendChild(el("p", "muted", t("gf.loadingHint")));
    } else {
      c.appendChild(el("p", "gf-wait-t", t("gf.waitErr")));
      c.appendChild(el("p", "muted", t("gf.waitErrHint")));
      const btns = el("div", "btns");
      const r = el("button", "btn primary", t("gf.retry"));
      r.addEventListener("click", () => { waitErr = false; paintWait(); Storage.retryInit(); });
      const o = el("button", "btn", t("account.logout"));
      o.addEventListener("click", () => { logout(); });
      btns.append(r, o);
      c.appendChild(btns);
    }
    box.appendChild(c);
  }

  // --- Refus d'un envoi : fenêtre à deux choix ---
  function names(a) { return a.slice(0, 6).map(x => "« " + (x.name || "?") + " »").join(", ") + (a.length > 6 ? "…" : ""); }
  function problemLines(pb) {
    const box = el("div", "gf-pb");
    if (pb.lists.length) box.appendChild(el("p", null, t("gf.onlyOnline", { names: names(pb.lists) })));
    if (pb.langs.length) box.appendChild(el("p", null, t("gf.langsOnline", { names: pb.langs.map(L => typeof langName === "function" ? langName(L) : L).join(", ") })));
    if (pb.drop) box.appendChild(el("p", null, t("gf.drop", { was: pb.drop.was, now: pb.drop.now })));
    return box;
  }
  function refuse(pb, data) {
    if (refusing) return;
    refusing = true;
    const who = Storage.getUser();
    try { Activity.log("guard_refused", { lists: pb.lists.length, langs: pb.langs.join(","), was: pb.drop ? pb.drop.was : null, now: pb.drop ? pb.drop.now : null }); } catch (e) {}
    const copy = hasContent(data) ? backup("refus", data) : Promise.resolve(false);   // texte figé tout de suite (JSON.stringify)
    copy.then(kept => {
      if (Storage.getUser() !== who) return;
      const wrap = el("div");
      wrap.appendChild(el("p", "gf-main", t("gf.text")));
      wrap.appendChild(problemLines(pb));
      if (kept) wrap.appendChild(el("p", "muted", t("gf.copyKept")));
      openModal(t("gf.title"), wrap, [
        { label: t("gf.useOnline"), kind: "primary", onClick: () => { useOnline(who); } },
        { label: t("gf.keepDevice"), onClick: () => { setTimeout(() => confirmKeep(pb, who), 0); } }
      ], { locked: true });
    });
  }
  // La fenêtre reste « ouverte » pour Storage (aucun envoi de l'ancien état) jusqu'à la fin de la relecture.
  function useOnline(who) {
    if (Storage.getUser() !== who) { refusing = false; Storage.guardReset(); return; }
    Promise.resolve(syncWithRemote(who, { guard: "remote" }, false)).catch(() => {}).finally(() => { refusing = false; Storage.guardReset(); });
  }
  function confirmKeep(pb, who) {
    if (Storage.getUser() !== who) return;
    const loc = summary(state);
    const wrap = el("div");
    wrap.appendChild(el("p", null, t("gf.confirmText", { lists: Object.keys(loc.lists).length, cards: loc.cards })));
    if (pb.lists.length) wrap.appendChild(el("p", "gf-warn", t("gf.confirmLost", { names: names(pb.lists) })));
    wrap.appendChild(el("p", "muted", t("gf.confirmCopy")));
    openModal(t("gf.confirmTitle"), wrap, [
      { label: t("cancel"), onClick: () => { refusing = false; refuse(pb, state); } },
      { label: t("gf.confirmGo"), kind: "danger", onClick: () => { keepDevice(who); } }
    ], { locked: true });
  }
  // « Garder cet appareil » confirmé : copie de la version en ligne, puis envoi complet (les morceaux en ligne en trop sont retirés).
  // En cas d'échec : rien n'est envoyé ; le garde-fou se reposera au prochain envoi.
  async function keepDevice(who) {
    const stop = msg => { refusing = false; Storage.guardReset(); if (msg) toast(t(msg)); };
    const peek = await Storage.peekRemote();
    if (Storage.getUser() !== who) return;
    if (!peek) { stop("gf.readErr"); return; }
    if (peek.data && hasContent(peek.data) && !(await backup("enligne", peek.data, who))) { stop("gf.copyErr"); return; }
    if (Storage.getUser() !== who) return;
    // Étape 78 : ce que la version en ligne a et que cet appareil n'a pas reçoit une pierre tombale (les autres appareils suivent).
    if (typeof Fusion !== "undefined" && peek.data) Fusion.replaced(peek.data, state, false);
    Storage.forceFullPush(peek.keys, peek.updatedAt);
    allow("keep");
    stop(null);
    state.updatedAt = Math.max(Date.now(), num(peek.updatedAt, 0) + 1);   // passe devant la version en ligne (pas commit : il remettrait « maintenant »)
    Activity.log("guard_keep", { local: arr(state.cards).length, remote: peek.data ? arr(peek.data.cards).length : 0 });
    Storage.save(state);
    render();
  }

  // --- Réglages → Compte et données → « Copies de sécurité » ---
  async function openCopies() {
    const who = Storage.getUser();
    if (!who) return;
    let rows = null;
    try { rows = await withTimeout(listRaw(who), 8000); } catch (e) { rows = null; }
    const wrap = el("div", "gf-copies");
    wrap.appendChild(el("p", "muted", t("gf.copiesHint", { n: GF_COPIES_MAX })));
    let close = null;
    rows = rows ? rows.filter(r => r.kind !== "fusion") : rows;   // étape 78 : les fusions ont leur écran (Fusion.openList)
    if (!rows || !rows.length) wrap.appendChild(el("p", null, t("gf.copiesNone")));
    arr(rows).forEach(r => {
      const line = el("div", "gf-copy");
      const txt = el("div", "gf-copy-t");
      let when = "";
      try { when = new Date(r.at).toLocaleString(state.settings.uiLang); } catch (e) { when = String(r.at); }
      const k = t("gf.k." + r.kind) === "gf.k." + r.kind ? r.kind : t("gf.k." + r.kind);
      txt.appendChild(el("strong", null, k + (r.note ? " · " + r.note : "")));
      txt.appendChild(el("div", "muted", when + " · " + t("gf.copyLine", { lists: r.lists, cards: r.cards })));
      const btns = el("div", "btns two");
      const dl = el("button", "btn", t("gf.download"));
      dl.addEventListener("click", () => {
        let d = null; try { d = JSON.parse(r.json); } catch (e) {}
        if (d) exportData(d, "copie-" + r.kind + "-" + who + "-" + todayStr(new Date(r.at)) + ".json");
      });
      const rs = el("button", "btn", t("gf.restore"));
      rs.addEventListener("click", () => { if (close) close(); setTimeout(() => { importTarget = null; importFromText(r.json); }, 0); });
      if (r.note) btns.append(dl);   // copie d'un AUTRE compte (import de l'administration) : jamais restaurée dans celui-ci
      else btns.append(dl, rs);
      line.append(txt, btns);
      wrap.appendChild(line);
    });
    close = openModal(t("gf.copiesTitle"), wrap, [{ label: t("close") }]);
  }

  return {
    summary, base, setBase, check, allow, allowed, written, noteDeleted, isOpen, refuse,
    backup, hasContent, wait, waiting, target, waitFailed, done, ready, userChanged, paintWait, openCopies,
    copies, copyPut   // étape 78
  };
})();
