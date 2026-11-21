"use strict";

// === ÉCRANS DÉDIÉS ET CONFORT D'UTILISATION (ÉTAPE 67) ===
// Confort seulement : aucune donnée du compte, aucun SQL, DATA_VERSION inchangé. Tout ce qui est retenu ici vit sur
// l'APPAREIL (localStorage, préfixe vocabfr.ux:) : sec (section ouverte des Réglages), fold (cartes repliables dépliées),
// use (nombre d'ouvertures de chaque fonction), short (raccourcis de l'accueil : { mode: "auto" | "manual", pick: [4 écrans] }).
// - Réglages (index.html, #setSecs) : sections repliées (ECR_SECS), une seule ouverte à la fois, au toucher (pas de glisser) ;
//   chaque carte garde son identifiant et son enregistrement d'avant. Une section dont toutes les cartes sont cachées est cachée.
//   Sections longues : « Ouvrir en plein écran » → #reglages-<slug> (écran settings, seule cette section, retour « ‹ Réglages »).
//   Recherche (#setSearch) : réglages et fonctions (ECR_FIND), titres et mots-clés dans les 3 langues, sans accents.
// - Accueil et Stats : un nœud avec data-fold="<clé>" devient une carte repliable (titre data-fold-t ou 1er titre, résumé
//   data-fold-s ou calculé ici) ; repliée par défaut. Accueil : 4 raccourcis (#homeShort, ECR_SHORT).
// Étape 75 : Accueil = une seule carte repliable « Mes progrès » (data-fold="home.prog") ; Stats = 3 groupes (stats.prog,
//   stats.words, stats.detail) ; attribut data-fold-keep = les cartes du groupe gardent leur titre ; raccourcis de l'accueil :
//   2 au plus, hors barre du bas. Les anciennes clés retenues (home.learned, home.xp, home.ch, stats.<bloc>) sont ignorées.
// - Barre du bas : ECR_BAR + « Plus » (#navMore, fenêtre avec ECR_MORE) ; les autres boutons restent dans la page (cachés)
//   pour les pastilles et le tutoriel. « Plus » est allumé quand l'écran ouvert dépend d'un bouton caché.
// Étape 79 : Réglages = 5 grandes sections (Mon compte, Réviser, Apparence, Notifications, Données et stockage) ; « Se déconnecter »
//   aussi dans « Plus », toujours visible, avec une confirmation courte (logoutAsk) ; recherche mise à jour (ECR_FIND).
// Étape 79 : 5 grandes sections, ni plus ni moins (les 8 sections de l'étape 67 y sont rangées ; table : claude/carte/etape-79.md).
// old = anciens noms de sections (openSec) et anciennes adresses « plein écran » (#reglages-<slug>) qui mènent ici.
const ECR_SECS = [
  { id: "account", slug: "compte", ic: "👤", full: true, old: ["privacy", "langs", "help", "admin", "confidentialite", "langues", "aide", "administration"] },
  { id: "learn", slug: "reviser", ic: "🎯", full: true, old: ["apprentissage"] },
  { id: "look", slug: "apparence", ic: "🎨" },
  { id: "notif", slug: "notifications", ic: "🔔", full: true },
  { id: "data", slug: "donnees", ic: "💾", full: true }
];
// Onglets gardés dans la barre du bas (proposition de l'étape 67, à valider par Jules) ; le reste passe dans « Plus ».
const ECR_BAR = ["home", "review", "lists", "friends"];
// Fenêtre « Plus » : onglets sortis de la barre, puis écrans secondaires (ok : disponible ici).
const ECR_MORE = [
  { s: "stats", ic: "📊", k: "nav.stats" },
  { s: "pending", ic: "✅", k: "nav.pending", badge: "#pendingBadge" },
  { s: "settings", ic: "⚙️", k: "nav.settings" },
  { s: "sentences", ic: "✍️", k: "sn.title", ok: () => sentOn() },
  { s: "messages", ic: "✉️", k: "mg.title", ok: () => Messages.on() },
  { s: "requests", ic: "🤖", k: "queue.title", ok: () => Queue.usable() },
  { s: "ideas", ic: "💡", k: "ix.mine", ok: () => Ideas.on() },
  { s: "about", ic: "ⓘ", k: "about.title" },
  { s: "admin", ic: "🛠️", k: "admin.title", ok: () => auth.mode === "supabase" && Mod.any() }
];
// Étape 79 : « Se déconnecter » est en plus un bouton toujours visible en bas de la fenêtre « Plus » (openMore, logoutAsk).
// Raccourcis possibles de l'accueil (ordre = ordre par défaut, avant que l'usage ne soit connu).
const ECR_SHORT = [
  { s: "review", ic: "📖", k: "nav.review" },
  { s: "lists", ic: "📚", k: "nav.lists" },
  { s: "stats", ic: "📊", k: "nav.stats" },
  { s: "pending", ic: "✅", k: "nav.pending" },
  { s: "friends", ic: "👫", k: "nav.friends" },
  { s: "sentences", ic: "✍️", k: "sn.title", ok: () => sentOn() },
  { s: "messages", ic: "✉️", k: "mg.title", ok: () => Messages.on() },
  { s: "requests", ic: "🤖", k: "queue.title", ok: () => Queue.usable() }
];
const ECR_SHORT_N = 2;   // étape 75 : 2 raccourcis au plus, et seulement des fonctions qui ne sont PAS dans la barre du bas (ECR_BAR)
// Recherche : réglage (sec + el : section à ouvrir, élément à montrer) ou fonction (screen, ou fn).
// Textes cherchés : t(k) et t("ecr.kw.<id>") (mots-clés), dans les 3 langues.
const ECR_FIND = [
  // Mon compte
  { id: "account", k: "ecr.sec.account", sec: "account", el: "#sec-account" },
  { id: "pin", k: "account.changePin", sec: "account", el: "#btnChangePin" },
  { id: "logout", k: "account.logout", sec: "account", el: "#btnLogout" },
  { id: "langs", k: "prof.title", sec: "account", el: "#langCard" },
  { id: "applang", k: "lx.app", sec: "account", el: "#langCard" },
  { id: "privacy", k: "ecr.sec.privacy", sec: "account", el: "#friendsPrivCard" },
  { id: "idea", k: "ix.propose", sec: "account", el: "#ideaCard" },
  { id: "write", k: "mg.teamTitle", sec: "account", el: "#msgTeamCard" },
  { id: "about", k: "about.title", sec: "account", el: "#btnAboutSet" },
  { id: "tuto", k: "tuto.replay", sec: "account", el: "#btnTutoSet" },
  { id: "admin", k: "admin.title", sec: "account", el: "#adminCard" },
  // Réviser
  { id: "learn", k: "ecr.sec.learn", sec: "learn", el: "#sec-learn" },
  { id: "goal", k: "settings.dailyGoal", sec: "learn", el: "#setDailyGoal" },
  { id: "size", k: "settings.sessionSize", sec: "learn", el: "#setSessionSize" },
  { id: "rhythm", k: "fsrs.rhythm", sec: "learn", el: "#reviewCard" },
  { id: "audio", k: "audio.title", sec: "learn", el: "#audioCard" },
  { id: "auditory", k: "aud.title", sec: "learn", el: "#audLearnCard" },
  { id: "sentence", k: "sn.setTitle", sec: "learn", el: "#sentCard" },
  { id: "gender", k: "gd.set.title", sec: "learn", el: "#genderCard" },
  { id: "claude", k: "ai.title", sec: "learn", el: "#aiCard" },
  // Apparence
  { id: "theme", k: "settings.theme", sec: "look", el: "#setTheme" },
  { id: "short", k: "ecr.short.title", sec: "look", el: "#ecrShortCard" },
  // Notifications
  { id: "notif", k: "np.title", sec: "notif", el: "#pushCard" },
  { id: "quiet", k: "np.quiet", sec: "notif", el: "#pushCard .np-times" },
  { id: "morning", k: "mom.set.title", sec: "notif", el: "#momentsCard" },
  // Données et stockage
  { id: "data", k: "settings.data", sec: "data", el: "#storageInfo" },
  { id: "export", k: "export", sec: "data", el: "#btnExport" },
  { id: "import", k: "import", sec: "data", el: "#btnImport" },
  { id: "copies", k: "gf.copies", sec: "data", el: "#btnGfCopies" },
  { id: "fusions", k: "fu.listBtn", sec: "data", el: "#btnFuList" },
  { id: "offline", k: "hl.title", sec: "data", el: "#stockCard" },
  { id: "freeup", k: "hl.free", sec: "data", el: "#hlFree" },
  // Fonctions de l'appli
  { id: "sync", k: "syn.title", fn: () => SyncUi.open(), ok: () => typeof SyncUi !== "undefined" },
  { id: "s_home", k: "nav.home", screen: "home" },
  { id: "s_review", k: "nav.review", screen: "review" },
  { id: "s_lists", k: "nav.lists", screen: "lists" },
  { id: "s_stats", k: "nav.stats", screen: "stats" },
  { id: "s_pending", k: "nav.pending", screen: "pending" },
  { id: "s_friends", k: "nav.friends", screen: "friends" },
  { id: "s_sentences", k: "sn.title", screen: "sentences", ok: () => sentOn() },
  { id: "s_messages", k: "mg.title", screen: "messages", ok: () => Messages.on() },
  { id: "s_requests", k: "queue.title", screen: "requests", ok: () => Queue.usable() },
  { id: "s_ideas", k: "ix.mine", screen: "ideas", ok: () => Ideas.on() },
  { id: "s_bilan", k: "prg.bilan.btn", fn: () => openBilan() }
];
const ECR_FIND_MAX = 8;

