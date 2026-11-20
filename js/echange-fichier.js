"use strict";

// ====================================================================================================
// js/echange-fichier.js — ÉCHANGE PAR FICHIER AVEC CLAUDE (2e morceau de l'ancien js/completion.js, étape 65)
// Télécharger le fichier pour Claude, puis réimporter sa réponse. Chargé juste après js/completion.js.
// ====================================================================================================

// === ÉCHANGE PAR FICHIER AVEC CLAUDE ===
// Troisième voie de complétion (en plus du copier-coller et de la file d'attente) :
// 1. « Télécharger le fichier pour Claude » : périmètre (tout / dossier / liste) + champs à compléter ; seulement les cartes
//    avec au moins un champ choisi vide ; fichiers de FX_MAX cartes max (plusieurs parties → un .zip, ou fichiers séparés).
//    Contenu : consignes « # » pour Claude, puis une section par type de carte (ligne d'en-tête + une ligne par carte),
//    séparateur « ; », 1re colonne = id de la carte, 2e = type, dernière = sig (empreinte de la carte à l'export).
//    Case vide = à remplir ; case « - » = ne pas remplir (champ non choisi ou hors langues de la liste).
// 2. « Importer la réponse de Claude » : un ou plusieurs fichiers .txt / .csv, ou texte collé ; lignes « # » et texte avant
//    la 1re ligne d'en-tête ignorés ; correspondance par id uniquement ; seulement les cases vides dans l'appli
//    (case remplie changée par Claude = « Correction proposée », signalée à part, envoyée seulement si on coche la case) ;
//    bilan avant validation ; tout va dans « À valider » (addProposal) : importer deux fois le même fichier ne crée rien.
// Lecture : bulkLines / bulkSeparator / readTextFile (import en masse). Sans en-tête « id;type » : ancien format
// « Préparer pour Claude » (importReply).
const FX_MAX = 200;                  // cartes max par fichier
const FX_EMPTY = "-";                // case à ne pas remplir
// Champs des autres types de cartes que Claude peut compléter.
const FX_TYPED = { conj: ["translation"], cloze: ["hint", "explanation", "translation"], fix: ["explanation"], rule: ["examples", "translation"] };
// Colonnes de chaque section : [nom de colonne, clé] ; clé = champ (fieldVal) ou info (lecture seule).
const FX_TYPED_COLS = {
  conj: [["verbe", "i:verb"], ["temps", "i:tense"], ["personne", "i:person"], ["forme", "i:answer"], ["traduction", "f:translation"], ["note", "f:note"]],
  cloze: [["phrase", "i:sentence"], ["reponse", "i:answer"], ["indice", "f:hint"], ["explication", "f:explanation"], ["traduction", "f:translation"]],
  fix: [["phrase_fautive", "i:wrong"], ["phrase_corrigee", "i:correct"], ["explication", "f:explanation"]],
  rule: [["titre", "i:title"], ["texte", "i:body"], ["exemples", "f:examples"], ["traduction", "f:translation"]]
};
const FX_CHOICES = ["tr", "pos", "example", "other"];   // example : exemple et ses traductions (étape 35)

