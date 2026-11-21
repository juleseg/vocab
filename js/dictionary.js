"use strict";

// === DICTIONNAIRE COMMUN (ÉTAPE 36) ===
// Un sens (ex. « arbre », « voler = fly », « voler = steal ») n'est rempli qu'une fois pour tous les comptes.
// Mode Supabase seulement (script supabase-etape36.sql). Sans le script, ou hors Supabase : rien ne change (version 35).
//
// Carte de vocabulaire reliée : champ senseId (id du sens) et own (cases « version perso »).
//  - Les valeurs affichées restent dans la carte (terms, pos, examples) : c'est la copie locale du sens, utilisée
//    partout (révision, listes, complétion…) et hors connexion.
//  - Clés de case : "w:<langue>" (mot), "p:<langue>" (nature), "e:<langue>" (exemple dans cette langue),
//    "t:<langue>:<langue2>" (traduction de cet exemple).
//  - own = cases où la carte garde sa propre valeur : elle n'est pas remplacée par celle du sens. Une case devient
//    « perso » quand on modifie une valeur déjà remplie du commun (la modification part aussi comme proposition),
//    ou quand une valeur de la carte attend d'être envoyée au commun ; elle redevient commune dès que les deux
//    valeurs sont égales (proposition validée par l'admin, case remplie).
//  - Versions connues des sens : localStorage "vocabfr.dict:known:<compte>" (on ne relit que les sens qui ont changé).
//  - Cases à envoyer au commun : file localStorage "vocabfr.dict:out:<compte>" (gardée hors connexion, envoyée ensuite).
// Fonctions SQL : dict_search, dict_get, dict_create, dict_fill, dict_propose (voir le script).
//
// Déroulé :
//  - au lancement, toutes les 10 min et au retour dans l'appli (2 min mini) : envoi de la file, liaison des cartes
//    pas encore reliées (migration, par lots de 50 avec barre de progression au-delà de 30 cartes, reprise possible),
//    puis lecture des sens modifiés et mise à jour des cartes. Jamais pendant une session de révision.
//  - ajout d'une carte (éditeur, import, génération acceptée, copie reçue) : recherche des sens du mot ;
//    un seul sens probable → relié, cases vides remplies (marquées « auto ») ; aucun → nouveau sens ;
//    plusieurs (étape 63, faux doublon) → JAMAIS de fenêtre de choix : la carte garde ses valeurs (own), reliée au sens
//    le plus proche s'il est clair (le plus de traductions en commun), sinon sans lien ; le cas est signalé au serveur
//    (dict_conflict_report, une fois par mot et par groupe de sens). Même règle pour la migration des cartes existantes.
//  - faux doublons (étape 63) : liste de mes cartes en conflit relue à chaque cycle (dict_conflict_mine, gardée sur
//    l'appareil « vocabfr.dict:conf:<compte> ») : ces cartes ne sont pas reliées par la migration ; le sens choisi par
//    l'admin (fusion, « Relier la carte ») est appliqué puis confirmé (dict_conflict_ack). Repère et « Faire une
//    proposition » : js/doublons.js. Script de l'étape 63 absent : comme avant (sans fenêtre ; doute → nouveau sens).
//  - valeur saisie à la main ou acceptée dans « À valider » (Dict.track / Dict.changed) : case vide du commun → remplie ;
//    case déjà remplie avec une autre valeur → gardée chez moi (own) et proposée à l'admin.
//  - complétion (Claude, file d'attente, fichier, Mettre à jour) : Dict.fillFromCommon d'abord (immédiat).

// --- Normalisation (même règle que dict_norm() dans le SQL) ---
const DICT_ACC_SRC = "àáâãäåāăąǎçćĉčďđèéêëēĕėęěìíîïĩīĭįǐñńņňòóôõöøōŏőǒùúûüũūŭůűųǔýÿŷźżžşșśšţțğłŕřĺľÀÁÂÃÄÅĀĂĄǍÇĆĈČĎĐÈÉÊËĒĔĖĘĚÌÍÎÏĨĪĬĮǏÑŃŅŇÒÓÔÕÖØŌŎŐǑÙÚÛÜŨŪŬŮŰŲǓÝŸŶŹŻŽŞȘŚŠŢȚĞŁŔŘĹĽ";
const DICT_ACC_DST = "aaaaaaaaaaccccddeeeeeeeeeiiiiiiiiinnnnoooooooooouuuuuuuuuuuyyyzzzssssttglrrllaaaaaaaaaaccccddeeeeeeeeeiiiiiiiiinnnnoooooooooouuuuuuuuuuuyyyzzzssssttglrrll";
const DICT_ACC = (() => { const m = {}; const s = Array.from(DICT_ACC_SRC), d = Array.from(DICT_ACC_DST); s.forEach((ch, i) => { m[ch] = d[i]; }); return m; })();
const DICT_TRIM = " .,;:!?¡¿\"«»()[]";
function dictNorm(s) {
  let x = String(s == null ? "" : s).normalize("NFC")
    .replace(/[œŒ]/g, "oe").replace(/[æÆ]/g, "ae").replace(/ß/g, "ss").replace(/[’‘]/g, "'").replace(/\u00A0/g, " ").replace(/İ/g, "i");
  x = Array.from(x).map(ch => DICT_ACC[ch] || ch).join("").toLowerCase().replace(/\s+/g, " ");
  let a = 0, b = x.length;
  while (a < b && DICT_TRIM.includes(x[a])) a++;
  while (b > a && DICT_TRIM.includes(x[b - 1])) b--;
  return x.slice(a, b);
}
function dictNorms(s) { return [...new Set(String(s == null ? "" : s).split("/").map(dictNorm).filter(Boolean))]; }
function dictOverlap(a, b) { return a.some(x => b.includes(x)); }
function dictClean(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }

