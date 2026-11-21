"use strict";

// === INDICATEUR DE SYNCHRONISATION TOUJOURS VISIBLE, DÉTAIL, HORS LIGNE GRISÉ (ÉTAPE 79) ===
// Remplace l'indicateur discret de l'étape 33b (texte gris à droite du titre, détail seulement en cas d'erreur).
// - Le voyant (#syncStatus, dans l'en-tête fixé en haut de l'écran) a toujours une couleur ET un mot :
//     vert   « Synchronisé »      : l'appareil et le compte en ligne sont identiques ;
//     orange « Synchro… » / « En attente » / « En pause » : envoi en cours, modifications pas encore envoyées
//            (ou compte en ligne pas encore relu), mise à jour nécessaire (étape 48) ;
//     rouge  « Hors connexion » / « Erreur » ;
//     gris   « Cet appareil » : compte sans synchronisation en ligne (stockage du navigateur seul).
//   Caché quand personne n'est connecté (sauf hors connexion).
// - Un toucher ouvre le détail : état en une phrase, dernière synchro réussie, éléments en attente, message d'erreur
//   exact, « Réessayer », accès aux fusions récentes (étape 78), aux copies de sécurité (étape 77) et au stockage hors ligne.
// - Hors connexion (compte avec des données en ligne seulement) : ce qui ne peut pas marcher est grisé (SYN_NET_ONLY, ou
//   tout élément avec l'attribut data-net) ; le toucher affiche une phrase courte au lieu d'échouer. Les écrans qui ont
//   besoin d'Internet (SYN_NET_SCREENS et l'Administration) restent ouvrables, avec un bandeau en haut.
// L'état vient de Storage.getMode() et Storage.syncInfo() (js/storage-sync.js) : rien n'est modifié dans la synchro.
// Aucune donnée, aucun réglage. js/app.js (renderSyncStatus, initSyncStatus) appelle SyncUi.paint() et SyncUi.open().
const SYN_NET_ONLY = [
  "#btnChangePin",                                  // changement de code PIN : serveur
  ".lm-sheet [data-from='#lvShare']",               // partager une liste
  ".lm-sheet [data-from='#lvAsk']",                 // demander à Claude (file d'attente)
  ".lm-sheet [data-from='#lvAskAll']",
  ".ci-ed-btn:not(.danger)",                        // ajouter ou changer l'image d'une carte
  "[data-net]"                                      // tout bouton marqué par son écran (ex. « Télécharger » du Stockage)
];
const SYN_NET_SCREENS = ["friends", "messages", "team", "requests", "ideas"];