function fxCell(s) { return String(s == null ? "" : s).replace(/[;\t\r\n]+/g, " ").replace(/\s+/g, " ").trim(); }
// Empreinte du contenu d'une carte (changement entre l'export et l'import).
function fxSig(c) {
  const o = isVocab(c)
    ? { t: Object.keys(c.terms || {}).sort().map(k => [k, c.terms[k]]), p: Object.keys(c.pos || {}).sort().map(k => [k, c.pos[k]]), e: fieldVal(c, "example"), x: JSON.stringify(exMap(c) || {}) }
    : normTypedFields(c.type, c);
  return strHash(cardType(c) + "\u0001" + JSON.stringify(o));
}
// Champs qu'une carte peut recevoir par ce fichier (cases à compléter, jamais la langue apprise).
function fxFillable(c, lg) {
  if (!isVocab(c)) return (FX_TYPED[c.type] || []).map(typedField);
  lg = lg || cardLangs(c);
  return withStudyFields(c, lg, lg.support.concat(posFields(lg), exFields(lg)));   // + langues étudiées en plus (étape 37)
}
// Cases demandées (vides) pour les choix cochés.
function fxWanted(c, choice, lg) {
  const out = [];
  if (!isVocab(c)) {
    if (choice.other) (FX_TYPED[c.type] || []).forEach(n => { const f = typedField(n); if (!fieldVal(c, f).trim()) out.push(f); });
    return out;
  }
  lg = lg || cardLangs(c);
  if (choice.tr) lg.support.forEach(code => { if (!term(c, code).trim()) out.push(code); });
  if (choice.pos) [lg.target].concat(lg.support).forEach(code => {
    const f = posField(code);
    if (fieldVal(c, f).trim()) return;
    if (term(c, code).trim() || (choice.tr && code !== lg.target)) out.push(f);   // nature d'un mot présent ou demandé
  });
  if (choice.example) exFields(lg).forEach(f => { if (!fieldVal(c, f, lg).trim()) out.push(f); });
  if (!lg.study) studyExtraFields(c).forEach(f => {                    // langues étudiées en plus (étape 37)
    if (fieldVal(c, f).trim() || out.includes(f)) return;
    if (isExlField(f) || isExltField(f) ? choice.example : isPosField(f) ? choice.pos : choice.tr) out.push(f);
  });
  return out;
}
function fxScopeCards(scope) {
  const [k, id] = String(scope || "all").split(":");
  const ok = c => canEditList(c.listId);   // listes communes en lecture seule exclues (étape 30)
  if (k === "list") return getList(id) ? cardsOf(id).filter(ok) : [];
  if (k === "folder") { const f = getFolder(id); return f ? cardsUnder("folder", f).filter(ok) : []; }
  return state.cards.filter(ok);
}
function fxScopeName(scope) {
  const [k, id] = String(scope || "all").split(":");
  const o = k === "list" ? getList(id) : k === "folder" ? getFolder(id) : null;
  return o ? o.name : "tout";
}
function fxSlug(s) { return String(s || "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "liste"; }
function fxFileName(scope, i, n) { return "vocab-completion-" + fxSlug(fxScopeName(scope)) + (n > 1 ? "-partie-" + i + "-sur-" + n : "") + ".txt"; }

// En-tête des colonnes d'une section.
// Vocabulaire : trad_exemple_<code> = traduction de l'exemple dans cette langue (étape 35).
function fxHeader(type, langs, exLangs, stCols) {
  const st = arr(stCols).map(f => { const x = exlParts(f); return isExlField(f) ? "exemple_" + x.L : "trad_exemple_" + x.L + "_" + x.code; });   // étape 37
  if (type === "vocab") return ["id", "type", "liste", "target"].concat(langs, langs.map(x => "pos_" + x), ["exemple"], arr(exLangs).map(x => "trad_exemple_" + x), st, ["sig"]);
  return ["id", "type", "liste", "target"].concat(FX_TYPED_COLS[type].map(x => x[0]), ["sig"]);
}
// Texte d'un fichier (une partie).
function fxFileText(cards, choice, i, n) {
  const lgs = new Map(), lgOf = c => { let x = lgs.get(c.listId); if (!x) { x = cardLangs(c); lgs.set(c.listId, x); } return x; };
  const langs = LANG_CODES.filter(code => cards.some(c => isVocab(c) && studyVisibleLangs(c.listId).includes(code)));   // langues affichées (et étudiées, étape 37) seulement
  const exLangs = LANG_CODES.filter(code => cards.some(c => isVocab(c) && lgOf(c).support.includes(code)));
  const stCols = cardsStudyExCols(cards);   // exemple_<L>, trad_exemple_<L>_<code> (étape 37)
  const seenL = new Set(), perList = [];
  cards.forEach(c => {
    if (seenL.has(c.listId)) return; seenL.add(c.listId);
    const lg = lgOf(c), nm = code => code + " (" + LANGUAGES[code].names.fr.toLowerCase() + ")";
    const ex = studyExtraLangs(c.listId);
    perList.push("#   - " + prepListName(c.listId) + " : langue apprise " + nm(lg.target) + " ; langues d'appui " + (lg.support.map(nm).join(", ") || "—") + (ex.length ? " ; langues étudiées en plus " + ex.map(nm).join(", ") : ""));
  });
  const types = CARD_TYPES.filter(ty => cards.some(c => cardType(c) === ty));
  const g = langs.filter(c => LANGUAGES[c].gender), ng = langs.filter(c => !LANGUAGES[c].gender);
  const head = [
    "# FICHIER DE COMPLÉTION — appli Vocab" + (n > 1 ? " — partie " + i + " sur " + n : "") + " — " + todayStr(),
    "# Rôle : tu complètes des cartes de révision de langues pour des apprenants.",
    "# Codes de langue : " + langLegend(langs.length ? langs : null) + ".",
    "# Langues de chaque liste (colonne « liste ») :"
  ].concat(perList, [
    "# Règles :",
    "# - Remplis seulement les cases VIDES (rien entre deux « ; »).",
    "# - Une case qui contient seulement « - » ne doit pas être remplie : laisse « - ».",
    "# - Ne modifie jamais une case déjà remplie, ni les colonnes id, type, liste, target et sig.",
    "# - Garde toutes les lignes, dans le même ordre, avec le même nombre de colonnes.",
    "# - N'utilise jamais « ; » à l'intérieur d'une case (ni retour à la ligne).",
    "# - Colonne d'une langue (" + langs.join(", ") + ") : traduction courte et naturelle du mot de la langue apprise (target). Plusieurs sens : séparés par « / ».",
    "# - Colonnes pos_<langue> : nature grammaticale du mot de cette langue, avec UN de ces codes : nm, nf, nmf, nmpl, nfpl, n, v, vpr, adj, adv, prep, conj, pron, interj, expr.",
    "#   " + [g.length ? "Langues avec genre (" + g.join(", ") + ") : un nom a toujours son genre (nm, nf, nmf, nmpl, nfpl), jamais n." : "",
      ng.length ? "Langues sans genre (" + ng.join(", ") + ") : n pour un nom." : ""].filter(Boolean).join(" "),
    "# - Colonne exemple : une phrase courte et simple DANS LA LANGUE APPRISE (target), niveau débutant, qui utilise le mot.",
    "# - Colonnes trad_exemple_<langue> : traduction de la phrase de la colonne exemple dans cette langue."
  ]);
  if (stCols.length) head.push(
    "# - Langue étudiée en plus (voir les listes) : sa colonne de langue = traduction du mot de la langue apprise ; exemple_<langue> = phrase courte et simple",
    "#   dans cette langue qui utilise ce mot ; trad_exemple_<langue>_<langue2> = traduction de cette phrase dans langue2."
  );
  if (types.some(ty => ty !== "vocab")) head.push(
    "# - Autres types de cartes : traduction = sens dans les langues d'appui de la liste ; explication = explication courte de la réponse (dans la 1re langue d'appui) ;",
    "#   indice = indice court (ex. « article + nom ») ; exemples (fiche de règle) = 2 ou 3 phrases courtes dans la langue apprise, séparées par « | »."
  );
  head.push(
    "# Format de réponse : « Rends exactement le même fichier, avec les cases vides remplies, sous forme de fichier .txt téléchargeable, sans autre texte. »",
    ""
  );
  const out = head.slice();
  types.forEach(ty => {
    out.push(fxHeader(ty, langs, exLangs, stCols).join(";"));
    cards.filter(c => cardType(c) === ty).forEach(c => {
      const lg = lgOf(c), want = new Set(fxWanted(c, choice, lg));
      const vis = isVocab(c) ? studyVisibleLangs(c.listId) : null, ext = isVocab(c) ? studyExtraFields(c) : [];
      const hidden = f => !!vis && ((isExlField(f) || isExltField(f)) ? !ext.includes(f) : isExTrField(f) ? !lg.support.includes(fieldCode(f)) : (isLang(f) || isPosField(f)) && !vis.includes(fieldCode(f)));
      // Langue cachée pour cette carte (ni apprise ni d'appui) : jamais envoyée, case « - » (étape 31).
      const cell = f => { if (hidden(f)) return FX_EMPTY; const v = fxCell(fieldVal(c, f)); return v || (want.has(f) ? "" : FX_EMPTY); };
      let row = [c.id, ty, prepListName(c.listId), isVocab(c) ? lg.target : cardLang(c)];
      if (ty === "vocab") row = row.concat(langs.map(cell), langs.map(x => cell(posField(x))), [cell("example")], exLangs.map(x => cell(exTrField(x))), stCols.map(cell));
      else row = row.concat(FX_TYPED_COLS[ty].map(([, k]) => k.startsWith("f:") ? cell(k) :
        fxCell(k === "i:tense" ? tenseName(c.lang, c.tense) : k === "i:person" ? personLabel(c.lang, c.tense, c.person) : c[k.slice(2)])));
      row.push(fxSig(c));
      out.push(row.map(fxCell).join(";"));
    });
    out.push("");
  });
  return out.join("\n");
}

// --- Téléchargement : un fichier (capacité downloads dans Claude, sinon lien), ou false ---
async function fxSave(filename, data) {
  try {
    const dl = inClaude() ? await window.claude.use("downloads") : null;
    if (dl) { await dl.save({ filename, data }); return true; }
  } catch (e) { if (e && e.code === "declined") return "declined"; }
  if (inClaude()) return false;
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  } catch (e) { return false; }
}
// Archive .zip sans compression (format « stored »), sans bibliothèque : [{ name, text }] → Blob.
let fxCrcTable = null;
function fxCrc32(bytes) {
  if (!fxCrcTable) { fxCrcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; fxCrcTable[n] = c >>> 0; } }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = fxCrcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function fxZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = fxCrc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    central.push(c.buffer, name);
    offset += 30 + name.length + data.length;
  });
  const csize = central.reduce((n, x) => n + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [e.buffer]), { type: "application/zip" });
}
// Repli (téléchargement impossible) : texte de chaque partie à copier.
function fxShowText(files) {
  let idx = 0;
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("fx.textFallback")));
  const ta = el("textarea"); ta.readOnly = true;
  const fill = () => { ta.value = files[idx].text; };
  if (files.length > 1) {
    const sel = el("select", "input"); sel.style.marginBottom = "10px";
    files.forEach((f, i) => { const o = el("option", null, f.name); o.value = String(i); sel.appendChild(o); });
    sel.addEventListener("change", () => { idx = +sel.value || 0; fill(); });
    wrap.appendChild(sel);
  }
  fill();
  wrap.appendChild(ta);
  openModal(t("fx.exportTitle"), wrap, [
    { label: t("copy"), kind: "primary", onClick: () => { copyText(ta.value, ta); return false; } },
    { label: t("close") }
  ]);
}
async function fxDeliver(files, mode) {
  let ok = true;
  if (files.length === 1) ok = await fxSave(files[0].name, files[0].text);
  else if (mode === "zip") ok = await fxSave(files[0].name.replace(/-partie-\d+-sur-\d+\.txt$/, ".zip"), fxZip(files));
  else for (const f of files) { const r = await fxSave(f.name, f.text); if (r !== true) { ok = r; break; } await new Promise(r2 => setTimeout(r2, 400)); }
  if (ok === true) openModal(t("fx.exportTitle"), el("p", null, t("fx.done", { n: files.length })), [{ label: t("close"), kind: "primary" }]);
  else if (ok !== "declined") fxShowText(files);
}

