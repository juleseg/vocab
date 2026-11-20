"use strict";

// === TUTORIEL GUIDÉ (ÉTAPE 40) ===
// Visite guidée sur les vrais écrans de l'appli : l'élément présenté est mis en évidence (fond assombri autour),
// une bulle l'explique en 1 à 2 phrases, avec « Précédent », « Suivant », « Passer » et l'avancement (ex. 3 / 10).
// - Lancé tout seul à la première connexion d'un NOUVEAU compte (Tutorial.markNew à la création, auth.js), après
//   les autres fenêtres du lancement (annonces, invitation aux notifications, Quoi de neuf) : Tutorial.check().
// - Relançable : Réglages → « Revoir le tutoriel » (#btnTutoSet) et À propos (bouton affiché quand Tutorial existe).
// - Rien n'est modifié dans les données : le tutoriel ne fait que changer d'écran (et ouvrir une liste) ; l'appli
//   derrière ne réagit pas aux touchers pendant la visite. « Essayer » ouvre une vraie fenêtre (ajout de carte,
//   langue apprise d'une liste) : le tutoriel se cache, puis reprend au même point quand la fenêtre est fermée.
// - Une autre fenêtre qui s'ouvre pendant la visite (conflit, annonce…) passe devant : le tutoriel attend.
// - Un point dont l'élément n'existe pas (écran absent, séance de révision en cours…) est sauté sans erreur.
// - Sur l'appareil : vocabfr.tuto:<identifiant> = { status: "pending" | "running" | "done" | "skipped", step, at }.
//   « running » au lancement = appli fermée pendant la visite → « Reprendre le tutoriel ? » (Reprendre / Arrêter).
//   Pas de clé = compte existant : jamais de lancement automatique.
// - Accessible : bulle role="dialog", textes en rem (suivent la taille du texte du téléphone), couleurs du thème,
//   clavier sur ordinateur : → / ← (suivant / précédent), Échap (passer), Tab reste dans la bulle.
// Règle de travail : une étape qui change un écran présenté ici met aussi à jour le point correspondant (STEPS).
const Tutorial = (() => {
  const KEY = "tuto:";
  let active = false, idx = 0, token = 0, checking = false;
  let ui = null, timer = null, lastRect = "", waitingModal = false, steps = [], scrolled = false;

  // --- État sur l'appareil ---
  function key(id) { return CONFIG.LS_USER_PREFIX + KEY + (id || Storage.getUser() || ""); }
  function read(id) { try { const v = JSON.parse(localStorage.getItem(key(id)) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }
  function write(v, id) { try { localStorage.setItem(key(id), JSON.stringify(Object.assign({ at: Date.now() }, v))); } catch (e) {} }

  // --- Petits outils ---
  function go(screen) {
    try { history.replaceState(null, "", "#" + HASH_OF[screen]); } catch (e) {}
    if (currentScreen !== screen) showScreen(screen); else renderScreen();
  }
  function shown(node) {
    if (!node || !node.isConnected || node.closest("[hidden]")) return false;
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function inFixed(node) { return !!(node && node.closest("nav.bottom, header.top")); }
  function navBtn(name) { return document.querySelector('nav.bottom button[data-nav="' + name + '"]'); }
  function reviewFree() { return typeof rv === "undefined" || !rv || rv.phase === "config"; }
  // Liste présentée : « Démo » (si elle existe et peut être modifiée), sinon la première liste modifiable.
  function demoList() {
    const own = state.lists.filter(l => { try { return canEditList(l.id); } catch (e) { return true; } });
    return own.find(l => l.name === "Démo") || own[0] || null;
  }
  function openList(id) {
    lv.query = ""; lv.reorder = false;
    if (currentScreen !== "lists") go("lists");
    if (lv.listId !== id) openListView(id);
  }
  function reviewField(labelKey) {
    const want = t(labelKey);
    return [...document.querySelectorAll("#screen-review .field")].find(f => { const l = f.querySelector("label"); return l && l.textContent === want; }) || null;
  }

  // --- Les points du parcours ---
  // show() : va sur le bon écran (sans rien modifier) ; target() : élément (ou éléments) à mettre en évidence ;
  // ok() : le point existe ici (sinon sauté) ; tryIt() : action « Essayer » (ouvre une fenêtre).
  const STEPS = [
    { id: "langs", show: () => go("settings"), target: () => $("#langCard") },
    { id: "lists", show: () => { lv.listId = null; lv.query = ""; lv.reorder = false; go("lists"); renderLists(); },
      target: () => {
        const d = demoList();
        const items = [...document.querySelectorAll("#lvContent .item")];
        return (d && items.find(i => { const n = i.querySelector(".t1"); return n && n.textContent.trim().startsWith(d.name); })) || items[0] || $("#lvContent");
      } },
    { id: "card", ok: () => !!demoList(), show: () => { const d = demoList(); if (d) openList(d.id); },
      target: () => (lv.listId ? $("#lvAdd") : null),
      tryIt: () => { const d = demoList(); if (d) openCardEditor(null, d.id); } },
    { id: "study", ok: () => !!demoList(), show: () => { const d = demoList(); if (d) openList(d.id); },   // « Ajouter une langue apprise à la liste » (menu de la liste, étape 37 ; remplace « import » à l'étape 51 ; nom : étape 52)
      target: () => $("#lvStudy"),
      tryIt: () => { const b = $("#lvStudy"); if (b) b.click(); } },
    { id: "session", ok: reviewFree, show: () => go("review"),
      target: () => (reviewFree() ? $("#screen-review > .btn.primary") : null) },
    { id: "modes", ok: reviewFree, show: () => go("review"),
      target: () => (reviewFree() ? reviewField("review.mode") : null) },
    { id: "pending", show: () => go("pending"), target: () => navBtn("pending") },
    { id: "streak", show: () => go("home"), target: () => [$("#homeStreakCard"), $("#homeGoal")] },
    { id: "xp", show: () => go("home"), target: () => [$("#homeXp"), $("#homeChallenges")] },   // XP et défis du jour (étape 43)
    { id: "friends", show: () => go("friends"), target: () => navBtn("friends") },
    { id: "settings", show: () => go("settings"), target: () => (shown($("#pushCard")) ? $("#pushCard") : navBtn("settings")) },
    { id: "about", show: () => { go("settings"); window.scrollTo(0, 0); }, target: () => $("#btnAbout") }   // ⓘ À propos, dans l'en-tête, remonté en haut de page (étape 51)
  ];
  function targets(s) {
    let x = null;
    try { x = s.target(); } catch (e) { x = null; }
    return (Array.isArray(x) ? x : [x]).filter(shown);
  }
  function avail(s) { try { return !s.ok || !!s.ok(); } catch (e) { return false; } }

  // --- Affichage ---
  function build() {
    const root = el("div", "tuto");
    const block = el("div", "tuto-block");
    block.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
    const hole = el("div", "tuto-hole");
    hole.setAttribute("aria-hidden", "true");
    const bub = el("div", "tuto-bubble");
    bub.setAttribute("role", "dialog");
    bub.setAttribute("aria-modal", "true");
    bub.setAttribute("aria-labelledby", "tutoTitle");
    bub.setAttribute("aria-describedby", "tutoText");
    const prog = el("div", "tuto-prog");
    const title = el("h2", "tuto-title"); title.id = "tutoTitle";
    const text = el("p", "tuto-text"); text.id = "tutoText";
    const tryB = el("button", "btn tuto-try"); tryB.type = "button";
    const nav = el("div", "tuto-nav");
    const prev = el("button", "btn tuto-prev"); prev.type = "button";
    const next = el("button", "btn primary tuto-next"); next.type = "button";
    nav.append(prev, next);
    const skip = el("button", "link-btn tuto-skip"); skip.type = "button";
    const head = el("div", "tuto-head");
    head.append(prog, skip);
    bub.append(head, title, text, tryB, nav);
    root.append(block, hole, bub);
    prev.addEventListener("click", () => move(-1));
    next.addEventListener("click", () => move(1));
    skip.addEventListener("click", () => stop("skipped"));
    tryB.addEventListener("click", tryNow);
    document.body.appendChild(root);
    return { root, hole, bub, prog, title, text, tryB, prev, next, skip };
  }
  function onKey(e) {
    if (!active || !ui || ui.root.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); stop("skipped"); return; }
    const tag = (e.target && e.target.tagName) || "";
    if (e.key === "ArrowRight" && tag !== "INPUT") { e.preventDefault(); move(1); return; }
    if (e.key === "ArrowLeft" && tag !== "INPUT") { e.preventDefault(); move(-1); return; }
    if (e.key === "Tab") {   // le focus reste dans la bulle
      const f = [...ui.bub.querySelectorAll("button")].filter(b => !b.hidden && !b.disabled);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
    }
  }
  // Rectangle commun aux éléments, limité à l'écran.
  function rectOf(nodes) {
    let r = null;
    nodes.forEach(n => {
      const b = n.getBoundingClientRect();
      r = r ? { top: Math.min(r.top, b.top), left: Math.min(r.left, b.left), bottom: Math.max(r.bottom, b.bottom), right: Math.max(r.right, b.right) }
            : { top: b.top, left: b.left, bottom: b.bottom, right: b.right };
    });
    if (!r) return null;
    const pad = 6, W = window.innerWidth, H = window.innerHeight;
    return { top: Math.max(4, r.top - pad), left: Math.max(4, r.left - pad), bottom: Math.min(H - 4, r.bottom + pad), right: Math.min(W - 4, r.right + pad) };
  }
  // Bulle en dessous de l'élément s'il y a la place, sinon au-dessus. Pas la place : la page défile une fois pour en
  // faire (élément remonté ou descendu) ; élément très grand : seule sa partie haute est mise en évidence.
  function place(force) {
    if (!ui) return;
    const s = steps[idx];
    const nodes = s ? targets(s) : [];
    if (!nodes.length) { ui.hole.hidden = true; centerBubble(); return; }
    const H = window.innerHeight, gap = 12, m = 8;
    const bh = ui.bub.offsetHeight;
    let r = rectOf(nodes);
    const fits = x => (H - x.bottom - gap - m >= bh) || (x.top - gap - m >= bh);
    if (!fits(r) && !scrolled && !inFixed(nodes[0])) {
      scrolled = true;
      const maxY = Math.max(0, document.documentElement.scrollHeight - H), y = window.scrollY;
      const up = r.top - (m + bh + gap);              // élément sous la bulle
      const down = r.bottom + gap + bh + m - H;       // élément au-dessus de la bulle
      const ok = d => y + d >= 0 && y + d <= maxY;
      if (r.bottom - r.top + bh + 2 * gap + 2 * m <= H) {
        if (ok(down)) window.scrollBy(0, down); else if (ok(up)) window.scrollBy(0, up);
        r = rectOf(nodes);
      }
    }
    if (!fits(r) && r.bottom - r.top > H - bh - 2 * gap - 2 * m) {
      // élément plus grand que la place libre : partie haute seulement, bulle dessous
      r = Object.assign({}, r, { bottom: Math.max(r.top + 48, H - bh - gap - m) });
    }
    const sig = [r.top, r.left, r.bottom, r.right, window.innerWidth, H, bh].map(Math.round).join(",");
    if (!force && sig === lastRect) return;
    lastRect = sig;
    ui.hole.hidden = false;
    Object.assign(ui.hole.style, { top: r.top + "px", left: r.left + "px", width: Math.max(0, r.right - r.left) + "px", height: Math.max(0, r.bottom - r.top) + "px" });
    const below = H - r.bottom - gap - m, above = r.top - gap - m;
    let top;
    if (below >= bh) top = r.bottom + gap;
    else if (above >= bh) top = r.top - gap - bh;
    else top = below >= above ? H - bh - m : m;
    ui.bub.style.top = Math.max(m, Math.min(H - bh - m, top)) + "px";
  }
  function centerBubble() {
    const H = window.innerHeight, bh = ui.bub.offsetHeight;
    ui.bub.style.top = Math.max(8, (H - bh) / 2) + "px";
    lastRect = "";
  }
  // Fait défiler la page pour que l'élément soit visible (pas pour la barre du bas, fixe).
  function reveal(nodes) {
    const n = nodes[0];
    if (!n || inFixed(n)) return;
    const r = n.getBoundingClientRect(), H = window.innerHeight;
    const big = r.height > H * 0.5;
    try { n.scrollIntoView({ block: big ? "start" : "center", behavior: "auto" }); } catch (e) { n.scrollIntoView(); }
    if (big) window.scrollBy(0, -12);
  }

  function visible() { return steps.filter(avail); }
  function fill() {
    const s = steps[idx], list = visible(), pos = Math.max(0, list.indexOf(s));
    ui.prog.textContent = t("tuto.progress", { n: pos + 1, total: list.length });
    ui.title.textContent = t("tuto." + s.id + ".title");
    ui.text.textContent = t("tuto." + s.id + ".text");
    ui.tryB.hidden = !s.tryIt;
    ui.tryB.textContent = t("tuto.try");
    ui.prev.textContent = t("tuto.prev");
    ui.prev.disabled = pos === 0;
    ui.next.textContent = t(pos === list.length - 1 ? "tuto.done" : "tuto.next");
    ui.skip.textContent = t("tuto.skip");
    ui.bub.setAttribute("aria-label", t("tuto.label"));
  }
  // Affiche le point idx ; dir = sens de recherche si le point n'existe pas ici (+1 / -1).
  function showStep(dir) {
    if (!active) return;
    dir = dir || 1;
    for (let guard = 0; guard < steps.length + 1; guard++) {
      if (idx < 0) { idx = 0; dir = 1; }
      if (idx >= steps.length) { stop("done"); return; }
      const s = steps[idx];
      if (avail(s)) {
        try { s.show(); } catch (e) {}
        const nodes = targets(s);
        if (nodes.length) {
          write({ status: "running", step: s.id });
          if (!ui) { ui = build(); }
          ui.root.hidden = false;
          fill();
          reveal(nodes);
          lastRect = ""; scrolled = false;
          // mesure après le défilement et le rendu de la bulle
          requestAnimationFrame(() => requestAnimationFrame(() => { place(true); try { ui.next.focus({ preventScroll: true }); } catch (e) { ui.next.focus(); } }));
          return;
        }
      }
      idx += dir;   // élément absent : point sauté sans erreur
    }
    stop("done");
  }
  function move(d) {
    if (!active) return;
    const list = visible(), pos = list.indexOf(steps[idx]);
    if (d > 0 && pos === list.length - 1) { stop("done"); return; }
    idx += d;
    showStep(d);
  }
  // « Essayer » : la vraie fenêtre s'ouvre ; le tutoriel se cache et revient au même point à sa fermeture.
  function tryNow() {
    const s = steps[idx];
    if (!s || !s.tryIt) return;
    ui.root.hidden = true;
    waitingModal = true;
    toast(t("tuto.tryBack"));
    try { s.tryIt(); } catch (e) {}
  }
  // Surveillance : une fenêtre ouverte (Essayer, conflit, annonce…) passe devant ; à sa fermeture, retour au point.
  function watch() {
    if (!active || !ui) return;
    const modal = !!document.querySelector(".modal-bg");
    if (modal) { if (!ui.root.hidden) { ui.root.hidden = true; } waitingModal = true; return; }
    if (waitingModal) { waitingModal = false; showStep(1); return; }
    if (!ui.root.hidden) place(false);
  }
  function onResize() { if (active && ui && !ui.root.hidden) place(true); }

  function begin(at) {
    if (!Storage.getUser()) return;
    end();
    steps = STEPS.slice();
    active = true;
    waitingModal = false;
    idx = Math.max(0, Math.min(steps.length - 1, at || 0));
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, { passive: true });
    timer = setInterval(watch, 400);
    showStep(1);
  }
  function end() {
    active = false;
    if (timer) { clearInterval(timer); timer = null; }
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onResize);
    if (ui) { ui.root.remove(); ui = null; }
    lastRect = "";
  }
  // Fin de la visite : "done" (terminée) ou "skipped" (Passer / Arrêter) — ne revient plus toute seule.
  function stop(status) {
    if (!active) return;
    const last = status === "done";
    end();
    write({ status: status || "skipped" });
    if (last) { go("home"); toast(t("tuto.endToast")); }
  }

  // --- API ---
  // Départ depuis le début (Réglages, À propos).
  function start() { token++; begin(0); }
  // Nouveau compte : lancement automatique au premier passage de check().
  function markNew(id) { if (id) write({ status: "pending" }, id); }
  // Au lancement, après les autres fenêtres : nouveau compte → visite ; visite interrompue → « Reprendre ? ».
  async function check() {
    const who = Storage.getUser();
    if (!who || active || checking) return;
    const r = read(who);
    if (!r || (r.status !== "pending" && r.status !== "running")) return;   // compte existant, terminé ou passé
    checking = true;
    const my = ++token;
    try {
      if (!(await whenNoModal(() => my === token && Storage.getUser() === who))) return;
      if (active) return;
      if (r.status === "pending") { begin(0); return; }
      const at = Math.max(0, STEPS.findIndex(s => s.id === r.step));
      const pos = STEPS.filter(avail).indexOf(STEPS[at]);
      const body = el("p", null, t("tuto.resumeText", { n: (pos >= 0 ? pos : at) + 1 }));
      openModal(t("tuto.resumeTitle"), body, [
        { label: t("tuto.stop"), onClick: () => { write({ status: "skipped" }, who); } },
        { label: t("tuto.resume"), kind: "primary", onClick: () => { setTimeout(() => { if (Storage.getUser() === who) begin(at); }, 0); } }
      ], { locked: true });
    } catch (e) { /* jamais d'erreur visible */ }
    finally { checking = false; }
  }
  // Déconnexion / changement de compte : la visite s'arrête (l'état « running » reste : proposée au prochain lancement).
  function reset() { token++; checking = false; end(); }
  function isActive() { return active; }

  // Réglages → « Revoir le tutoriel ».
  const b = document.getElementById("btnTutoSet");
  if (b) b.addEventListener("click", () => start());

  return { start, markNew, check, reset, isActive, STEPS };
})();
window.App.Tutorial = Tutorial;