// --- Cases d'une carte / d'un sens ---
function dictKeyOk(k) {
  const p = String(k || "").split(":");
  if (p[0] === "t") return p.length === 3 && isLang(p[1]) && isLang(p[2]);
  return p.length === 2 && ["w", "p", "e"].includes(p[0]) && isLang(p[1]);
}
// Valeurs d'une carte : { "w:fr": "arbre", "p:fr": "nm", "e:ko": "…", "t:ko:fr": "…" }
function dictCardVals(c) {
  const o = {};
  if (!c) return o;
  const tm = c.terms || {}, pm = c.pos || {};
  Object.keys(tm).forEach(L => { const v = dictClean(tm[L]); if (v && isLang(L)) o["w:" + L] = v; });
  Object.keys(pm).forEach(L => { const v = dictClean(pm[L]); if (v && isLang(L)) o["p:" + L] = v; });
  const m = exMap(c);
  if (m && Object.keys(m).length) {
    Object.keys(m).forEach(L => {
      if (!isLang(L)) return;
      const e = exEntry(c, L);
      if (!e) return;
      const tx = dictClean(e.text); if (tx) o["e:" + L] = tx;
      Object.keys(e.tr).forEach(C => { const v = dictClean(e.tr[C]); if (v && isLang(C)) o["t:" + L + ":" + C] = v; });
    });
  } else if (c.example && dictClean(c.example)) {
    try { o["e:" + cardLangs(c).target] = dictClean(c.example); } catch (e) {}
  }
  return o;
}
// Valeurs d'un sens ({ fr: { w, p, e, t: { en } } }) au même format.
function dictSenseVals(vals) {
  const o = {};
  if (!vals || typeof vals !== "object") return o;
  Object.keys(vals).forEach(L => {
    const v = vals[L];
    if (!isLang(L) || !v || typeof v !== "object") return;
    if (v.w) o["w:" + L] = dictClean(v.w);
    if (v.p) o["p:" + L] = dictClean(v.p);
    if (v.e) o["e:" + L] = dictClean(v.e);
    if (v.t && typeof v.t === "object") Object.keys(v.t).forEach(C => { if (isLang(C) && v.t[C]) o["t:" + L + ":" + C] = dictClean(v.t[C]); });
  });
  return o;
}
function dictSame(k, a, b) {
  if (k[0] === "w") { const x = dictNorms(a).sort().join("|"), y = dictNorms(b).sort().join("|"); return x === y; }
  return dictClean(a) === dictClean(b);
}
// Valeur acceptée par le commun ? (nature : code connu ; tailles : 120 / 300 caractères)
function dictSendable(k, v) {
  v = dictClean(v);
  if (!v || !dictKeyOk(k)) return false;
  if (k[0] === "p") return POS_CODES.includes(v);
  return v.length <= (k[0] === "w" ? 120 : 300);
}
// Écrit une case dans la carte (copie des objets, exemple « example » gardé à jour pour la langue apprise).
function dictSetKey(c, k, v) {
  const p = k.split(":");
  v = dictClean(v);
  if (p[0] === "w") { c.terms = Object.assign({}, c.terms); if (v) c.terms[p[1]] = v; else delete c.terms[p[1]]; return; }
  if (p[0] === "p") { c.pos = Object.assign({}, c.pos); if (v) c.pos[p[1]] = v; else delete c.pos[p[1]]; return; }
  const T = cardLangs(c).target;
  const m = exMap(c);
  if ((!m || !Object.keys(m).length) && c.example) c.examples = { [T]: { text: String(c.example), tr: {} } };   // ancien champ seul : rangé sous la langue apprise
  if (p[0] === "e") setExPart(c, p[1], null, v, p[1] === T);
  else setExPart(c, p[1], p[2], v);
}
// Case « générée, non validée » (c.auto, même format que « À valider ») d'une case du commun, ou null.
function dictAutoKey(c, k) {
  const p = k.split(":");
  if (p[0] === "w") return "terms." + p[1];
  if (p[0] === "p") return "pos." + p[1];
  const T = cardLangs(c).target;
  if (p[0] === "e") return p[1] === T ? "example" : null;
  return p[1] === T ? "extr." + p[2] : null;
}
function dictMarkAuto(c, k) {
  if (!dictShownKey(c, k)) return;            // langue cachée : gardée sans marque
  const a = dictAutoKey(c, k);
  if (!a) return;
  if (!Array.isArray(c.auto)) c.auto = [];
  if (!c.auto.includes(a)) c.auto.push(a);
}
function dictSetOwn(c, set) { const o = [...set].filter(dictKeyOk); if (o.length) c.own = o; else delete c.own; }
// Case → élément envoyé à dict_fill / dict_propose
function dictItem(k, v) {
  const p = k.split(":");
  const f = { w: "word", p: "pos", e: "ex", t: "tr" }[p[0]];
  const o = { l: p[1], f, v: dictClean(v) };
  if (p[0] === "t") o.t = p[2];
  return o;
}
// Valeurs d'une carte pour créer un sens : { vals, skipped (cases non acceptées par le commun) }
function dictValsFromCard(c) {
  const cv = dictCardVals(c), vals = {}, skipped = [];
  Object.keys(cv).forEach(k => {
    if (!dictSendable(k, cv[k])) { skipped.push(k); return; }
    const p = k.split(":"), L = p[1];
    if (!vals[L]) { if (Object.keys(vals).length >= 12) { skipped.push(k); return; } vals[L] = {}; }
    if (p[0] === "w") vals[L].w = cv[k];
    else if (p[0] === "p") vals[L].p = cv[k];
    else if (p[0] === "e") vals[L].e = cv[k];
    else { vals[L].t = vals[L].t || {}; vals[L].t[p[2]] = cv[k]; }
  });
  return { vals, skipped };
}
// Langues où chercher une carte, dans l'ordre : langue apprise, langues affichées, puis les autres mots de la carte.
function dictQueryLangs(c) {
  let lg;
  try { lg = cardLangs(c); } catch (e) { return []; }
  return [lg.target].concat(lg.support, Object.keys(c.terms || {}))
    .filter((x, i, a) => a.indexOf(x) === i && isLang(x) && dictClean(term(c, x)));
}
// Mot cherché en premier pour une carte : { L, w } ou null (aucun mot).
function dictQueryOf(c) {
  const L = dictQueryLangs(c)[0];
  return L ? { L, w: dictClean(term(c, L)) } : null;
}
// Case visible pour cette carte ? (langue apprise ou langue affichée) — seules ces cases sont marquées « auto ».
function dictShownKey(c, k) {
  let lg;
  try { lg = cardLangs(c); } catch (e) { return false; }
  const p = k.split(":"), shown = [lg.target].concat(lg.support);
  if (p[0] === "t") return p[1] === lg.target && shown.includes(p[2]);
  if (p[0] === "e") return p[1] === lg.target;
  if (shown.includes(p[1])) return true;
  return isVocab(c) && studyVisibleLangs(c.listId).includes(p[1]);   // langues étudiées en plus de la liste (étape 37)
}
// Compatibilité carte / sens : -1 si un mot diffère dans une langue remplie des deux côtés ; sinon nombre de
// langues (hors langue cherchée) où le mot est le même.
function dictCompat(cv, vals, qL) {
  let n = 0;
  for (const L of Object.keys(vals || {})) {
    const a = cv["w:" + L], b = vals[L] && vals[L].w;
    if (!a || !b) continue;
    if (!dictOverlap(dictNorms(a), dictNorms(b))) return -1;
    if (L !== qL) n++;
  }
  return n;
}
// Choix automatique : un sens (probable), "new" (aucun sens compatible) ou, quand plusieurs sens conviennent (faux
// doublon, étape 63), { ambig: [sens compatibles], best: sens le plus proche s'il est clair (le plus de traductions en
// commun, sans égalité), sinon null }.
function dictDecide(cv, senses, qL) {
  const sc = arr(senses).map(s => ({ s, n: dictCompat(cv, s.vals, qL) })).filter(x => x.n >= 0);
  if (!sc.length) return "new";
  if (sc.length === 1) return sc[0].s;
  const max = Math.max(...sc.map(x => x.n));
  const top = sc.filter(x => x.n === max);
  return { ambig: sc.map(x => x.s), best: max > 0 && top.length === 1 ? top[0].s : null };
}
// Aperçu d'un sens (choix entre homonymes, éditeur, admin) : mot dans la langue cherchée, puis traductions.
function dictSenseNode(s, langs, qL) {
  const v = (s && s.vals) || {};
  const n = el("div", "dict-sense");
  const h = el("div", "dict-w", (v[qL] && v[qL].w) || "—"); h.lang = qL;
  if (v[qL] && v[qL].p) h.appendChild(el("span", "pos", posLabel(v[qL].p, qL)));
  n.appendChild(h);
  const shown = arr(langs).filter(L => L !== qL && v[L] && v[L].w);
  const more = Object.keys(v).filter(L => isLang(L) && L !== qL && !shown.includes(L) && v[L].w).slice(0, Math.max(0, 3 - shown.length));
  const sub = shown.concat(more).map(L => L.toUpperCase() + " " + v[L].w).join(" · ");
  if (sub) n.appendChild(el("div", "dict-sub", sub));
  return n;
}