// Fenêtre « Télécharger le fichier pour Claude ». scope : "all" | "folder:<id>" | "list:<id>".
function openFxExport(scope, dictDone) {
  // Dictionnaire commun d'abord (étape 36) : le fichier ne contient que ce qui manque encore.
  if (!dictDone && Dict.on()) { Dict.fillFromCommon(fxScopeCards(scope || "all")).then(() => openFxExport(scope, true)); return; }
  const o = { scope: scope || "all", choice: { tr: true, pos: true, example: true, other: true } };
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("fx.help")));
  const sc = el("select", "input");
  [["all", t("queue.scope.all")]].concat(
    sortedFolders().map(f => ["folder:" + f.id, "▸ " + f.name]),
    orderedLists().map(l => ["list:" + l.id, listLabel(l)])
  ).forEach(([v, l]) => { const op = el("option", null, l); op.value = v; sc.appendChild(op); });
  sc.value = o.scope;
  if (sc.value !== o.scope) sc.value = o.scope = "all";
  wrap.appendChild(formField(t("queue.scope"), sc));
  const box = el("div", "fx-choices");
  FX_CHOICES.forEach(k => {
    const r = el("label", "upd-row");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = o.choice[k];
    cb.addEventListener("change", () => { o.choice[k] = cb.checked; upd(); });
    const l = el("div", "upd-l"); l.appendChild(el("div", null, t("fx.f." + k)));
    const n = el("span", "upd-n");
    r.append(cb, l, n);
    r._n = n; r._k = k;
    box.appendChild(r);
  });
  wrap.appendChild(formField(t("fx.what"), box));
  const info = el("p", "muted fx-info");
  wrap.appendChild(info);
  const pick = () => fxScopeCards(o.scope).filter(c => fxWanted(c, o.choice).length);
  function upd() {
    const all = fxScopeCards(o.scope);
    box.querySelectorAll(".upd-row").forEach(r => {
      const one = { [r._k]: true };
      if (r._k === "pos") one.tr = false;
      const n = all.filter(c => fxWanted(c, one).length).length;
      r._n.textContent = n ? t(n === 1 ? "upd.card1" : "upd.cards", { n }) : "✓";
    });
    const n = pick().length;
    info.textContent = n ? t("fx.count", { n, f: Math.ceil(n / FX_MAX) }) : t("fx.count0");
  }
  sc.addEventListener("change", () => { o.scope = sc.value; upd(); });
  upd();
  openModal(t("fx.exportTitle"), wrap, [
    { label: t("cancel") },
    { label: t("fx.download"), kind: "primary", onClick: () => {
      const cards = pick();
      if (!cards.length) { toast(t("fx.count0")); return false; }
      const parts = chunks(cards, FX_MAX);
      const files = parts.map((p, i) => ({ name: fxFileName(o.scope, i + 1, parts.length), text: fxFileText(p, o.choice, i + 1, parts.length) }));
      if (files.length === 1) { fxDeliver(files, "one"); return; }
      openModal(t("fx.partsTitle", { n: files.length }), el("p", "muted", t("fx.partsHelp", { n: files.length, max: FX_MAX })), [
        { label: t("fx.zip"), kind: "primary", onClick: () => { fxDeliver(files, "zip"); } },
        { label: t("fx.separate", { n: files.length }), onClick: () => { fxDeliver(files, "separate"); } },
        { label: t("cancel") }
      ]);
    } }
  ]);
}

