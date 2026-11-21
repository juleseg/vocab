"use strict";

// ====================================================================================================
// js/fusion.js — FUSION DES APPAREILS (étape 78, DATA_VERSION 9)
// Chargé juste après js/garde-fou.js (avant js/cards.js). Au chargement : seulement Storage.onBeforeSave(Fusion.stamp).
// 1) DATER (Fusion.stamp, avant chaque enregistrement) : chaque carte, liste, dossier personnel et les réglages sont comparés
//    à leur état précédent (gardé en mémoire). Contenu changé → `m` = maintenant ; disparu → pierre tombale (state.tombs).
//    La progression (boîte, dates de révision) n'est pas du contenu : elle porte déjà ses dates. Ce qui a changé depuis la
//    dernière synchro réussie est noté sur l'appareil (clé locale vocabfr.fusion:<compte> : identifiant → `m` d'avant),
//    pour savoir « modifié ici » sans jamais comparer deux horloges. État remplacé d'un coup (version en ligne, import) :
//    rien n'est daté ni supprimé, on repart de lui.
// 2) FUSIONNER (Fusion.merge, appelé par syncWithRemote) : par carte, liste et dossier. Une absence ne supprime jamais :
//    seule une pierre tombale supprime. Modifié des deux côtés, ou supprimé d'un côté et modifié de l'autre = collision :
//    le plus récent gagne (`m` de l'élément, date de la pierre tombale), la version perdante est gardée (Fusion.keep :
//    IndexedDB vocab-copies, type « fusion ») et l'utilisateur est prévenu (Fusion.notify) avec un bouton
//    « Reprendre l'autre version » par élément. Progression : la révision la plus récente par langue. Reste du compte :
//    réunion ou valeur la plus avancée. Listes communes : leurs cartes ne sont pas ici (js/partage.js) ; seule la
//    progression personnelle est fusionnée.
// 3) REMPLACER tout le compte (import, « Garder cet appareil ») : Fusion.replaced pose les pierres tombales de ce qui est retiré.
// ====================================================================================================

const FU_SHOW_MAX = 40;        // éléments affichés dans la fenêtre d'une fusion
const FU_ITEMS_MAX = 300;      // versions perdantes gardées par fusion (au-delà : comptées seulement)
const FU_WAIT_MS = 3000;       // attente de la fin d'une session de révision avant de fusionner