const Dict = (() => {
  const POLL_MS = 10 * 60000;   // relecture des sens modifiés
  const BACK_MS = 2 * 60000;    // retour dans l'appli : au plus toutes les 2 min
  const GET_N = 300, SEARCH_N = 50, CREATE_N = 50, FILL_N = 200, PROP_N = 50;
  const MIG_N = 50;             // cartes par lot de migration
  const MIG_SILENT = 30;        // jusqu'à 30 cartes : liaison discrète, sans barre de progression
  let status = "unknown";       // unknown | ok | missing (script pas lancé) | off (compte bloqué)
  let timer = null, cycling = false, lastCycle = 0, flushing = false, outTimer = null, migJob = null, barHidden = false, limitWarned = false;
  let token = 0;
  // Faux doublons (étape 63) : fonctions SQL à part (script de l'étape 63) ; absentes → « missing » sans toucher au reste.
  const CONF_N = 50;            // cartes signalées par appel
  let confStatus = "unknown";   // unknown | ok | missing
  let confReady = false;        // liste de mes cartes en conflit relue pendant cette session (avant toute migration)

  function usable() { return auth.mode === "supabase" && !!auth.sbUid && !!Supa.client() && !!Storage.getUser(); }
  function on() { return usable() && status !== "missing" && status !== "off"; }
  function isMissing(e) { return alIsMissing(e); }
  function errKind(e) {
    if (isMissing(e)) return "missing";
    if (String((e && e.hint) || "") === "limit") return "limit";
    if (String((e && e.code) || "") === "42501") return "off";
    if (sbErrKind(e) === "net") return "net";
    return "server";
  }
  async function rpc(name, args) {
    try {
      const r = await withTimeout(Supa.client().rpc(name, args || {}), 20000);
      if (r && r.error) throw r.error;
      if (status === "unknown") status = "ok";
      return r ? r.data : null;
    } catch (e) {
      const k = errKind(e);
      if (k === "missing") status = "missing";
      else if (k === "off") status = "off";
      else if (k === "limit" && !limitWarned) { limitWarned = true; toast(t("dict.limit")); }
      throw e;
    }
  }
  function editable(c) { return !!c && isVocab(c) && !!getList(c.listId) && canEditList(c.listId); }
  function inSession() { try { return rv && rv.phase === "run"; } catch (e) { return false; } }
  function save(rerender) {
    state.updatedAt = Date.now();
    Storage.save(state);
    if (rerender && !inSession() && ["lists", "home", "stats", "pending"].includes(currentScreen)) renderScreen();
  }

  // --- Versions connues ---
  function knownKey() { return CONFIG.LS_USER_PREFIX + "dict:known:" + (Storage.getUser() || ""); }
  let known = null, knownUser = null;
  function knownMap() {
    const u = Storage.getUser();
    if (known && knownUser === u) return known;
    knownUser = u; known = {};
    try { const o = JSON.parse(localStorage.getItem(knownKey()) || "{}"); if (o && typeof o === "object") known = o; } catch (e) {}
    return known;
  }
  function knownSave() {
    try {
      const live = new Set(state.cards.map(c => c.senseId).filter(Boolean));
      Object.keys(known || {}).forEach(id => { if (!live.has(id)) delete known[id]; });
      localStorage.setItem(knownKey(), JSON.stringify(known || {}));
    } catch (e) {}
  }

  // --- File des cases à envoyer : [{ q, c (carte), s (sens), k (case), v (valeur), p (1 = proposer si déjà remplie) }] ---
  function outKey() { return CONFIG.LS_USER_PREFIX + "dict:out:" + (Storage.getUser() || ""); }
  function outLoad() { try { return arr(JSON.parse(localStorage.getItem(outKey()) || "[]")); } catch (e) { return []; } }
  function outStore(list) { try { if (list.length) localStorage.setItem(outKey(), JSON.stringify(list.slice(-5000))); else localStorage.removeItem(outKey()); } catch (e) {} }
  function queue(items) {
    if (!items.length) return;
    const list = outLoad();
    items.forEach(o => {
      const i = list.findIndex(x => x.c === o.c && x.k === o.k);
      const it = Object.assign({ q: uid() }, o, { p: o.p || (i >= 0 ? list[i].p : 0) });
      if (i >= 0) list[i] = it; else list.push(it);
    });
    outStore(list);
  }
  function flushSoon() { clearTimeout(outTimer); outTimer = setTimeout(() => { flush().catch(() => {}); }, 3000); }

  // Envoie la file : cases vides remplies, sinon (case modifiée à la main) proposition à l'admin.
  async function flush() {
    if (!on() || flushing) return;
    let list = outLoad();
    if (!list.length) return;
    flushing = true;
    const st = state;
    try {
      while (list.length) {
        const part = list.slice(0, FILL_N);
        const res = arr(await rpc("dict_fill", { p_items: part.map((o, i) => Object.assign({ k: i, s: o.s }, dictItem(o.k, o.v))) }));
        if (state !== st) return;
        const cards = new Map(state.cards.map(c => [c.id, c]));
        const props = [];
        let changed = false;
        res.forEach(x => {
          const o = part[x && x.k];
          if (!o) return;
          const c = cards.get(o.c);
          if (c && x.s && c.senseId === o.s && x.s !== o.s) { c.senseId = x.s; changed = true; }   // sens fusionné
          if (x.st === "filled" || x.st === "same") {
            if (c && c.own && c.own.includes(o.k) && dictSame(o.k, dictCardVals(c)[o.k] || "", o.v)) {
              dictSetOwn(c, new Set(c.own.filter(k => k !== o.k))); changed = true;   // case redevenue commune
            }
          } else if (x.st === "taken" && o.p) props.push(Object.assign({ k: props.length, s: x.s || o.s }, dictItem(o.k, o.v)));
        });
        for (let i = 0; i < props.length; i += PROP_N) {
          try { await rpc("dict_propose", { p_items: props.slice(i, i + PROP_N).map((p, j) => Object.assign({}, p, { k: j })) }); }
          catch (e) { if (errKind(e) === "net") throw e; }   // limite / refus : la valeur reste perso, sans proposition
        }
        const sent = new Set(part.map(o => o.q));
        list = outLoad().filter(o => !sent.has(o.q));
        outStore(list);
        if (changed) save(false);
      }
    } catch (e) {
      if (errKind(e) === "net") { clearTimeout(outTimer); outTimer = setTimeout(() => { flush().catch(() => {}); }, 60000); }
    } finally { flushing = false; }
  }

  // --- Mise à jour d'une carte depuis son sens ---
  // mode "link" : première liaison — une valeur de la carte différente de celle du sens est gardée (perso).
  // mode "refresh" : le sens a changé — les cases non perso prennent la valeur du commun.
  // Cases remplies dans la carte et vides dans le sens : gardées (perso) et ajoutées à fills (envoi au commun).
  function reconcile(c, s, mode, fills, autoKeys) {
    const cv = dictCardVals(c), sv = dictSenseVals(s.vals);
    const own = new Set(arr(c.own));
    let changed = false, filled = 0;
    if (c.senseId !== s.id) { c.senseId = s.id; changed = true; }
    new Set(Object.keys(cv).concat(Object.keys(sv))).forEach(k => {
      if (!dictKeyOk(k)) return;
      const a = cv[k] || "", b = sv[k] || "";
      if (own.has(k)) {
        if (b && a && dictSame(k, a, b)) { own.delete(k); changed = true; }
        return;
      }
      if (b) {
        if (dictSame(k, a, b)) { if (autoKeys && autoKeys.has(k)) dictMarkAuto(c, k); return; }
        if (a && mode === "link") { own.add(k); changed = true; return; }
        dictSetKey(c, k, b); changed = true;
        if (!a) { dictMarkAuto(c, k); filled++; }
      } else if (a) {
        own.add(k); changed = true;
        if (fills && dictSendable(k, a)) fills.push({ c: c.id, s: s.id, k, v: a, p: 0 });
      }
    });
    const before = arr(c.own).join("|");
    dictSetOwn(c, own);
    if (arr(c.own).join("|") !== before) changed = true;
    return { changed, filled };
  }

  // --- Relecture des sens modifiés ---
  // opts : { cards (sinon toutes), force (ignore les versions connues) }. Renvoie le nombre de cases remplies.
  async function refresh(opts) {
    opts = opts || {};
    if (!on() || inSession()) return 0;
    const st = state;
    const cards = (opts.cards || state.cards).filter(c => c.senseId && editable(c));
    if (!cards.length) return 0;
    const ids = [...new Set(cards.map(c => c.senseId))];
    const km = knownMap();
    const got = new Map();
    for (let i = 0; i < ids.length; i += GET_N) {
      const part = ids.slice(i, i + GET_N);
      const kn = {};
      if (!opts.force) part.forEach(id => { if (typeof km[id] === "number") kn[id] = km[id]; });
      const res = arr(await rpc("dict_get", { p_ids: part, p_known: kn }));
      if (state !== st) return 0;
      res.forEach(x => {
        if (!x || !x.id) return;
        if (x.gone) { got.set(x.id, null); return; }
        km[x.to] = num(Number(x.v), 0);
        got.set(x.id, { id: x.to, vals: x.vals || {} });
      });
    }
    const fills = [];
    let filled = 0, changed = false;
    cards.forEach(c => {
      if (!got.has(c.senseId)) return;
      const s = got.get(c.senseId);
      if (!s) { delete c.senseId; delete c.own; changed = true; return; }   // sens supprimé : la carte garde ses valeurs, reliée plus tard
      const r = reconcile(c, s, "refresh", fills);
      filled += r.filled; if (r.changed) changed = true;
    });
    knownSave();
    queue(fills);
    if (fills.length) flushSoon();
    if (changed) save(true);
    return filled;
  }

  // --- Faux doublons (étape 63) ---
  // Mes cartes en conflit : { [id de carte]: { id (cas), st (open | distinct | merged | closed), l (langue), w (mot de la
  // carte signalé), to (sens à rejoindre, pas encore appliqué), p (proposition en attente) } }, gardées sur l'appareil.
  async function crpc(name, args) {
    try {
      const r = await withTimeout(Supa.client().rpc(name, args || {}), 20000);
      if (r && r.error) throw r.error;
      confStatus = "ok";
      return r ? r.data : null;
    } catch (e) {
      if (isMissing(e)) confStatus = "missing";
      throw e;
    }
  }
  function confKey() { return CONFIG.LS_USER_PREFIX + "dict:conf:" + (Storage.getUser() || ""); }
  let conf = null, confUser = null;
  function confMap() {
    const u = Storage.getUser();
    if (conf && confUser === u) return conf;
    confUser = u; conf = {};
    try { const o = JSON.parse(localStorage.getItem(confKey()) || "{}"); if (o && typeof o === "object" && !Array.isArray(o)) conf = o; } catch (e) {}
    return conf;
  }
  function confStore() { try { if (Object.keys(conf || {}).length) localStorage.setItem(confKey(), JSON.stringify(conf)); else localStorage.removeItem(confKey()); } catch (e) {} }
  function confSet(cardId, o) { confMap()[cardId] = Object.assign({}, confMap()[cardId], o); confStore(); }
  // Conflit d'une carte, seulement si son mot (dans la langue du cas) est toujours le mot signalé.
  function confOf(c) {
    if (!c || !isVocab(c)) return null;
    const x = confMap()[c.id];
    if (!x || !x.l) return null;
    return dictOverlap(dictNorms(term(c, x.l)), dictNorms(x.w)) ? x : null;
  }
  // Carte écartée de la liaison automatique : cas ouvert, ou sens gardés séparés par l'admin.
  function confHeld(c) { const x = confOf(c); return !!x && (x.st === "open" || x.st === "distinct"); }
  // Cas ouvert d'une carte (repère « Ce mot existe déjà dans le dictionnaire autrement »), ou null.
  function conflictOf(c) { if (confStatus === "missing") return null; const x = confOf(c); return x && x.st === "open" ? x : null; }
  // Signale au serveur les cartes tombées sur plusieurs sens. items : [{ c, d (dictDecide), L }].
  // Renvoie Map carte → statut (open | distinct | merged | closed | none | bad | full), ou null (script absent / erreur).
  async function report(items) {
    if (confStatus === "missing") return null;
    const res = new Map();
    for (let i = 0; i < items.length; i += CONF_N) {
      const part = items.slice(i, i + CONF_N);
      const r = arr(await crpc("dict_conflict_report", { p_items: part.map((a, j) => {
        const vals = {};
        Object.keys(a.c.terms || {}).forEach(L => { const v = dictClean(a.c.terms[L]); if (v && isLang(L)) vals[L] = v.slice(0, 120); });
        return { k: j, card: a.c.id, l: a.L, w: dictClean(term(a.c, a.L)), senses: a.d.ambig.map(s => s.id).filter(Boolean),
                 linked: a.d.best ? a.d.best.id : null, vals };
      }) }));
      r.forEach(x => {
        const a = part[Number(x && x.k)];
        if (!a || !x.st) return;
        res.set(a.c.id, x.st);
        if (x.id && !["none", "bad"].includes(x.st)) confSet(a.c.id, { id: x.id, st: x.st === "full" ? "open" : x.st, l: a.L, w: dictClean(term(a.c, a.L)), to: undefined });
      });
    }
    return res;
  }
  // Relit mes cartes en conflit, applique le sens choisi par l'admin (fusion, « Relier la carte »), oublie les cartes
  // supprimées. Renvoie true si la liste est à jour (la migration peut alors tourner).
  async function syncConflicts() {
    if (!on() || confStatus === "missing") return false;
    const st = state;
    const rows = arr(await crpc("dict_conflict_mine"));
    if (state !== st) return false;
    const map = {};
    rows.forEach(x => { if (x && x.card) map[x.card] = { id: x.id, st: x.st, l: x.l, w: x.w, to: x.to || undefined, p: x.p ? 1 : undefined }; });
    conf = map; confUser = Storage.getUser(); confStore();
    confReady = true;
    const byId = new Map(state.cards.map(c => [c.id, c]));
    const gone = Object.keys(map).filter(id => !byId.has(id));
    for (let i = 0; i < gone.length; i += 500) {
      try { await crpc("dict_conflict_forget", { p_cards: gone.slice(i, i + 500) }); gone.slice(i, i + 500).forEach(id => { delete conf[id]; }); } catch (e) { break; }
    }
    confStore();
    // Sens à rejoindre : relu dans le commun, puis la carte le rejoint (ses valeurs différentes restent les siennes).
    const todo = Object.keys(map).filter(id => map[id].to && byId.has(id) && editable(byId.get(id)));
    if (!todo.length || inSession()) return true;
    const ids = [...new Set(todo.map(id => map[id].to))];
    const got = new Map();
    for (let i = 0; i < ids.length; i += GET_N) {
      const res = arr(await rpc("dict_get", { p_ids: ids.slice(i, i + GET_N) }));
      if (state !== st) return false;
      res.forEach(x => { if (x && x.id && !x.gone) got.set(x.id, { id: x.to || x.id, vals: x.vals || {}, v: num(Number(x.v), 0) }); });
    }
    const acks = [], km = knownMap();
    let changed = false;
    todo.forEach(id => {
      const c = byId.get(id), s = got.get(map[id].to);
      if (!c || !s) return;
      if (c.senseId !== s.id) {
        delete c.senseId;
        reconcile(c, s, "link", null);
        km[s.id] = s.v;
        changed = true;
      }
      acks.push({ card: id, to: map[id].to });
    });
    if (changed) { knownSave(); save(true); }
    if (acks.length) {
      try { await crpc("dict_conflict_ack", { p_items: acks }); acks.forEach(a => { if (conf[a.card]) delete conf[a.card].to; }); confStore(); } catch (e) {}
    }
    return true;
  }
  // Fenêtre « Faire une proposition » (js/doublons.js) : détail du cas, envoi de la proposition.
  async function conflictDetail(id) { return await crpc("dict_conflict_detail", { p_id: id }); }
  async function conflictPropose(c, x, choice, sense, vals, comment) {
    const r = await crpc("dict_conflict_propose", { p_id: x.id, p_card: c.id, p_choice: choice, p_sense: sense || null,
      p_vals: vals || {}, p_comment: String(comment || "").slice(0, 200) });
    confSet(c.id, { p: 1 });
    return r;
  }

  // --- Liaison de cartes pas encore reliées ---
  // opts : { picks (Map carte → sens | "new"), auto (Map carte → Set de cases remplies depuis le commun dans l'éditeur) }.
  // Plusieurs sens possibles : jamais de choix demandé (étape 63, voir report). Renvoie { linked, created, filled, stop,
  // conflicts (cas ouverts signalés) } (null si le compte a changé).
  async function link(cards, opts) {
    opts = opts || {};
    const st = state;
    const out = { linked: 0, created: 0, filled: 0, stop: null, conflicts: 0 };
    const fills = [], toCreate = [], ambig = [];
    const groups = new Map();
    const doLink = (c, s) => {
      const r = reconcile(c, s, "link", fills, opts.auto && opts.auto.get(c.id));
      out.linked++; out.filled += r.filled;
    };
    let round = [];
    cards.filter(c => !c.senseId && editable(c)).forEach(c => {
      const pick = opts.picks && opts.picks.get(c.id);
      if (pick === "new") { toCreate.push(c); return; }
      if (pick && pick.id) { doLink(c, pick); return; }
      const langs = dictQueryLangs(c);
      if (langs.length) round.push({ c, langs, n: 0 });
    });
    try {
      // Recherche dans la 1re langue de la carte ; mot inconnu dans cette langue → langue suivante (ex. une carte
      // d'italien dont le mot italien n'est pas encore dans le commun est retrouvée par son mot français).
      while (round.length) {
        const next = [];
        groups.clear();
        round.forEach(x => { const L = x.langs[x.n]; if (!groups.has(L)) groups.set(L, []); groups.get(L).push(x); });
        for (const [L, items] of groups) {
          for (let i = 0; i < items.length; i += SEARCH_N) {
            const part = items.slice(i, i + SEARCH_N);
            const res = arr(await rpc("dict_search", { p_lang: L, p_words: part.map(x => dictClean(term(x.c, L))), p_limit: 6 }));
            if (state !== st) return null;
            const byI = new Map(res.map(x => [Number(x.i), arr(x.senses)]));
            part.forEach((x, j) => {
              const found = byI.get(j + 1) || [];
              if (!found.length && x.n + 1 < x.langs.length) { x.n++; next.push(x); return; }
              const d = dictDecide(dictCardVals(x.c), found, L);
              if (d === "new") toCreate.push(x.c);
              else if (d.ambig) ambig.push({ c: x.c, d, L });
              else doLink(x.c, d);
            });
          }
        }
        round = next;
      }
      // Plusieurs sens possibles (faux doublon, étape 63) : jamais de fenêtre. La carte garde ses valeurs : reliée au sens
      // le plus proche s'il est clair (sans rien envoyer au commun : ses valeurs différentes restent les siennes), sinon
      // sans lien ; le cas est signalé au serveur. Script de l'étape 63 absent, ou rien à signaler : sans sens proche,
      // nouveau sens à part (comme la migration avant l'étape 63).
      if (ambig.length) {
        ambig.forEach(a => {
          if (!a.d.best || a.c.senseId) return;
          const r = reconcile(a.c, a.d.best, "link", null, opts.auto && opts.auto.get(a.c.id));
          out.linked++; out.filled += r.filled;
        });
        let rep = null;
        try { rep = await report(ambig); } catch (e) { rep = null; if (errKind(e) === "net") out.stop = "net"; }
        if (state !== st) return null;
        ambig.forEach(a => {
          const s = rep ? rep.get(a.c.id) : null;
          if (s === "open") out.conflicts++;
          if (a.c.senseId) return;
          // Pas de sens proche : reste sans lien si le cas est enregistré ; nouveau sens si rien à signaler ou script absent
          // (erreur réseau : rien, nouvel essai plus tard).
          if (rep ? (!s || s === "none") : (confStatus === "missing" && out.stop !== "net")) toCreate.push(a.c);
        });
      }
      // Nouveaux sens : un seul pour les cartes identiques du même lot (même mot, traductions compatibles).
      const reps = [];
      toCreate.forEach(c => {
        if (c.senseId) return;
        const q = dictQueryOf(c);
        if (!q) return;
        const cv = dictCardVals(c), ns = dictNorms(q.w);
        const r = reps.find(x => x.L === q.L && dictOverlap(x.ns, ns) && dictCompat(cv, x.vals, q.L) >= 0);
        if (r) r.follow.push(c);
        else { const fv = dictValsFromCard(c); reps.push({ c, L: q.L, ns, vals: fv.vals, skipped: fv.skipped, follow: [] }); }
      });
      for (let i = 0; i < reps.length; i += CREATE_N) {
        const part = reps.slice(i, i + CREATE_N);
        const res = arr(await rpc("dict_create", { p_items: part.map((r, j) => ({ k: j, vals: r.vals })) }));
        if (state !== st) return null;
        const km = knownMap();
        res.forEach(x => {
          const r = part[Number(x && x.k)];
          if (!r || !x.id) return;
          const s = { id: x.id, vals: x.vals || {} };
          km[x.id] = num(Number(x.v), 0);
          r.c.senseId = x.id;
          dictSetOwn(r.c, new Set(r.skipped));                    // valeurs refusées par le commun : gardées dans la carte
          out.created++;
          r.follow.forEach(f => doLink(f, s));
        });
      }
    } catch (e) {
      out.stop = errKind(e);
    }
    if (state === st) { knownSave(); queue(fills); if (fills.length) flushSoon(); }
    return out;
  }

  // Cartes vocab pas encore reliées (migration) : listes modifiables, au moins un mot ; sans les cartes en conflit (étape 63 :
  // elles attendent la décision de l'admin).
  function unlinked() { return state.cards.filter(c => !c.senseId && editable(c) && dictQueryOf(c) && !confHeld(c)); }
  function pauseKey() { return CONFIG.LS_USER_PREFIX + "dict:pause:" + (Storage.getUser() || ""); }
  function paused() { try { return localStorage.getItem(pauseKey()) === "1"; } catch (e) { return false; } }
  function setPaused(v) { try { if (v) localStorage.setItem(pauseKey(), "1"); else localStorage.removeItem(pauseKey()); } catch (e) {} }

  // --- Migration des cartes existantes : par lots, barre de progression, enregistrement après chaque lot ---
  // manual : lancée par « Reprendre ». Fermer l'appli au milieu : la suite repart au lancement suivant.
  async function migrate(manual) {
    if (!on() || migJob || inSession()) return;
    if (!confReady && confStatus !== "missing") return;   // étape 63 : liste des cartes en conflit relue d'abord
    const todo = unlinked();
    if (!todo.length) { setPaused(false); return; }
    if (!manual && paused() && todo.length > MIG_SILENT) { renderResumeBars(); return; }
    const st = state, who = Storage.getUser(), total = todo.length;
    const job = { stop: false };
    migJob = job;
    let prog = null, done = 0, linked = 0, stop = null;
    if (total > MIG_SILENT) {
      prog = openProgress(t("dict.migTitle"), t("dict.migProgress", { i: 0, n: total }),
        [{ label: t("dict.pause"), onClick: () => { job.stop = true; return false; } }]);
      Wake.on();
    }
    try {
      for (let i = 0; i < total && !job.stop; i += MIG_N) {
        const part = todo.slice(i, i + MIG_N).filter(c => !c.senseId && state.cards.includes(c));
        const r = await link(part, {});
        if (!r || state !== st || Storage.getUser() !== who) return;
        linked += r.linked + r.created;
        done = Math.min(total, i + MIG_N);
        save(false);
        Storage.flushNow();                              // lot en ligne avant le suivant (index après les morceaux : règle 33b)
        if (prog) prog.set(done / total, t("dict.migProgress", { i: done, n: total }));
        if (r.stop) { stop = r.stop; break; }
        await yieldUI();
      }
    } finally {
      if (migJob === job) migJob = null;
      if (prog) { prog.close(); Wake.off(); }
    }
    if (state !== st || Storage.getUser() !== who) return;
    if (job.stop) setPaused(true);
    else if (!stop) setPaused(false);
    if (prog || manual) {
      const left = unlinked().length;
      toast(job.stop || (stop && left) ? t("dict.migPaused", { n: left }) : t("dict.migDone", { n: linked }));
    }
    renderResumeBars();
    if (linked && ["lists", "home"].includes(currentScreen) && !inSession()) renderScreen();
  }
  // Bandeau « Liaison en pause : N cartes — Reprendre / Plus tard » (renderResumeBars, core.js).
  function resumeBar(box) {
    if (!on() || migJob || barHidden || !paused()) return;
    const n = unlinked().length;
    if (!n) return;
    const b = el("div", "rs-bar");
    b.appendChild(el("div", null, t("dict.migPaused", { n })));
    const btns = el("div", "btns two");
    const bL = el("button", "btn", t("dict.later")), bR = el("button", "btn primary", t("dict.resume"));
    bL.addEventListener("click", () => { barHidden = true; renderResumeBars(); });
    bR.addEventListener("click", () => { box.textContent = ""; migrate(true); });
    btns.append(bL, bR);
    b.appendChild(btns);
    box.appendChild(b);
  }

  // --- Cycle : file, migration, sens modifiés ---
  async function cycle() {
    if (!usable() || cycling || inSession() || status === "missing" || status === "off") return;
    cycling = true; lastCycle = Date.now();
    const my = token;
    try {
      if (status === "unknown") await rpc("dict_get", { p_ids: [] });   // script lancé ?
      if (my !== token) return;
      await flush();
      if (my !== token) return;
      try { await syncConflicts(); } catch (e) { /* hors connexion : migration remise au cycle suivant */ }   // étape 63
      if (my !== token) return;
      await migrate(false);
      if (my !== token) return;
      await refresh({});
    } catch (e) { /* hors connexion, script absent : on réessaie au cycle suivant */ }
    finally { cycling = false; }
  }
  function start() {
    reset();
    if (!usable()) return;
    const my = token;
    setTimeout(() => { if (my === token) cycle(); }, 1500);
    timer = setInterval(() => { if (my === token) cycle(); }, POLL_MS);
  }
  function reset() {
    token++;
    clearInterval(timer); timer = null; clearTimeout(outTimer); outTimer = null;
    status = "unknown"; cycling = false; known = null; knownUser = null; barHidden = false; limitWarned = false;
    confStatus = "unknown"; confReady = false; conf = null; confUser = null;
  }
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && timer && Date.now() - lastCycle > BACK_MS) cycle();
    });
    window.addEventListener("online", () => { if (timer) flush().catch(() => {}); });
  } catch (e) {}

  // --- Modifications faites à la main (éditeur, « À valider », import) ---
  // track(c) avant la modification, changed(c, snap) après : chaque case modifiée devient perso et part au commun
  // (case vide → remplie ; case déjà remplie → proposition à l'admin).
  function track(c) { return c && isVocab(c) && c.senseId ? dictCardVals(c) : null; }
  function changed(c, snap) {
    if (!snap || !c || !c.senseId || !isVocab(c)) return;
    const now = dictCardVals(c);
    const own = new Set(arr(c.own));
    const items = [];
    new Set(Object.keys(now).concat(Object.keys(snap))).forEach(k => {
      if (!dictKeyOk(k)) return;
      const a = now[k] || "", b = snap[k] || "";
      if (a === b) return;
      own.add(k);
      if (a && dictSendable(k, a)) items.push({ c: c.id, s: c.senseId, k, v: a, p: 1 });
    });
    dictSetOwn(c, own);
    queue(items);
    if (items.length) flushSoon();
  }

  // --- Après l'ajout de cartes (éditeur, import, génération, copie reçue) ---
  // opts : { picks, auto } (éditeur : sens choisi et cases remplies depuis le commun). Toujours une promesse.
  async function afterAdd(ids, opts) {
    if (!on() || !arr(ids).length) return;
    const set = new Set(ids);
    const cards = state.cards.filter(c => set.has(c.id) && editable(c));
    if (!cards.length) return;
    const st = state;
    try {
      let filled = 0;
      const withSense = cards.filter(c => c.senseId);        // copie reçue déjà reliée : valeurs du commun à jour
      if (withSense.length) filled += await refresh({ cards: withSense, force: true });
      if (state !== st) return;
      const r = await link(cards.filter(c => !c.senseId), opts || {});
      if (!r || state !== st) return;
      filled += r.filled;
      save(true);
      if (r.conflicts) toast(t(r.conflicts > 1 ? "dcf.addedN" : "dcf.added", { n: r.conflicts }));   // étape 63 : faux doublon, sans fenêtre
      else if (filled) toast(t("dict.filled", { n: filled }));
    } catch (e) {}
  }

  // --- Complétion : d'abord depuis le commun (immédiat), Claude ensuite pour ce qui manque ---
  async function fillFromCommon(cards) {
    if (!on()) return 0;
    const st = state;
    try {
      await flush();
      if (state !== st) return 0;
      let n = 0;
      const un = arr(cards).filter(c => !c.senseId && editable(c) && dictQueryOf(c) && !confHeld(c));
      if (un.length && !migJob) { const r = await link(un, {}); if (!r || state !== st) return 0; n += r.filled; }
      n += await refresh({ cards: arr(cards) });
      if (state !== st) return 0;
      save(false);
      if (n) toast(t("dict.filled", { n }));
      return n;
    } catch (e) { return 0; }
  }

  // --- Éditeur : recherche d'un mot (null si indisponible) ---
  // Étape 79 : sans connexion, la copie du dictionnaire gardée sur l'appareil répond à la place du serveur (Offline.dictSearch,
  // js/hors-ligne.js ; null s'il n'y a pas de copie : comme avant, la liaison se fait à l'enregistrement).
  async function search(L, w) {
    if (!on() || !isLang(L) || !dictClean(w)) return null;
    const local = async () => { try { return typeof Offline !== "undefined" ? await Offline.dictSearch(L, dictClean(w)) : null; } catch (e) { return null; } };
    if (navigator.onLine === false) return await local();
    try {
      const res = arr(await rpc("dict_search", { p_lang: L, p_words: [dictClean(w)], p_limit: 6 }));
      return res.length ? arr(res[0].senses) : [];
    } catch (e) { return errKind(e) === "net" ? await local() : null; }
  }

  return { on, usable, start, reset, track, changed, afterAdd, fillFromCommon, migrate, resumeBar, search, flush,
    refresh, status: () => status, busy: () => !!migJob,
    conflictOf, conflictDetail, conflictPropose, syncConflicts, confStatus: () => confStatus };   // étape 63
})();