// --- Lecture de la réponse ---
// Clé d'une colonne d'en-tête : "id", "type", "liste", "target", "sig", code de langue, "pos:<code>", "example", "f:<champ>",
// "i:<info>" (lecture seule) ou "ignore".
function fxColKey(cell) {
  const n = normText(cell).replace(/[\s-]+/g, "_");
  if (["id", "type", "liste", "target", "sig"].includes(n)) return n;
  if (n === "list") return "liste";
  const m = /^(?:pos|nature)[_:]([a-z]{2,3})$/.exec(n);
  if (m && isLang(m[1])) return posField(m[1]);
  if (["exemple", "example"].includes(n)) return "example";
  const x = /^(?:trad_exemple|extr|exemple_tr)[_:]([a-z]{2,3})$/.exec(n);   // traduction de l'exemple (étape 35)
  if (x && isLang(x[1])) return exTrField(x[1]);
  const y = /^(?:exemple|example|exl)[_:]([a-z]{2,3})$/.exec(n);              // exemple d'une langue étudiée en plus (étape 37)
  if (y && isLang(y[1])) return exlField(y[1]);
  const z = /^(?:trad_exemple|exlt)[_:]([a-z]{2,3})[_:]([a-z]{2,3})$/.exec(n);
  if (z && isLang(z[1]) && isLang(z[2])) return exltField(z[1], z[2]);
  for (const ty of Object.keys(FX_TYPED_COLS)) { const x = FX_TYPED_COLS[ty].find(([nm]) => nm === n); if (x) return x[1]; }
  if (n === "examples") return "f:examples";
  return isLang(n) ? n : "ignore";
}
// texts : [{ name, text }]. Renvoie { rows: Map(id → { cells, file, line }), bad: [{ file, line }], dupRows, files, headers }.
function fxParse(texts) {
  const rows = new Map(), bad = [];
  let headers = 0, dupRows = 0, total = 0;
  texts.forEach(src => {
    const lines = bulkLines(src.text);
    const sep = bulkSeparator(lines.filter(l => !/^\s*#/.test(l)));
    let head = null;
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("```")) return;
      const cells = line.split(sep).map(s => s.trim().replace(/^"(.*)"$/, "$1"));
      if (normText(cells[0]) === "id" && normText(cells[1]) === "type") { head = cells.map(fxColKey); headers++; return; }
      if (!head) return;                                   // texte avant la ligne d'en-tête : ignoré
      total++;
      const ty = TYPE_PREFIX[normText(cells[1] || "").replace(/\s+/g, "")];
      if (cells.length !== head.length || !cells[0] || !ty || ty === "conjtab") { bad.push({ file: src.name, line: i + 1 }); return; }
      if (rows.has(cells[0])) { dupRows++; return; }       // même carte dans deux fichiers : la première ligne compte
      const v = {};
      head.forEach((k, j) => { if (k !== "ignore") v[k] = cells[j]; });
      rows.set(cells[0], { v, type: ty, file: src.name, line: i + 1 });
    });
  });
  return { rows, bad, dupRows, headers, total };
}
function fxSame(c, f, a, b) {
  if (isPosField(f)) return parsePos(a, f.slice(4)) === parsePos(b, f.slice(4));
  const n = s => String(s || "").replace(/\s+/g, " ").replace(/\s*\|\s*/g, " | ").trim();
  return n(a) === n(b);
}
// Pourquoi une proposition ne serait pas ajoutée (mêmes règles qu'addProposal) : "pending", "rejected", "invalid" ou null.
function fxBlock(c, f, v) {
  let nv = String(v || "").replace(/\s+/g, " ").trim();
  if (isPosField(f)) nv = parsePos(nv, f.slice(4));
  if (!nv) return "invalid";
  if (state.proposals.some(x => x.cardId === c.id && x.field === f)) return "pending";
  if (state.rejected.includes(rejectKey(c.id, f, nv))) return "rejected";
  return null;
}
// Analyse sans rien modifier. Renvoie le bilan + les propositions à créer.
function fxAnalyze(parsed) {
  const byId = new Map(state.cards.map(c => [c.id, c]));
  const r = { found: 0, unknown: 0, bad: parsed.bad.slice(), modified: 0, fills: [], already: 0, invalid: 0, corrs: [], corrBlocked: 0, empty: 0 };
  parsed.rows.forEach((row, id) => {
    const c = byId.get(id);
    if (!c) { r.unknown++; return; }
    if (cardType(c) !== row.type) { r.bad.push({ file: row.file, line: row.line }); return; }
    r.found++;
    const modified = !!row.v.sig && row.v.sig !== fxSig(c);
    if (modified) r.modified++;
    const lg = cardLangs(c), fill = new Set(fxFillable(c, lg)), check = new Set(isVocab(c) ? checkFields(c, lg) : fxFillable(c, lg).concat([typedField("note")]));
    let gap = false;
    Object.keys(row.v).forEach(k => {
      const f = k;
      if (!check.has(f) && !fill.has(f)) return;
      const v = String(row.v[k] || "").trim(), cur = fieldVal(c, f).trim();
      if (!cur && fill.has(f) && (!v || v === FX_EMPTY)) { if (!v) gap = true; return; }
      if (!v || v === FX_EMPTY) return;
      if (!cur) {
        if (!fill.has(f)) return;
        const b = fxBlock(c, f, v);
        if (b === "invalid") r.invalid++;
        else if (b) r.already++;
        else r.fills.push({ c, f, v });
      } else if (!fxSame(c, f, v, cur) && !modified) {   // case déjà remplie changée par Claude : jamais appliquée d'office
        const b = fxBlock(c, f, v);
        if (b === "invalid") r.invalid++;
        else if (b) r.corrBlocked++;
        else r.corrs.push({ c, f, v, cur });
      }
    });
    if (gap) r.empty++;
  });
  return r;
}
function fxSummary(parsed, r, nFiles) {
  const wrap = el("div", "fx-sum");
  const line = (txt, cls) => { const d = el("div", "fx-line" + (cls ? " " + cls : ""), txt); wrap.appendChild(d); return d; };
  line(t("fx.sum.files", { n: nFiles, m: parsed.total }), "muted");
  line(t("fx.sum.found", { n: r.found }));
  line(t("fx.sum.filled", { n: r.fills.length }), r.fills.length ? "ok" : "");
  if (r.already) line(t("fx.sum.already", { n: r.already }), "muted");
  if (r.invalid) line(t("fx.sum.invalid", { n: r.invalid }), "warn");
  if (r.empty) line(t("fx.sum.empty", { n: r.empty }), "muted");
  line(t("fx.sum.unknown", { n: r.unknown }), r.unknown ? "warn" : "muted");
  const b = line(t("fx.sum.bad", { n: r.bad.length }), r.bad.length ? "warn" : "muted");
  if (r.bad.length) b.appendChild(el("div", "fx-detail", r.bad.slice(0, 8).map(x => t("fx.sum.badLine", { file: x.file, line: x.line })).join(" · ") + (r.bad.length > 8 ? " …" : "")));
  line(t("fx.sum.modified", { n: r.modified }), r.modified ? "warn" : "muted");
  if (parsed.dupRows) line(t("fx.sum.dupRows", { n: parsed.dupRows }), "muted");
  const sendCorr = { on: false };
  if (r.corrs.length || r.corrBlocked) {
    const box = el("div", "fx-corr");
    box.appendChild(el("div", "fx-line warn", t("fx.sum.corr", { n: r.corrs.length + r.corrBlocked })));
    r.corrs.slice(0, 5).forEach(x => box.appendChild(el("div", "fx-detail", "• " + cardTitle(x.c) + " — " + pvFieldLabel(x.f) + " : " + x.cur + " → " + x.v)));
    if (r.corrs.length > 5) box.appendChild(el("div", "fx-detail", "…"));
    if (r.corrs.length) {
      const lab = el("label", "fx-check");
      const cb = el("input"); cb.type = "checkbox";
      cb.addEventListener("change", () => { sendCorr.on = cb.checked; });
      lab.append(cb, el("span", null, t("fx.sum.corrSend", { n: r.corrs.length })));
      box.appendChild(lab);
    }
    wrap.appendChild(box);
  }
  return { node: wrap, sendCorr };
}
// Ajoute les propositions (complétions, + corrections si demandé). Renvoie le nombre ajouté.
function fxApply(r, withCorr) {
  let n = 0;
  r.fills.forEach(x => { if (state.cards.includes(x.c) && addProposal({ cardId: x.c.id, field: x.f, type: "completion", newValue: x.v, reason: t("fx.reason") })) n++; });
  if (withCorr) r.corrs.forEach(x => { if (state.cards.includes(x.c) && addProposal({ cardId: x.c.id, field: x.f, type: "correction", newValue: x.v, reason: t("fx.corrReason") })) n++; });
  return n;
}