const Fusion = (() => {
  let owner = null, snap = null, snapAt = 0;   // état suivi : objet state, signatures, updatedAt vu
  let st = null, stFor = null;                 // suivi local des modifications non envoyées (clé vocabfr.fusion:<compte>)
  let demoRef = null;                          // liste « Démo » créée pour un compte vide en ligne, pas encore touchée
  let laterTimer = null, laterFn = null;
  let pending = null;                          // dernière fusion avec collisions, pas encore montrée

  // --- Signatures (jsonb ne garde pas l'ordre des champs : JSON aux clés triées, shStable de js/partage.js) ---
  const PROG = ["m", "progress", "box", "dueAt", "stats"];
  function sans(o, keys) { const x = {}; Object.keys(o).forEach(k => { if (!keys.includes(k)) x[k] = o[k]; }); return x; }
  function sigCard(c) { return shStable(sans(c, PROG)); }                 // contenu d'une carte, sans progression
  function sigItem(o) { return shStable(sans(o, ["m"])); }                // liste ou dossier (ordre compris)
  function sigSoft(o) { return shStable(sans(o, ["m", "order"])); }       // liste ou dossier, sans l'ordre (un simple rangement n'est pas une collision)
  function sigSet(s) { return shStable(sans(s || {}, ["m"])); }
  function shared(o) { return typeof isSharedList === "function" && isSharedList(o); }
  function sharedIds(data) { return new Set(arr(data.lists).filter(shared).map(l => l.id)); }
  function mOf(o) { return num(o && o.m, 0); }

  // --- Suivi local : { v, legacy, any, c: { id: m d'avant }, l, f, s } ; -1 = n'existait pas à la dernière synchro ---
  function key() { const u = Storage.getUser(); return u ? CONFIG.LS_USER_PREFIX + "fusion:" + u : null; }
  function load() {
    const u = Storage.getUser();
    if (st && stFor === u) return st;
    stFor = u; st = null;
    const k = key();
    if (k) { try { const v = JSON.parse(localStorage.getItem(k) || "null"); if (v && typeof v === "object" && v.c && v.l && v.f) st = v; } catch (e) {} }
    if (!st) st = { v: 1, legacy: true, any: null, c: {}, l: {}, f: {} };   // appareil d'avant la version 78 : rien de connu
    return st;
  }
  function persist() { const k = key(); if (k && st) { try { localStorage.setItem(k, JSON.stringify(st)); } catch (e) {} } }
  function fresh() { st = { v: 1, legacy: false, any: false, c: {}, l: {}, f: {} }; stFor = Storage.getUser(); }
  // Plus rien en attente : l'appareil et le serveur sont identiques (version en ligne prise, ou identiques).
  function synced() { fresh(); persist(); demoRef = null; }
  function legacy() { return !!load().legacy; }
  // Modifications non envoyées ? old : ancienne règle (dates de l'appareil), seulement pour un appareil d'avant la version 78.
  function dirty(old) { const s = load(); return s.legacy ? (!!old || s.any === true) : !!s.any; }
  function hasItems() { const s = load(); return Object.keys(s.c).length + Object.keys(s.l).length + Object.keys(s.f).length > 0; }
  function userChanged() { owner = null; snap = null; st = null; stFor = null; demoRef = null; pending = null; clearTimeout(laterTimer); laterTimer = null; laterFn = null; }

  // --- 1) Dater ---
  function takeSnap(data) {
    const sh = sharedIds(data), s = { c: new Map(), l: new Map(), f: new Map(), s: sigSet(data.settings) };
    arr(data.cards).forEach(c => { if (!sh.has(c.listId)) s.c.set(c.id, { raw: JSON.stringify(c), sig: sigCard(c), m: mOf(c) }); });
    arr(data.lists).forEach(l => s.l.set(l.id, { sig: sigItem(l), m: mOf(l), sh: shared(l) }));
    arr(data.folders).forEach(f => s.f.set(f.id, { sig: sigItem(f), m: mOf(f), sh: shared(f) }));
    return s;
  }
  function tombsOf(data) { if (!data.tombs || typeof data.tombs !== "object") data.tombs = { c: {}, l: {}, f: {} }; ["c", "l", "f"].forEach(k => { if (!data.tombs[k]) data.tombs[k] = {}; }); return data.tombs; }
  // Nouvel état complet (lecture de l'appareil, version en ligne prise, fusion, import) : on repart de lui, sans rien dater.
  // À appeler dès que state est remplacé : une modification faite avant le premier enregistrement doit être vue.
  function track(data) {
    if (!data || !Array.isArray(data.cards)) { owner = null; snap = null; return; }
    owner = data; snap = takeSnap(data); snapAt = data.updatedAt;
  }
  function stamp(data) {
    try {
      if (!Storage.getUser() || !data || !Array.isArray(data.cards)) return;
      const s = load();
      // État remplacé sans passer par track (ne devrait pas arriver) : on repart de lui, et on considère l'appareil modifié.
      if (data !== owner || !snap) { track(data); if (s.any !== true) { s.any = true; persist(); } return; }
      const now = Date.now(), T = tombsOf(data);
      let touched = false;
      const mark = (K, id, before) => { if (!(id in s[K])) s[K][id] = before; touched = true; };
      const gone = (K, id, p) => {
        const base = id in s[K] ? s[K][id] : p.m;
        delete s[K][id];
        if (base !== -1 && !p.sh) T[K][id] = [now, base];   // jamais envoyé (créé puis supprimé ici), ou commun : pas de pierre tombale
        touched = true;
      };
      const sh = sharedIds(data), seen = new Set(), all = new Set();
      data.cards.forEach(c => {
        all.add(c.id);
        if (sh.has(c.listId)) return;
        seen.add(c.id);
        const p = snap.c.get(c.id), raw = JSON.stringify(c);
        if (p && p.raw === raw) return;
        const sig = sigCard(c);
        if (!p) { mark("c", c.id, -1); c.m = now; delete T.c[c.id]; }
        else if (p.sig !== sig) { mark("c", c.id, p.m); c.m = now; }
        snap.c.set(c.id, { raw: JSON.stringify(c), sig, m: mOf(c) });
      });
      Array.from(snap.c.keys()).forEach(id => {
        if (seen.has(id)) return;
        if (!all.has(id)) gone("c", id, snap.c.get(id));   // encore là mais dans une liste devenue commune : pas une suppression
        snap.c.delete(id);
      });
      [["l", data.lists], ["f", data.folders]].forEach(([K, items]) => {
        const here = new Set();
        arr(items).forEach(o => {
          here.add(o.id);
          const p = snap[K].get(o.id), sig = sigItem(o);
          if (p && p.sig === sig) return;
          if (!p) { mark(K, o.id, -1); o.m = now; delete T[K][o.id]; }
          else { mark(K, o.id, p.m); o.m = now; }
          snap[K].set(o.id, { sig, m: mOf(o), sh: shared(o) });
        });
        Array.from(snap[K].keys()).forEach(id => { if (!here.has(id)) { gone(K, id, snap[K].get(id)); snap[K].delete(id); } });
      });
      const ss = sigSet(data.settings);
      if (ss !== snap.s) { if (!("s" in s)) s.s = mOf(data.settings); data.settings.m = now; snap.s = ss; touched = true; }
      if (data.updatedAt !== snapAt) { snapAt = data.updatedAt; if (s.any !== true) { s.any = true; touched = true; } }
      if (touched) { s.any = true; persist(); }
    } catch (e) { try { if (typeof ErrLog !== "undefined") ErrLog.sync("fusion : stamp " + String((e && e.message) || e).slice(0, 80), e); } catch (x) {} }
  }

  // --- Envoi : ce qui part avec cet envoi n'est plus « modifié ici » une fois l'envoi réussi ---
  function mapM(data, K) { const m = new Map(); (K === "c" ? arr(data.cards) : K === "l" ? arr(data.lists) : arr(data.folders)).forEach(o => m.set(o.id, mOf(o))); return m; }
  function flushStart(data) {
    const s = load(), fl = { at: data.updatedAt, m: {}, s: mOf(data.settings), hadS: "s" in s };
    ["c", "l", "f"].forEach(K => { const ids = Object.keys(s[K]); fl.m[K] = {}; if (ids.length) { const mm = mapM(data, K); ids.forEach(id => { fl.m[K][id] = mm.has(id) ? mm.get(id) : null; }); } });
    return fl;
  }
  function pushed(fl, data) {
    if (!fl || !data) return;
    const s = load(), T = tombsOf(data);
    ["c", "l", "f"].forEach(K => {
      const ids = Object.keys(fl.m[K]);
      if (!ids.length) return;
      const mm = mapM(data, K);
      ids.forEach(id => {
        const sent = fl.m[K][id];
        if (sent === null) { delete s[K][id]; return; }
        if (!mm.has(id)) { delete s[K][id]; if (T[K][id]) T[K][id][1] = sent; return; }   // supprimé pendant l'envoi : la pierre tombale vise la version envoyée
        if (mm.get(id) === sent) delete s[K][id];
        else s[K][id] = sent;                                                             // modifié pendant l'envoi : la version envoyée devient la base
      });
    });
    if (fl.hadS) { if (mOf(data.settings) === fl.s) delete s.s; else s.s = fl.s; }
    s.legacy = false;
    s.any = data.updatedAt !== fl.at || hasItems() || "s" in s;
    persist();
    demoRef = null;
  }

  // --- « Démo » d'un compte vide en ligne : tant qu'elle n'est pas touchée, une version en ligne passe devant ---
  function demo(data) { demoRef = data; }
  function demoOnly(data) { return !!demoRef && demoRef === data && !hasItems(); }

  // --- 2) Fusionner ---
  function byId(a) { const m = new Map(); arr(a).forEach(o => { if (o && o.id) m.set(o.id, o); }); return m; }
  function act(p) { return p ? Math.max(num(p.stats && p.stats.lastSeen, 0), num(p.last, 0)) : 0; }
  // Progression par langue : la révision la plus récente (à égalité : cet appareil).
  function mergeProgress(w, a, b) {
    const pa = a.progress || {}, pb = b.progress || {}, out = {};
    new Set(Object.keys(pa).concat(Object.keys(pb))).forEach(L => { const x = pa[L], y = pb[L]; out[L] = !y ? x : !x ? y : (act(y) > act(x) ? y : x); });
    const o = Object.assign({}, w);
    if (Object.keys(out).length) o.progress = out; else delete o.progress;
    if (!Object.keys(out).length) { const src = act({ stats: b.stats }) > act({ stats: a.stats }) ? b : a; o.box = src.box; o.dueAt = src.dueAt; o.stats = src.stats; }
    return o;
  }
  // Fusion d'une famille (cartes, listes ou dossiers). Renvoie { out: Map, tombs, items, nd, changed }.
  // tie : à dates égales, cet appareil gagne (true) ou la version en ligne (false).
  function mergeKind(K, Lm, Rm, tL, tR, dm, leg, sig, soft, tie) {
    const out = new Map(), tombs = {}, items = [], nd = {};
    let changed = false, dropped = 0;
    const ids = new Set([...Lm.keys(), ...Rm.keys(), ...Object.keys(tL), ...Object.keys(tR)]);
    ids.forEach(id => {
      const a = Lm.get(id), b = Rm.get(id), ta = tL[id], tb = tR[id];
      if (a && b) {
        const put = (w, loser, win) => {
          out.set(id, K === "c" ? mergeProgress(w, a, b) : w);
          if (win === "local") nd[id] = mOf(b); else changed = true;
          if (loser && soft(a) !== soft(b)) items.push({ k: K, id, why: "both", win, other: loser });
        };
        if (sig(a) === sig(b)) { out.set(id, K === "c" ? mergeProgress(a, a, b) : a); return; }
        const isDirty = leg || (id in dm);
        if (!isDirty) put(b, null, "remote");                              // modifié seulement ailleurs
        else if (!leg && mOf(b) === dm[id]) put(a, null, "local");         // modifié seulement ici
        else if (mOf(a) > mOf(b) || (mOf(a) === mOf(b) && tie)) put(a, b, "local");   // des deux côtés : le plus récent
        else put(b, a, "remote");
      } else if (a) {
        if (tb && !shared(a)) {                                                   // supprimé ailleurs
          const isDirty = leg || (id in dm);
          if (mOf(a) > tb[0]) { out.set(id, a); nd[id] = -1; if (isDirty) items.push({ k: K, id, why: "delThere", win: "local", other: null }); }
          else { tombs[id] = tb; changed = true; dropped++; if (isDirty) items.push({ k: K, id, why: "delThere", win: "remote", other: a }); }
        } else { out.set(id, a); nd[id] = -1; }                            // seulement ici, aucune suppression en face : gardé
      } else if (b) {
        if (ta && !shared(b)) {                                            // supprimé ici
          if (mOf(b) > ta[0]) { out.set(id, b); changed = true; items.push({ k: K, id, why: "delHere", win: "remote", other: null }); }
          else { tombs[id] = ta; if (mOf(b) !== ta[1]) items.push({ k: K, id, why: "delHere", win: "local", other: b }); }
        } else { out.set(id, b); changed = true; }                         // seulement ailleurs : pris
      } else {
        tombs[id] = ta && tb ? (ta[0] >= tb[0] ? ta : tb) : (ta || tb);    // supprimé des deux côtés (ou d'un seul, déjà parti) : reste supprimé
      }
    });
    return { out, tombs, items, nd, changed, dropped };
  }
  function unionBy(a, b, idOf) { const m = new Map(); arr(b).forEach(x => m.set(idOf(x), x)); arr(a).forEach(x => m.set(idOf(x), x)); return Array.from(m.values()); }
  function mergeRest(L, R, s, leg, tie) {
    const o = {};
    // Réglages : modifiés d'un seul côté → ce côté ; des deux → le plus récent, langues apprises réunies.
    const sl = L.settings, sr = R.settings;
    if (sigSet(sl) === sigSet(sr)) o.settings = sl;
    else if (!leg && !("s" in s)) o.settings = sr;
    else if (!leg && mOf(sr) === s.s) o.settings = sl;
    else {
      const w = (mOf(sl) > mOf(sr) || (mOf(sl) === mOf(sr) && tie)) ? sl : sr, x = w === sl ? sr : sl;
      o.settings = Object.assign({}, w, { learning: arr(w.learning).concat(arr(x.learning).filter(e => e && !arr(w.learning).some(y => y && y.lang === e.lang))) });
    }
    const hm = new Map();
    arr(R.history).forEach(h => hm.set(h.date, h));
    arr(L.history).forEach(h => { const y = hm.get(h.date); if (!y || num(h.reviewed, 0) >= num(y.reviewed, 0)) hm.set(h.date, h); });
    o.history = Array.from(hm.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    const sa = L.streak || {}, sb = R.streak || {};
    const ahead = (String(sb.lastValidDay || "") > String(sa.lastValidDay || "")) || (String(sb.lastValidDay || "") === String(sa.lastValidDay || "") && num(sb.current, 0) > num(sa.current, 0));
    o.streak = JSON.parse(JSON.stringify(ahead ? sb : sa));
    o.streak.best = Math.max(num(sa.best, 0), num(sb.best, 0));
    o.streak.adjustments = unionBy(sa.adjustments, sb.adjustments, x => x && x.id);
    o.xp = num(R.xp && R.xp.total, 0) > num(L.xp && L.xp.total, 0) ? R.xp : L.xp;
    const hw = {}, ha = (L.hard && L.hard.w) || {}, hb = (R.hard && R.hard.w) || {};
    new Set(Object.keys(ha).concat(Object.keys(hb))).forEach(id => {
      const e = {}, x = ha[id] || {}, y = hb[id] || {};
      new Set(Object.keys(x).concat(Object.keys(y))).forEach(Lg => { e[Lg] = !y[Lg] ? x[Lg] : !x[Lg] ? y[Lg] : (num(y[Lg].n, 0) > num(x[Lg].n, 0) ? y[Lg] : x[Lg]); });
      hw[id] = e;
    });
    const pk = p => p.a + "|" + p.b + "|" + p.L, pm = new Map();
    arr(R.hard && R.hard.c).concat(arr(L.hard && L.hard.c)).forEach(p => { const q = pm.get(pk(p)); if (!q || num(p.n, 0) >= num(q.n, 0)) pm.set(pk(p), p); });
    o.hard = { v: 1, w: hw, c: Array.from(pm.values()) };
    o.tips = Object.assign({}, R.tips || {}, L.tips || {});
    const pa = L.progres || {}, pb = R.progres || {}, f = Object.assign({}, pb.f || {});
    const tot = d => Object.keys((d && d.g) || {}).reduce((n, k) => n + num(d.g[k][0], 0), 0);
    Object.keys(pa.f || {}).forEach(day => { if (!f[day] || tot(pa.f[day]) >= tot(f[day])) f[day] = pa.f[day]; });
    o.progres = { v: 1, s: [pa.s, pb.s].filter(Boolean).sort()[0] || "", m: [pa.m, pb.m].filter(Boolean).sort().pop() || "", l: arr(pb.l).concat(arr(pa.l)), f };
    const sm = new Map();
    arr(R.sentences).forEach(x => sm.set(x.id, x));
    arr(L.sentences).forEach(x => { const y = sm.get(x.id); if (!y || !(y.status === "done" && x.status !== "done")) sm.set(x.id, x); });
    o.sentences = Array.from(sm.values());
    o.stories = {};
    new Set(Object.keys(L.stories || {}).concat(Object.keys(R.stories || {}))).forEach(id => { o.stories[id] = unionBy((L.stories || {})[id], (R.stories || {})[id], x => x && x.id); });
    o.proposals = unionBy(L.proposals, R.proposals, x => x && x.id);
    o.rejected = Array.from(new Set(arr(R.rejected).concat(arr(L.rejected))));
    o.checkedSig = Object.assign({}, R.checkedSig || {}, L.checkedSig || {});
    o.lastCheckAt = Math.max(num(L.lastCheckAt, 0), num(R.lastCheckAt, 0));
    o.aiResume = L.aiResume || null;
    // Listes communes : progression personnelle, la révision la plus récente par carte (6e case = dernière vue).
    const spA = typeof sharedProgressOf === "function" ? sharedProgressOf(L) : (L.sharedProgress || {}), spB = R.sharedProgress || {};
    o.sharedProgress = {};
    new Set(Object.keys(spA).concat(Object.keys(spB))).forEach(U => {
      const x = spA[U] || {}, y = spB[U] || {}, e = {};
      new Set(Object.keys(x).concat(Object.keys(y))).forEach(cid => { e[cid] = !y[cid] ? x[cid] : !x[cid] ? y[cid] : (num(y[cid][5], 0) > num(x[cid][5], 0) ? y[cid] : x[cid]); });
      o.sharedProgress[U] = e;
    });
    return o;
  }
  function nameOf(K, o) {
    if (!o) return "";
    if (K !== "c") return String(o.name || "");
    try {
      if (o.type && o.type !== "vocab") return String(cardTitle(o) || "").slice(0, 80);
      return Object.keys(o.terms || {}).slice(0, 2).map(k => o.terms[k]).join(" · ").slice(0, 80) || "—";
    } catch (e) { return "—"; }
  }
  // L : état de l'appareil ; R : version en ligne (déjà passée par normalizeData). Ne modifie ni L ni R.
  // Renvoie { data (à passer par normalizeData, déjà fait), items, changed (l'appareil reçoit quelque chose), nd (nouveau suivi), dropped }.
  function merge(L, R) {
    const s = load(), leg = !!s.legacy;
    const shL = sharedIds(L);
    const persL = arr(L.cards).filter(c => !shL.has(c.listId));
    const tL = L.tombs || { c: {}, l: {}, f: {} }, tR = R.tombs || { c: {}, l: {}, f: {} };
    // Dates égales : cet appareil. Appareil d'avant la version 78 (aucune date par carte) : à défaut, le côté dont le dernier
    // changement est le plus récent (seul cas où deux horloges sont comparées ; la version écartée est gardée et signalée).
    const tie = !leg || num(L.updatedAt, 0) >= num(R.updatedAt, 0);
    const C = mergeKind("c", byId(persL), byId(R.cards), tL.c || {}, tR.c || {}, s.c, leg, sigCard, sigCard, tie);
    const Li = mergeKind("l", byId(L.lists), byId(R.lists), tL.l || {}, tR.l || {}, s.l, leg, sigItem, sigSoft, tie);
    const F = mergeKind("f", byId(L.folders), byId(R.folders), tL.f || {}, tR.f || {}, s.f, leg, sigItem, sigSoft, tie);
    const items = C.items.concat(Li.items);   // dossiers : le plus récent, sans message
    let changed = C.changed || Li.changed || F.changed;
    // Carte gardée dont la liste est supprimée : la liste revient si la carte est plus récente que la suppression,
    // sinon la carte part avec la liste (version gardée en copie).
    const lists0 = new Map([...byId(R.lists), ...byId(L.lists)]), revived = new Set();
    Array.from(C.out.values()).forEach(c => {
      if (Li.out.has(c.listId)) return;
      const t = Li.tombs[c.listId], lo = lists0.get(c.listId);
      if (!lo) return;                                                     // liste inconnue des deux côtés : normalizeData la range dans « Import »
      if (!t || mOf(c) > t[0]) {
        Li.out.set(lo.id, lo); delete Li.tombs[lo.id]; Li.nd[lo.id] = -1;
        if (t && !revived.has(lo.id)) { revived.add(lo.id); items.push({ k: "l", id: lo.id, why: "revived", win: "local", other: null }); }
      } else {
        C.out.delete(c.id); C.tombs[c.id] = [t[0], mOf(c)]; delete C.nd[c.id];
        items.push({ k: "c", id: c.id, why: "listGone", win: "remote", other: c, list: lo });
      }
    });
    Li.out.forEach(l => { if (l.folderId && !F.out.has(l.folderId)) Li.out.set(l.id, Object.assign({}, l, { folderId: null })); });
    const rest = mergeRest(L, R, s, leg, tie);
    if (sigSet(rest.settings) !== sigSet(L.settings)) changed = true;
    items.forEach(it => {
      const src = it.k === "c" ? (C.out.get(it.id) || it.other) : (Li.out.get(it.id) || it.other);
      it.name = nameOf(it.k, src);
      if (it.k === "c" && src) { const lo = Li.out.get(src.listId) || lists0.get(src.listId); it.ln = lo ? String(lo.name || "") : ""; if (!it.list && lo && it.other) it.list = lo; }
    });
    const raw = Object.assign({ version: DATA_VERSION, updatedAt: num(L.updatedAt, 0) }, rest, {
      cards: Array.from(C.out.values()), lists: Array.from(Li.out.values()), folders: Array.from(F.out.values()),
      tombs: { c: C.tombs, l: Li.tombs, f: F.tombs }
    });
    const data = normalizeData(JSON.parse(JSON.stringify(raw)));
    const nd = { c: C.nd, l: Li.nd, f: F.nd };
    if (sigSet(data.settings) !== sigSet(R.settings)) nd.s = mOf(R.settings);
    const goneR = arr(R.cards).filter(c => !C.out.has(c.id)).length;   // cartes en ligne retirées par cet appareil (garde-fou)
    return { data, items, changed, nd, dropped: C.dropped, goneR, n: { local: persL.length, remote: arr(R.cards).length, merged: data.cards.length } };
  }
  // Après une fusion appliquée : ce que l'appareil a de plus que la version en ligne lue reste « modifié ici ».
  function merged(res) {
    st = Object.assign({ v: 1, legacy: false, any: true }, res.nd); stFor = Storage.getUser();
    persist();
    demoRef = null;
  }

  // --- Versions perdantes : gardées avant d'appliquer la fusion (IndexedDB, type « fusion ») ---
  // Renvoie true si la copie est faite (ou s'il n'y a rien à garder).
  async function keep(res, acc) {
    if (!res.items.length) return true;
    const rec = { fusion: 1, at: Date.now(), total: res.items.length, items: res.items.slice(0, FU_ITEMS_MAX) };
    const id = await Guard.backup("fusion", rec, acc, "", { lists: res.items.filter(i => i.k === "l").length, cards: res.items.filter(i => i.k === "c").length });
    if (!id) return false;
    pending = { id, rec };
    return true;
  }
  function count(rec) { return num(rec && rec.total, arr(rec && rec.items).length); }

  // --- Message à l'utilisateur ---
  function notify(res) {
    const who = Storage.getUser();
    if (pending && count(pending.rec)) {
      const p = pending; pending = null;
      whenNoModal(() => Storage.getUser() === who).then(ok => { if (ok) openRec(p.id, p.rec); });
    } else if (res && res.changed) toast(t("fu.done"));
  }
  function whyText(it) {
    const kind = it.k === "l" ? "l" : "c";
    return t("fu.why." + kind + "." + it.why + "." + (it.taken ? (it.win === "local" ? "remote" : "local") : it.win));
  }
  function row(it, recId, rec, redraw) {
    const line = el("div", "fu-row");
    const txt = el("div", "fu-row-t");
    txt.appendChild(el("strong", null, (it.k === "l" ? "📁 " : "") + (it.name || "—")));
    if (it.ln) txt.appendChild(el("span", "muted", " · " + it.ln));
    txt.appendChild(el("div", "muted", whyText(it)));
    line.appendChild(txt);
    if (it.why !== "revived" && !(it.k === "l" && it.why !== "both")) {
      const b = el("button", "btn fu-take", t(it.taken ? "fu.back" : "fu.take"));
      b.addEventListener("click", () => {
        if (!takeOther(it)) { toast(t("fu.takeErr")); return; }
        Guard.copyPut(recId, rec).catch(() => {});
        toast(t("fu.taken"));
        redraw();
      });
      line.appendChild(b);
    }
    return line;
  }
  function openRec(recId, rec) {
    const wrap = el("div", "fu-box");
    const draw = () => {
      wrap.textContent = "";
      const items = arr(rec.items), n = count(rec);
      const nl = items.filter(i => i.k === "l").length, nc = n - nl;
      if (nc) wrap.appendChild(el("p", "fu-main", t(nc === 1 ? "fu.text1" : "fu.text", { n: nc })));
      if (nl) wrap.appendChild(el("p", "fu-main", t(nl === 1 ? "fu.textL1" : "fu.textL", { n: nl })));
      wrap.appendChild(el("p", "muted", t("fu.hint")));
      const list = el("div", "fu-list");
      items.slice(0, FU_SHOW_MAX).forEach(it => list.appendChild(row(it, recId, rec, draw)));
      wrap.appendChild(list);
      if (n > FU_SHOW_MAX) wrap.appendChild(el("p", "muted", t("fu.more", { n: n - FU_SHOW_MAX })));
    };
    draw();
    openModal(t("fu.title"), wrap, [{ label: t("close"), kind: "primary" }]);
  }
  // « Reprendre l'autre version » d'un élément (et retour possible). Renvoie false si rien n'a pu être fait.
  function takeOther(it) {
    try {
      const strip = c => Object.assign({}, c);
      if (it.k === "l") {
        const i = state.lists.findIndex(l => l.id === it.id);
        if (i < 0 || !it.other) return false;
        const cur = state.lists[i];
        state.lists[i] = Object.assign({}, it.other, { order: cur.order, folderId: state.folders.some(f => f.id === it.other.folderId) ? it.other.folderId : null });
        it.other = cur;
      } else {
        const i = state.cards.findIndex(c => c.id === it.id);
        if (it.other) {
          const o = normalizeCard(strip(it.other));
          if (!state.lists.some(l => l.id === o.listId)) {
            if (!it.list) return false;
            state.lists.push(Object.assign({}, it.list, { folderId: state.folders.some(f => f.id === it.list.folderId) ? it.list.folderId : null, order: state.lists.length }));
          }
          if (i >= 0) {                                   // les deux versions existent : contenu échangé, progression gardée
            const cur = state.cards[i];
            ["progress", "box", "dueAt", "stats"].forEach(k => { if (cur[k] !== undefined) o[k] = cur[k]; else delete o[k]; });
            state.cards[i] = o; it.other = strip(cur);
          } else { state.cards.push(o); it.other = null; }   // la carte avait été supprimée : elle revient
        } else {
          if (i < 0) return false;
          it.other = strip(state.cards[i]);               // l'autre version était « supprimée » : la carte est supprimée (et gardée ici)
          it.list = state.lists.find(l => l.id === it.other.listId) || it.list || null;
          state.cards.splice(i, 1);
          Guard.noteDeleted(1);
        }
      }
      it.taken = !it.taken;
      commit();
      return true;
    } catch (e) { return false; }
  }
  // Réglages → Compte et données → « Fusions récentes ».
  async function openList() {
    const who = Storage.getUser();
    if (!who) return;
    let rows = [];
    try { rows = await withTimeout(Guard.copies("fusion"), 8000); } catch (e) { rows = []; }
    if (Storage.getUser() !== who) return;
    const wrap = el("div", "fu-box");
    wrap.appendChild(el("p", "muted", t("fu.listHint", { n: GF_FUSION_MAX })));
    if (!rows.length) wrap.appendChild(el("p", null, t("fu.none")));
    let close = null;
    rows.forEach(r => {
      let rec = null; try { rec = JSON.parse(r.json); } catch (e) {}
      if (!rec || !rec.fusion) return;
      let when = ""; try { when = new Date(r.at).toLocaleString(state.settings.uiLang); } catch (e) { when = String(r.at); }
      const b = el("button", "btn fu-open", when + " · " + t("fu.count", { n: count(rec) }));
      b.addEventListener("click", () => { if (close) close(); setTimeout(() => openRec(r.id, rec), 0); });
      wrap.appendChild(b);
    });
    close = openModal(t("fu.listTitle"), wrap, [{ label: t("close") }]);
  }

  // --- 3) Tout le compte remplacé par next (import, « Garder cet appareil ») : pierres tombales de ce qui est retiré ---
  // prev : ce qui est remplacé (version en ligne ou état d'avant). all : dater « maintenant » tout ce qui est importé.
  function replaced(prev, next, all) {
    if (!next) return;
    const now = Date.now(), T = tombsOf(next);
    const shP = prev ? sharedIds(prev) : new Set(), shN = sharedIds(next);
    const set = (K, pa, na, skipP) => {
      const have = new Set(arr(na).map(o => o.id));
      arr(pa).forEach(o => { if (o && o.id && !have.has(o.id) && !skipP(o)) T[K][o.id] = [now, mOf(o)]; });
      have.forEach(id => { delete T[K][id]; });
    };
    if (prev) {
      set("c", prev.cards, next.cards, c => shP.has(c.listId));
      set("l", prev.lists, next.lists, shared);
      set("f", prev.folders, next.folders, shared);
      const pt = prev.tombs || {};
      ["c", "l", "f"].forEach(K => { const have = new Set((K === "c" ? arr(next.cards) : K === "l" ? arr(next.lists) : arr(next.folders)).map(o => o.id)); Object.keys(pt[K] || {}).forEach(id => { if (!have.has(id) && !T[K][id]) T[K][id] = pt[K][id]; }); });
    }
    if (all) {
      arr(next.cards).forEach(c => { if (!shN.has(c.listId)) c.m = now; });
      arr(next.lists).forEach(l => { l.m = now; });
      arr(next.folders).forEach(f => { f.m = now; });
      if (next.settings) next.settings.m = now;
    }
  }

  // --- Session de révision en cours : la fusion attend (les cartes de la session ne doivent pas changer sous les doigts) ---
  // De même pendant un traitement qui tient l'objet state : « À valider » (pvJob), Claude en direct (aiJob), réponses de la
  // file en cours de récupération (Queue.busy) : state n'est jamais remplacé au milieu.
  function inSession() {
    try {
      if (typeof rv !== "undefined" && rv && rv.phase === "run" && currentScreen === "review") return true;
      if (typeof pvJob !== "undefined" && pvJob) return true;
      if (typeof aiJob !== "undefined" && aiJob) return true;
      if (typeof Queue !== "undefined" && Queue.busy()) return true;
    } catch (e) {}
    return false;
  }
  function later(fn) {
    laterFn = fn;
    if (laterTimer) return;
    const who = Storage.getUser();
    const tick = () => {
      laterTimer = null;
      if (Storage.getUser() !== who || !laterFn) { laterFn = null; return; }
      if (inSession()) { laterTimer = setTimeout(tick, FU_WAIT_MS); return; }
      const f = laterFn; laterFn = null;
      try { f(); } catch (e) {}
    };
    laterTimer = setTimeout(tick, FU_WAIT_MS);
  }

  return {
    track, stamp, synced, legacy, dirty, userChanged, flushStart, pushed, demo, demoOnly,
    merge, merged, keep, notify, openList, replaced, inSession, later,
    state: () => load()   // lecture seule (tests, diagnostic)
  };
})();

Storage.onBeforeSave(data => Fusion.stamp(data));   // contenu modifié → daté ; disparu → pierre tombale