const Ecr = (() => {
  const P = CONFIG.LS_USER_PREFIX + "ux:";
  const LANGS = ["ko", "fr", "en"];
  function lsGet(k, d) { try { const v = JSON.parse(localStorage.getItem(P + k)); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function avail(x) { return !x.ok || safe(x.ok, false); }
  function go(screen) {
    try { history.replaceState(null, "", "#" + HASH_OF[screen]); } catch (e) {}
    showScreen(screen);
  }

  // --- Réglages : sections repliées ---
  function secOf(id) { return ECR_SECS.find(s => s.id === id) || null; }
  function secAlias(id) { const s = ECR_SECS.find(x => x.id === id || arr(x.old).includes(id)); return s ? s.id : id; }   // étape 79 : ancien nom de section
  function fullSec(h) {
    const m = /^reglages-([a-z]+)$/.exec(h == null ? (location.hash || "").replace("#", "") : h);
    const s = m && ECR_SECS.find(x => (x.slug === m[1] || arr(x.old).includes(m[1])) && x.full);
    return s ? s.id : null;
  }
  function isFullHash(h) { return !!fullSec(h); }
  let temp = null;   // section ouverte par le tutoriel : montrée sans être retenue (oubliée en quittant les Réglages)
  function openId() { if (temp && secOf(temp)) return temp; const v = lsGet("sec", ""); return secOf(v) ? v : ""; }
  function setOpen(id) { temp = null; lsSet("sec", id || ""); }
  // Ouvre une section (recherche) : la seule ouverte, retenue sur l'appareil ; passing = true (tutoriel) : sans la retenir.
  function openSec(id, passing) {
    id = secAlias(id);
    if (!secOf(id)) return;
    if (passing) temp = id; else setOpen(id);
    settings();
  }
  function buildSecs() {
    ECR_SECS.forEach(s => {
      const box = document.getElementById("sec-" + s.id);
      if (!box || box.querySelector(".acc-hd")) return;
      const body = box.querySelector(".acc-body");
      body.id = "sec-" + s.id + "-body";
      const hd = el("button", "acc-hd");
      hd.type = "button";
      hd.setAttribute("aria-controls", body.id);
      hd.setAttribute("aria-expanded", "false");
      const tx = el("span", "acc-tx");
      tx.append(el("span", "acc-t"), el("span", "acc-d"), el("span", "acc-s"));
      hd.append(el("span", "acc-ic", s.ic), tx, el("span", "acc-chev"));
      hd.querySelector(".acc-ic").setAttribute("aria-hidden", "true");
      hd.querySelector(".acc-chev").setAttribute("aria-hidden", "true");
      hd.addEventListener("click", () => {
        const on = openId() === s.id;
        setOpen(on ? "" : s.id);
        settings();
        if (!on) scrollTo(hd);
      });
      box.insertBefore(hd, body);
      if (s.full) {
        const f = el("button", "link-btn acc-full");
        f.type = "button";
        f.addEventListener("click", () => { location.hash = "#reglages-" + s.slug; });
        body.insertBefore(f, body.firstChild);
      }
    });
    const back = $("#setFullBack");
    if (back) back.addEventListener("click", () => { location.hash = "#" + HASH_OF.settings; });
    const q = $("#setSearch");
    if (q) {
      q.addEventListener("input", () => paintSearch());
      q.addEventListener("keydown", e => {
        if (e.key === "Enter") { const b = $("#setSearchRes .ecr-hit"); if (b) { e.preventDefault(); b.click(); } }
        else if (e.key === "Escape") { q.value = ""; paintSearch(); }
      });
    }
  }
  function scrollTo(node) {
    requestAnimationFrame(() => {
      const r = node.getBoundingClientRect();
      if (r.top < 70 || r.top > window.innerHeight * 0.6) window.scrollBy(0, r.top - 76);
    });
  }
  function secSummary(id) {
    return safe(() => {
      if (id === "notif") {
        if (!Push.on()) return "";
        const st = Push.state().st;
        if (!st) return "";
        return t("np.thisDevice") + " : " + t(st.registered && Push.permission() === "granted" ? "np.dev.on" : "np.dev.off");
      }
      if (id === "learn") return t("ecr.sum.learn", { g: Streak.goal(), r: rhyLabel(rhyCur()) });
      if (id === "account") return [Storage.getUser() || "", learningOf().map(x => langName(x.lang)).join(", ")].filter(Boolean).join(" · ");
      if (id === "look") return t("theme." + state.settings.theme);
      if (id === "data") {   // étape 79 : listes gardées hors ligne, sinon l'état de la synchro
        const n = typeof Offline !== "undefined" ? Offline.keptCount() : 0;
        return n ? t("hl.sum", { n }) : (typeof SyncUi !== "undefined" ? SyncUi.label() : "");
      }
      return "";
    }, "");
  }
  function settings() {
    const root = $("#screen-settings");
    if (!root || !$("#setSecs")) return;
    buildSecs();
    const full = currentScreen === "settings" ? fullSec() : null;
    const open = full || openId();
    root.classList.toggle("ecr-is-full", !!full);
    const top = $("#setFullTop");
    if (top) top.hidden = !full;
    if (full) $("#setFullTitle").textContent = t("ecr.sec." + full);
    $("#setSearchBox").hidden = !!full;
    const q = $("#setSearch");
    q.placeholder = t("ecr.search.ph");
    q.setAttribute("aria-label", t("ecr.search.ph"));
    ECR_SECS.forEach(s => {
      const box = document.getElementById("sec-" + s.id);
      if (!box) return;
      const body = box.querySelector(".acc-body"), hd = box.querySelector(".acc-hd");
      const cards = [...body.children].filter(n => n.classList.contains("card"));
      const empty = cards.length > 0 && cards.every(c => c.hidden);
      box.hidden = empty || (!!full && full !== s.id);
      const on = open === s.id;
      body.hidden = !on;
      box.classList.toggle("open", on);
      hd.hidden = !!full;
      hd.setAttribute("aria-expanded", String(on));
      hd.querySelector(".acc-t").textContent = t("ecr.sec." + s.id);
      hd.querySelector(".acc-d").textContent = t("ecr.sec." + s.id + ".d");
      const sum = secSummary(s.id), se = hd.querySelector(".acc-s");
      se.textContent = sum;
      se.hidden = !sum;
      const f = body.querySelector(".acc-full");
      if (f) { f.textContent = "⤢ " + t("ecr.full"); f.hidden = !!full; }
    });
    renderShortCard();
    if (q.value) paintSearch();
  }

  // --- Réglages : recherche ---
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[«»"'’.,:;!?()·…]/g, " "); }
  function textIn(l, k) { return (I18N[l] && I18N[l][k]) || ""; }
  function findTarget(x) {
    if (!x.sec) return null;
    return document.querySelector(x.el) || document.getElementById("sec-" + x.sec);
  }
  function usable(x) {
    if (!avail(x)) return false;
    if (x.screen) return SCREENS.includes(x.screen);
    if (x.fn) return true;
    const box = document.getElementById("sec-" + x.sec), n = findTarget(x);
    if (!box || !n) return false;
    const body = box.querySelector(".acc-body");
    const cards = [...body.children].filter(c => c.classList.contains("card"));
    if (cards.length && cards.every(c => c.hidden)) return false;
    const card = n.closest(".card");
    return !(card && card.hidden);
  }
  function search(q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    ECR_FIND.forEach((x, i) => {
      const hay = LANGS.map(l => textIn(l, x.k) + " " + textIn(l, "ecr.kw." + x.id)).join(" ");
      const h = norm(hay);
      if (!words.every(w => h.includes(w))) return;
      if (!usable(x)) return;
      const title = norm(t(x.k));
      const score = (title.startsWith(words[0]) ? 0 : title.includes(words[0]) ? 1 : 2) * 100 + i;
      out.push({ x, score });
    });
    return out.sort((a, b) => a.score - b.score).slice(0, ECR_FIND_MAX).map(o => o.x);
  }
  function paintSearch() {
    const q = $("#setSearch"), res = $("#setSearchRes");
    if (!q || !res) return;
    res.textContent = "";
    const v = q.value.trim();
    res.hidden = !v;
    if (!v) return;
    const hits = search(v);
    if (!hits.length) { res.appendChild(el("p", "muted ecr-none", t("ecr.search.none"))); return; }
    hits.forEach(x => {
      const b = el("button", "item ecr-hit");
      b.type = "button";
      const m = el("div", "main");
      m.appendChild(el("div", "t1", t(x.k)));
      m.appendChild(el("div", "t2", x.sec ? t("nav.settings") + " › " + t("ecr.sec." + x.sec) : t("ecr.res.fn")));
      b.append(m, el("span", "chev", "›"));
      b.addEventListener("click", () => goFind(x));
      res.appendChild(b);
    });
  }
  function goFind(x) {
    if (x.screen) { go(x.screen); return; }
    if (x.fn) { safe(x.fn); return; }
    const q = $("#setSearch");
    if (q) { q.value = ""; paintSearch(); }
    if (currentScreen !== "settings" || fullSec()) { setOpen(x.sec); go("settings"); }
    else openSec(x.sec);
    const n = findTarget(x);
    if (!n) return;
    requestAnimationFrame(() => {
      const big = n.getBoundingClientRect().height > window.innerHeight * 0.6;   // étape 79 : grande carte → son début (sous l'en-tête fixe)
      try { n.scrollIntoView({ block: big ? "start" : "center" }); } catch (e) {}
      const card = n.classList.contains("card") ? n : (n.closest(".card") || n);
      card.classList.remove("ecr-flash");
      void card.offsetWidth;
      card.classList.add("ecr-flash");
      setTimeout(() => card.classList.remove("ecr-flash"), 1800);
      if (/^(INPUT|SELECT)$/.test(n.tagName)) { try { n.focus({ preventScroll: true }); } catch (e) {} }
    });
  }

  // --- Cartes repliables (Accueil, Stats) ---
  function foldOpen(key) { const st = lsGet("fold", {}); return !!(st && st[key] === true); }
  function setFold(key, on) { const st = lsGet("fold", {}) || {}; if (on) st[key] = true; else delete st[key]; lsSet("fold", st); }
  function wrap(node) {
    const p = node.parentNode;
    if (p && p.classList.contains("fold-body")) return p.parentNode;
    const key = node.dataset.fold;
    const w = el("div", "card fold");
    w.dataset.key = key;
    const body = el("div", "fold-body");
    body.id = "fold-" + key.replace(/[^a-z0-9]+/gi, "-");
    const hd = el("button", "fold-hd");
    hd.type = "button";
    hd.setAttribute("aria-controls", body.id);
    const tx = el("span", "fold-tx");
    tx.append(el("span", "fold-t"), el("span", "fold-s"));
    const ch = el("span", "fold-chev");
    ch.setAttribute("aria-hidden", "true");
    hd.append(tx, ch);
    hd.addEventListener("click", () => { setFold(key, !foldOpen(key)); paintFold(w); });
    if (p) p.insertBefore(w, node);
    body.appendChild(node);
    w.append(hd, body);
    return w;
  }
  // Titre : data-fold-t (clé de texte), sinon le 1er titre du bloc. Le titre d'origine de la 1re carte est caché (doublon).
  function headOf(node) {
    const c = node.classList.contains("card") ? node : (node.firstElementChild && node.firstElementChild.classList.contains("card") ? node.firstElementChild : null);
    if (!c) return null;
    const f = c.firstElementChild;
    if (!f) return null;
    if (f.tagName === "H2") return f;
    return [...f.children].find(x => x.tagName === "H2") ? f : null;
  }
  function paintFold(w, sum) {
    const node = w.querySelector(".fold-body").firstElementChild;
    if (!node) return;
    const key = w.dataset.key, on = foldOpen(key);
    w.hidden = node.hidden;
    const hd = w.querySelector(".fold-hd"), body = w.querySelector(".fold-body");
    body.hidden = !on;
    w.classList.toggle("open", on);
    hd.setAttribute("aria-expanded", String(on));
    const head = node.hasAttribute("data-fold-keep") ? null : headOf(node);   // étape 75 : groupe de plusieurs cartes, chacune garde son titre
    if (head) head.classList.add("fold-dup");
    const h2 = node.querySelector("h2");
    hd.querySelector(".fold-t").textContent = node.dataset.foldT ? t(node.dataset.foldT) : (h2 ? h2.textContent : key);
    if (sum == null) sum = node.dataset.foldS || w.dataset.sum || "";
    w.dataset.sum = sum;
    const s = hd.querySelector(".fold-s");
    s.textContent = sum;
    s.hidden = !sum;
  }
  function folds(root, sums) {
    (root || document).querySelectorAll("[data-fold]").forEach(n => {
      const w = wrap(n);
      paintFold(w, sums ? sums[n.dataset.fold] : null);
    });
  }

  // --- Accueil : raccourcis et cartes repliables ---
  function useCounts() { const u = lsGet("use", {}); return u && typeof u === "object" ? u : {}; }
  function onShow(screen, prev) {
    if (screen !== "settings") temp = null;
    if (screen === prev || !Storage.getUser() || !ECR_SHORT.some(x => x.s === screen)) return;
    if (safe(() => Tutorial.isActive(), false)) return;   // la visite guidée ne compte pas comme un usage
    const u = useCounts();
    u[screen] = Math.min(1e6, (u[screen] || 0) + 1);
    lsSet("use", u);
  }
  function shortCfg() {
    const c = lsGet("short", {}) || {};
    return { mode: c.mode === "manual" ? "manual" : "auto", pick: arr(c.pick).filter(s => ECR_SHORT.some(x => x.s === s)) };
  }
  function shortOk() { return ECR_SHORT.filter(x => !ECR_BAR.includes(x.s)).filter(avail); }   // étape 75 : hors barre du bas
  function shortList() {
    const ok = shortOk(), c = shortCfg();
    if (c.mode === "manual") {
      const out = [];
      c.pick.forEach(s => { const x = ok.find(y => y.s === s); if (x && !out.includes(x)) out.push(x); });
      ok.forEach(x => { if (out.length < ECR_SHORT_N && !out.includes(x)) out.push(x); });
      return out.slice(0, ECR_SHORT_N);
    }
    const u = useCounts();
    return ok.map((x, i) => ({ x, n: u[x.s] || 0, i })).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, ECR_SHORT_N).map(o => o.x);
  }
  function shortCount(s) {
    return safe(() => {
      if (s === "review") return dueCount(state.cards, Date.now());
      if (s === "pending") return liveProposals().length;
      return 0;
    }, 0);
  }
  function home() {
    const box = $("#homeShort");
    if (box) {
      box.textContent = "";
      box.setAttribute("role", "group");
      box.setAttribute("aria-label", t("ecr.short.title"));
      shortList().forEach(x => {
        const b = el("button", "ecr-sc");
        b.type = "button";
        b.dataset.screen = x.s;
        const ic = el("span", "ecr-sc-ic", x.ic);
        ic.setAttribute("aria-hidden", "true");
        b.append(ic, el("span", "ecr-sc-t", t(x.k)));
        const n = shortCount(x.s);
        if (n) b.appendChild(el("span", "ecr-sc-n", n > 99 ? "99+" : String(n)));
        b.addEventListener("click", () => go(x.s));
        box.appendChild(b);
      });
      box.hidden = !box.childNodes.length;
    }
    // Étape 75 : une seule carte repliable « Mes progrès » (mots appris, XP et niveau, défis du jour), avec un résumé des trois
    folds($("#screen-home"), {
      "home.prog": [
        safe(() => ($("#homeLearned") && !$("#homeLearned").hidden ? t("hs.sum.words", { n: Progres.weekCount() }) : ""), ""),
        safe(() => t("xp.level", { n: XP.summary().level }), ""),
        safe(() => t("hs.sum.ch", { n: XP.challenges().list.filter(x => x.done).length }), "")
      ].filter(Boolean).join(" · ")
    });
  }
  // Réglages → Apparence : « Raccourcis de l'accueil » (automatique d'après l'usage, ou choisis).
  function renderShortCard() {
    const box = $("#ecrShortCard");
    if (!box) return;
    box.textContent = "";
    const c = shortCfg();
    box.appendChild(el("h2", null, t("ecr.short.title")));
    const seg = el("div", "seg");
    ["auto", "manual"].forEach(m => {
      const b = el("button", null, t("ecr.short." + m));
      b.type = "button";
      b.setAttribute("aria-pressed", String(c.mode === m));
      b.addEventListener("click", () => {
        const cur = shortCfg();
        lsSet("short", { mode: m, pick: cur.pick.length ? cur.pick : shortList().map(x => x.s) });
        renderShortCard();
      });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    box.appendChild(el("p", "hint", t(c.mode === "manual" ? "ecr.short.manualHint" : "ecr.short.autoHint")));
    if (c.mode !== "manual") return;
    const cur = shortList().map(x => x.s), ok = shortOk();
    for (let i = 0; i < ECR_SHORT_N && i < ok.length; i++) {
      const sel = el("select", "input");
      ok.forEach(x => { const o = el("option", null, x.ic + " " + t(x.k)); o.value = x.s; sel.appendChild(o); });
      sel.value = cur[i] || ok[i].s;
      sel.addEventListener("change", () => {
        const pick = shortList().map(x => x.s);
        const j = pick.indexOf(sel.value);
        if (j >= 0 && j !== i) pick[j] = pick[i];   // échange : jamais deux fois le même raccourci
        pick[i] = sel.value;
        lsSet("short", { mode: "manual", pick });
        renderShortCard();
      });
      box.appendChild(formField(t("ecr.short.slot", { n: i + 1 }), sel));
    }
  }

  // --- Barre du bas et « Plus » ---
  function paintNav() {
    const btns = [...document.querySelectorAll("nav.bottom button[data-nav]")];
    btns.forEach(b => { b.hidden = !ECR_BAR.includes(b.dataset.nav); });
    const more = $("#navMore");
    if (!more) return;
    const hiddenOn = btns.some(b => b.hidden && b.classList.contains("active"));
    const other = ["about", "requests"].includes(currentScreen) || (typeof ADMIN_SCREENS !== "undefined" && ADMIN_SCREENS.includes(currentScreen));
    more.classList.toggle("active", Storage.getUser() ? (hiddenOn || other) : false);
    let n = 0;
    ECR_MORE.forEach(x => {
      if (!x.badge) return;
      const b = $(x.badge);
      if (b && !b.hidden) n += parseInt(b.textContent, 10) || 0;
    });
    const mb = $("#moreBadge");
    if (mb) { mb.hidden = !n; mb.textContent = n > 99 ? "99+" : String(n); }
  }
  // Étape 79 : la liste défile si elle est longue ; « Se déconnecter » reste toujours visible dessous (avec confirmation).
  function openMore() {
    const wrapEl = el("div", "ecr-more-wrap");
    const list = el("div", "ecr-more");
    let close = null;
    ECR_MORE.filter(avail).forEach(x => {
      const b = el("button", "item ecr-more-it" + (x.s === currentScreen ? " on" : ""));
      b.type = "button";
      b.dataset.screen = x.s;
      const ic = el("span", "ecr-more-ic", x.ic);
      ic.setAttribute("aria-hidden", "true");
      const m = el("div", "main");
      m.appendChild(el("div", "t1", t(x.k)));
      b.append(ic, m);
      if (x.badge) {
        const src = $(x.badge);
        if (src && !src.hidden) b.appendChild(el("span", "ecr-more-n", src.textContent));
      }
      b.appendChild(el("span", "chev", "›"));
      b.addEventListener("click", () => { if (close) close(); go(x.s); });
      list.appendChild(b);
    });
    const out = el("button", "item ecr-more-it ecr-logout");
    out.type = "button";
    out.id = "moreLogout";
    const oi = el("span", "ecr-more-ic", "🚪");
    oi.setAttribute("aria-hidden", "true");
    const om = el("div", "main");
    om.appendChild(el("div", "t1", t("account.logout")));
    om.appendChild(el("div", "t2", Storage.getUser() || ""));
    out.append(oi, om);
    out.addEventListener("click", () => { if (close) close(); logoutAsk(); });
    wrapEl.append(list, out);
    close = openModal(t("ecr.more"), wrapEl, [{ label: t("close") }]);
    const bg = document.querySelectorAll(".modal-bg");
    if (bg.length) bg[bg.length - 1].classList.add("ecr-sheet");
  }
  // Confirmation courte avant de se déconnecter depuis « Plus ». Des modifications pas encore envoyées restent sur l'appareil
  // (elles partent à la prochaine connexion de ce compte ici) : la fenêtre le dit.
  function logoutAsk() {
    const body = el("div");
    body.appendChild(el("p", null, t("ecr.logout.text", { id: Storage.getUser() || "" })));
    const unsent = safe(() => { const i = Storage.syncInfo(); return i.remote && (i.unsent || Fusion.dirty()); }, false);
    if (unsent) body.appendChild(el("p", "muted", t("ecr.logout.unsent")));
    openModal(t("ecr.logout.title"), body, [
      { label: t("cancel") },
      { label: t("account.logout"), kind: "danger", onClick: () => { logout(); } }
    ]);
  }

  // --- Branchements (le DOM existe : scripts en fin de <body>) ---
  function bind() {
    const more = $("#navMore");
    if (more) more.addEventListener("click", openMore);
    const due = $("#homeDueCard");
    if (due) {
      due.addEventListener("click", () => go("review"));
      due.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go("review"); } });
    }
    buildSecs();
    paintNav();
  }
  try { bind(); } catch (e) {}

  return { settings, home, folds, paintNav, onShow, openSec, isFullHash, fullSec, search, goFind, openMore, shortList, logoutAsk };
})();
window.App.Ecr = Ecr;