// Fenêtre « Importer la réponse de Claude » : fichiers (plusieurs) et / ou texte collé.
function openFxImport() {
  const files = [];
  const wrap = el("div");
  wrap.appendChild(el("p", "muted", t("fx.importHelp")));
  const fileInp = el("input", "file-input"); fileInp.type = "file"; fileInp.id = "fxFile-" + uid();
  fileInp.accept = ".txt,.csv,.tsv,text/plain,text/csv"; fileInp.multiple = true; fileInp.tabIndex = -1;
  const pick = el("label", "btn file-pick", t("fx.files")); pick.htmlFor = fileInp.id;
  pick.tabIndex = 0; pick.setAttribute("role", "button");
  pick.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInp.click(); } });
  const zone = el("div", "drop-zone");
  const chips = el("div", "fx-chips");
  zone.append(fileInp, pick, chips, el("div", "drop-hint", t("fx.drop")));
  wrap.appendChild(zone);
  const ta = el("textarea", "bulk-ta");
  ta.spellcheck = false;
  ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
  ta.addEventListener("input", () => autoGrow(ta));
  wrap.appendChild(formField(t("fx.paste"), ta));
  const drawChips = () => {
    chips.textContent = "";
    files.forEach((f, i) => {
      const chip = el("div", "file-chip");
      const rm = el("button", "link-btn", t("bulk.fileRemove")); rm.type = "button";
      rm.addEventListener("click", () => { files.splice(i, 1); drawChips(); });
      chip.append(el("span", null, t("bulk.fileInfo", { name: f.name, n: countBulkLines(f.text) })), rm);
      chips.appendChild(chip);
    });
  };
  const load = async list => {
    for (const f of Array.from(list || [])) {
      if (!/\.(txt|csv|tsv)$/i.test(f.name || "") && !/^text\//.test(f.type || "")) { toast(t("bulk.fileType")); continue; }
      try { const text = await readTextFile(f); if (!files.some(x => x.name === f.name && x.text === text)) files.push({ name: f.name, text }); }
      catch (e) { toast(t("fx.readErr", { name: f.name })); }
    }
    drawChips();
  };
  fileInp.addEventListener("change", () => { const l = Array.from(fileInp.files || []); fileInp.value = ""; load(l); });
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("over"); load(e.dataTransfer && e.dataTransfer.files); });
  openModal(t("ai.importReply"), wrap, [
    { label: t("cancel") },
    { label: t("reply.analyze"), kind: "primary", onClick: () => {
      const texts = files.slice();
      if (ta.value.trim()) texts.push({ name: t("fx.pasted"), text: ta.value });
      if (!texts.length) { toast(t("fx.empty")); return false; }
      fxImportTexts(texts);
    } }
  ]);
}
// Analyse puis bilan avant validation. Sans en-tête « id;type » : ancien format « Préparer pour Claude ».
function fxImportTexts(texts) {
  const parsed = fxParse(texts);
  if (!parsed.headers) {
    const res = importReply(texts.map(x => x.text).join("\n"));
    if (!res.added) { toast(t("fx.noHeader")); return; }
    commit();
    openModal(t("ai.doneTitle"), el("p", null, t("reply.done", { n: res.added, m: res.unknown })), [
      { label: t("close") }, { label: t("ai.see"), kind: "primary", onClick: () => { goPending(); } }
    ]);
    return;
  }
  const st = state;
  const r = fxAnalyze(parsed);
  const s = fxSummary(parsed, r, texts.length);
  const acts = [{ label: t("cancel") }];
  if (r.fills.length || r.corrs.length) acts.push({ label: t("fx.send"), kind: "primary", onClick: () => {
    if (state !== st) return;
    const n = fxApply(r, s.sendCorr.on);
    if (!n) { toast(t("fx.nothing")); return; }
    commit();
    openModal(t("ai.doneTitle"), el("p", null, t("fx.sent", { n })), [
      { label: t("close") }, { label: t("ai.see"), kind: "primary", onClick: () => { goPending(); } }
    ]);
  } });
  else s.node.appendChild(el("p", "fx-line warn", t("fx.nothing")));
  openModal(t("fx.sumTitle"), s.node, acts);
}