const SyncUi = (() => {
  const COLOR = { ok: "ok", syncing: "warn", waiting: "warn", paused: "warn", offline: "bad", error: "bad", local: "none", none: "none" };
  let det = null;            // fenêtre de détail ouverte : { body }
  let marked = false, raf = 0;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function info() { return safe(() => Storage.syncInfo(), { remote: false, unsent: false, lastOkAt: 0, remoteOk: false }); }
  function sharedOut() { return safe(() => (Shared.on() ? Shared.pendingCount() : 0), 0); }
  function dictOut() {
    return safe(() => {
      const u = Storage.getUser();
      return u && Dict.usable() ? arr(JSON.parse(localStorage.getItem(CONFIG.LS_USER_PREFIX + "dict:out:" + u) || "[]")).length : 0;
    }, 0);
  }
  // État en un mot : none | local | ok | syncing | waiting | paused | offline | error
  function kind() {
    const m = Storage.getMode(), off = navigator.onLine === false;
    if (!Storage.getUser()) return off ? "offline" : "none";
    const i = info();
    if (!i.remote || m === "local") return "local";
    if (off || m === "offline") return "offline";
    if (m === "error") return "error";
    if (m === "paused") return "paused";
    if (m === "syncing") return "syncing";
    if (i.unsent || !i.remoteOk || sharedOut() > 0) return "waiting";
    return "ok";
  }
  function label() { return t("syn." + kind()); }

  // --- Voyant ---
  function paint() {
    const b = $("#syncStatus");
    if (!b) return;
    const k = kind();
    b.dataset.syn = COLOR[k];
    b.dataset.kind = k;
    b.hidden = k === "none";
    const lab = $("#syncLabel");
    if (lab) lab.textContent = t("syn." + k);
    const a = t("syn.aria", { s: t("syn." + k) });
    b.setAttribute("aria-label", a);
    b.title = a;
    safe(() => Offline.tick());
    mark();
    if (det) { if (det.body.isConnected) fill(det.body); else det = null; }
  }

  // --- Détail ---
  function when(ts) {
    if (!ts) return t("syn.t.never");
    const d = Math.max(0, Date.now() - ts);
    let abs = "";
    try { abs = new Date(ts).toLocaleString(state.settings.uiLang, d < 86400000 ? { hour: "2-digit", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" }); }
    catch (e) { abs = new Date(ts).toLocaleString(); }
    const rel = d < 60000 ? t("syn.t.now") : d < 3600000 ? t("syn.t.min", { n: Math.floor(d / 60000) }) : d < 86400000 ? t("syn.t.h", { n: Math.floor(d / 3600000) }) : "";
    return rel ? rel + " (" + abs + ")" : abs;
  }
  // Ce qui attend d'être envoyé, en phrases courtes.
  function pending() {
    const out = [], i = info();
    if (i.remote && (i.unsent || !i.remoteOk)) {
      const st = safe(() => Fusion.state(), null);
      const c = st ? Object.keys(st.c || {}).length : 0, l = st ? Object.keys(st.l || {}).length : 0;
      const bits = [];
      if (c) bits.push(t("syn.pend.cards", { n: c }));
      if (l) bits.push(t("syn.pend.lists", { n: l }));
      out.push(t(i.remoteOk ? "syn.pend.data" : "syn.pend.read") + (bits.length ? " (" + bits.join(", ") + ")" : ""));
    }
    const sh = sharedOut();
    if (sh) out.push(t("syn.pend.shared", { n: sh }));
    const dq = dictOut();
    if (dq) out.push(t("syn.pend.dict", { n: dq }));
    return out;
  }
  function closeDet() {
    const bg = det && det.body.closest(".modal-bg");
    det = null;
    if (bg) bg.remove();
  }
  function link(text, fn, id) {
    const b = el("button", "item syn-link");
    b.type = "button";
    if (id) b.id = id;
    const m = el("div", "main");
    m.appendChild(el("div", "t1", text));
    b.append(m, el("span", "chev", "›"));
    b.addEventListener("click", () => { closeDet(); setTimeout(() => safe(fn), 0); });
    return b;
  }
  function fill(body) {
    body.textContent = "";
    const k = kind(), i = info();
    const head = el("div", "syn-head");
    head.dataset.syn = COLOR[k];
    const dot = el("span", "syn-big");
    dot.setAttribute("aria-hidden", "true");
    const ht = el("div", "syn-head-tx");
    ht.append(el("div", "syn-head-t", t("syn." + k)), el("div", "syn-head-d", t("syn.d." + k)));
    head.append(dot, ht);
    body.appendChild(head);
    if (i.remote) {
      const r = el("div", "syn-row");
      r.append(el("span", "syn-k", t("syn.last")), el("span", "syn-v", when(i.lastOkAt)));
      body.appendChild(r);
      const pend = pending();
      const box = el("div", "syn-box");
      box.appendChild(el("div", "syn-h", t("syn.pend.title")));
      if (!pend.length) box.appendChild(el("p", "muted syn-none", t("syn.pend.none")));
      else { const ul = el("ul", "syn-list"); pend.forEach(s => ul.appendChild(el("li", null, s))); box.appendChild(ul); }
      body.appendChild(box);
      const err = safe(() => Storage.getLastError(), "");
      if ((k === "error" || k === "offline") && err) {
        const eb = el("div", "syn-box");
        eb.appendChild(el("div", "syn-h", t("syn.err")));
        const em = el("p", "syn-err", err);
        em.id = "synErr";
        eb.appendChild(em);
        body.appendChild(eb);
      }
      if (k === "error" || k === "offline" || k === "waiting") {
        const rb = el("button", "btn syn-retry", t("syn.retry"));
        rb.type = "button";
        rb.id = "synRetry";
        rb.setAttribute("data-net", "1");
        rb.addEventListener("click", () => {
          toast(t("syn.retrying"));
          safe(() => Storage.retry());
          safe(() => { if (sharedOut()) Shared.sync(); });
        });
        body.appendChild(rb);
      }
    }
    const j = safe(() => Offline.job(), null);
    if (j) {
      const r = el("div", "syn-row");
      r.append(el("span", "syn-k", t("syn.dl")), el("span", "syn-v", j.total ? j.done + " / " + j.total : "…"));
      body.appendChild(r);
    }
    const links = el("div", "syn-links");
    if (i.remote && typeof Fusion !== "undefined") links.appendChild(link(t("fu.listBtn"), () => Fusion.openList(), "synFusions"));
    if (i.remote && typeof Guard !== "undefined") links.appendChild(link(t("gf.copies"), () => Guard.openCopies(), "synCopies"));
    if (typeof Ecr !== "undefined" && Storage.getUser()) links.appendChild(link(t("hl.title"), () => { const x = ECR_FIND.find(f => f.id === "offline"); if (x) Ecr.goFind(x); }, "synStorage"));
    if (links.childNodes.length) body.appendChild(links);
    mark();
  }
  function open() {
    if (det && det.body.isConnected) return;
    const body = el("div", "syn-det");
    det = { body };
    fill(body);
    openModal(t("syn.title"), body, [{ label: t("close") }]);
    mark();   // la fenêtre est maintenant dans la page : « Réessayer » grisé tout de suite hors connexion
  }

  // --- Hors connexion : grisé + phrase courte ---
  function netOff() { return navigator.onLine === false && !!Storage.getUser() && info().remote; }
  function bar() {
    let b = document.getElementById("synOffBar");
    if (!b) {
      const main = document.querySelector("main");
      if (!main) return null;
      b = el("div", "syn-bar");
      b.id = "synOffBar";
      b.hidden = true;
      b.setAttribute("role", "status");
      main.insertBefore(b, main.firstChild);
    }
    return b;
  }
  function mark() {
    const off = netOff();
    if (off || marked) {
      const want = off ? new Set(document.querySelectorAll(SYN_NET_ONLY.join(","))) : new Set();
      document.querySelectorAll(".syn-off").forEach(n => { if (!want.has(n)) { n.classList.remove("syn-off"); n.removeAttribute("aria-disabled"); } });
      want.forEach(n => { if (!n.classList.contains("syn-off")) { n.classList.add("syn-off"); n.setAttribute("aria-disabled", "true"); } });
      marked = off;
    }
    const b = bar();
    if (b) {
      const need = off && typeof currentScreen !== "undefined" &&
        (SYN_NET_SCREENS.includes(currentScreen) || (typeof ADMIN_SCREENS !== "undefined" && ADMIN_SCREENS.includes(currentScreen)));
      const txt = need ? t("syn.screenOff") : "";
      if (b.hidden === need) b.hidden = !need;
      if (b.textContent !== txt) b.textContent = txt;
    }
  }
  function later() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; safe(mark); }); }

  // --- Branchements (le DOM existe : scripts en fin de <body>) ---
  try {
    document.addEventListener("click", e => {
      const n = e.target && e.target.closest ? e.target.closest(".syn-off") : null;
      if (!n) return;
      if (!netOff()) { mark(); return; }             // la connexion est revenue entre-temps
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      toast(t("syn.needNet"));
    }, true);
    window.addEventListener("online", () => paint());
    window.addEventListener("offline", () => paint());
    if (window.MutationObserver) new MutationObserver(() => { if (marked || navigator.onLine === false) later(); }).observe(document.body, { childList: true, subtree: true });
    safe(() => Offline.on(() => { if (det && det.body.isConnected) fill(det.body); }));
  } catch (e) {}

  return { paint, open, kind, label, pending, netOff };
})();
