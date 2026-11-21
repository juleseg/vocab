"use strict";

// === IMPORT EN MASSE (TEXTE & FICHIER) ===
// Une ligne par carte, colonnes séparées par ";" (ou tabulation, détectée automatiquement).
// Colonnes par défaut : langue de l'interface, langue d'appui, langue apprise, exemple, tags, nature
// (ex. coréen;anglais;français;exemple;tags).
// Colonnes souples (étape 35) : n'importe quelle langue de LANGUAGES par son code ou son nom (« it », « italien »),
// pos_<code> (nature dans cette langue), ex_<code> (exemple dans cette langue), ex_<code>_<code2> (traduction de cet
// exemple dans code2), tags. Une ligne peut remplir plusieurs langues et plusieurs exemples.
// Ligne d'en-tête reconnue : colonnes associées automatiquement. Associations internes : code de langue, "pos:<code>",
// "ex:<code>", "ex:<code>:<code2>", "tags", "ignore" (anciennes : "example" = ex:<langue apprise>, "pos" = pos:<langue apprise>).
// Dans l'aperçu : un menu au-dessus de chaque colonne pour corriger l'association ; le dernier choix est mémorisé
// (localStorage "vocabfr.importMap") et repris si la langue apprise y figure.
// Un seul analyseur pour le collage et les fichiers .txt/.csv : BOM retiré, fins de ligne \r\n / \r / \n, lignes vides ignorées.
const BULK_CHUNK = 2000;   // lignes traitées avant de rendre la main à l'écran
const BULK_PAGE = 100;     // lignes par page dans l'aperçu
const BULK_KINDS = ["tags", "ignore"]; // en plus des codes de langue, pos:<code>, ex:<code>, ex:<code>:<code2>
const yieldUI = () => new Promise(r => setTimeout(r, 0));

function bulkLines(text) {
  return String(text || "").replace(/^﻿/, "").split(/\r\n|\r|\n/);
}
function bulkSeparator(lines) {
  let tab = 0, semi = 0, n = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    if (l.includes("\t")) tab++;
    if (l.includes(";")) semi++;
    if (++n >= 50) break;
  }
  return tab > semi ? "\t" : ";";
}
// Nature d'une cellule d'en-tête : code de langue, "pos:<code>", "ex:<code>", "ex:<code>:<code2>", "example", "tags",
// "pos", ou null (non reconnue).
const HEADER_WORDS = {
  example: ["example", "examples", "exemple", "exemples", "예문", "phrase"],
  tags: ["tags", "tag", "태그", "etiquettes"],
  pos: ["nature", "pos", "품사", "nature grammaticale", "part of speech"]
};
function langOfCell(n) { return LANG_CODES.find(code => n === code || Object.values(LANGUAGES[code].names).some(x => normText(x) === n)) || null; }
function headerKind(cell) {
  const n = normText(cell);
  if (!n) return null;
  const code = langOfCell(n);
  if (code) return code;
  for (const k of Object.keys(HEADER_WORDS)) if (HEADER_WORDS[k].includes(n)) return k;
  let m = /^(?:pos|nature)[\s_:-]+([a-z]{2,3})$/.exec(n);
  if (m && isLang(m[1])) return posField(m[1]);
  m = /^(?:ex|exemple|example)[\s_:-]+([a-z]{2,3})[\s_:-]+([a-z]{2,3})$/.exec(n);
  if (m && isLang(m[1]) && isLang(m[2]) && m[1] !== m[2]) return "ex:" + m[1] + ":" + m[2];
  m = /^(?:ex|exemple|example)[\s_:-]+([a-z]{2,3})$/.exec(n);
  if (m && isLang(m[1])) return "ex:" + m[1];
  return null;
}
// Association valide : langue, nature d'une langue, exemple d'une langue, traduction d'un exemple, tags, ignorer.
function isBulkKind(k) {
  if (isLang(k) || isPosField(k) || BULK_KINDS.includes(k)) return true;
  const p = String(k || "").split(":");
  return p[0] === "ex" && (p.length === 2 ? isLang(p[1]) : p.length === 3 && isLang(p[1]) && isLang(p[2]) && p[1] !== p[2]);
}
// Anciennes associations (avant l'étape 35) : exemple et nature = ceux de la langue apprise.
function normKind(k, lg) { return k === "example" ? "ex:" + lg.target : k === "pos" ? posField(lg.target) : k; }
// En-tête : au moins 2 cellules reconnues et aucune cellule remplie non reconnue.
function parseHeader(cols) {
  const kinds = cols.map(headerKind);
  const known = kinds.filter(Boolean).length;
  if (known < 2 || cols.some((c, i) => c.trim() && !kinds[i])) return null;
  return kinds.map(k => k || "ignore");
}
function countBulkLines(text) { return bulkLines(text).filter(l => l.trim()).length; }
// Association par défaut : langue de l'interface, langue d'appui, langue apprise, exemple, tags, nature, puis colonnes ignorées.
function defaultBulkMap(n, lg) {
  const base = lg.support.concat([lg.target, "ex:" + lg.target, "tags", posField(lg.target)]);
  const out = [];
  for (let i = 0; i < n; i++) out.push(base[i] || "ignore");
  return out;
}
// Une même association (sauf "ignore") ne peut servir qu'une fois.
function fixBulkMap(map) {
  const used = new Set();
  return map.map(k => {
    if (k !== "ignore" && (used.has(k) || !isBulkKind(k))) return "ignore";
    used.add(k); return k;
  });
}
function savedBulkMap(n, lg) {
  try {
    const m = JSON.parse(localStorage.getItem(CONFIG.LS_USER_PREFIX + "importMap") || "null");
    if (m && Array.isArray(m.cols) && m.cols.length === n && m.cols.includes(lg.target)) return fixBulkMap(m.cols.map(k => normKind(String(k), lg)));
  } catch (e) {}
  return null;
}
function rememberBulkMap(map) {
  try { localStorage.setItem(CONFIG.LS_USER_PREFIX + "importMap", JSON.stringify({ cols: map })); } catch (e) {}
}
function bulkKindLabel(k) {
  if (isLang(k)) return langName(k);
  if (isPosField(k)) return t("bulk.kind.posOf", { lang: langName(k.slice(4)) });
  const p = String(k).split(":");
  if (p[0] === "ex" && p.length === 2) return t("bulk.kind.exOf", { lang: langName(p[1]) });
  if (p[0] === "ex" && p.length === 3) return t("bulk.kind.exTrOf", { lang: langName(p[1]), to: langName(p[2]) });
  return t("bulk.kind." + k);
}

// --- Lignes d'autres types de cartes ---
// 1re colonne = vocab, conj, conjtab, trou, erreur ou regle (sinon : ligne de vocabulaire, format habituel).
//   conj;verbe;temps;personne;forme;traduction;note
//   conjtab;verbe;temps;forme1|forme2|…;traduction;note   → une carte par personne, dans l'ordre de la langue
//   trou;phrase avec ___;réponse;indice;explication;traduction
//   erreur;phrase fautive;phrase corrigée;explication
//   regle;titre;texte;exemple1|exemple2|…;traduction       (\n dans le texte = retour à la ligne)
// Temps et personnes : id de LANGUAGES.grammar ou nom dans n'importe quelle langue d'interface. Langue = langue apprise de la liste.
const TYPE_PREFIX = { vocab: "vocab", conj: "conj", conjtab: "conjtab", trou: "cloze", cloze: "cloze", erreur: "fix", fix: "fix", regle: "rule", rule: "rule" };
function linePrefix(cols) { return TYPE_PREFIX[normText(cols[0]).replace(/\s+/g, "")] || null; }
function isTypedLine(line, sep) { const p = linePrefix(line.trim().split(sep)); return !!p && p !== "vocab"; }
// Clé de doublon d'une carte d'un autre type (même liste).
function typedKey(type, f) {
  if (type === "conj") return "conj|" + f.lang + "|" + normText(f.verb) + "|" + f.tense + "|" + f.person;
  if (type === "cloze") return "cloze|" + normText(f.sentence);
  if (type === "fix") return "fix|" + normText(f.wrong);
  if (type === "rule") return "rule|" + normText(f.title);
  return "";
}
// → { rows: [{ type, fields }] } ou { err: texte }
function parseTypedLine(kind, cols, lang) {
  const c = i => String(cols[i] || "").trim();
  if (kind === "conj" || kind === "conjtab") {
    if (!c(1)) return { err: t("type.err.verb") };
    const tn = findTense(lang, c(2));
    if (!tn) return { err: t("bulk.err.tense", { v: c(2), lang: langName(lang) }) };
    const ps = personsOf(lang, tn.id);
    if (kind === "conj") {
      const p = findPerson(lang, tn.id, c(3));
      if (!p) return { err: t("bulk.err.person", { v: c(3) }) };
      if (!c(4)) return { err: t("type.err.answer") };
      return { rows: [{ type: "conj", fields: { lang, verb: c(1), tense: tn.id, person: p.id, answer: c(4), translation: c(5), note: c(6) } }] };
    }
    const forms = c(3).split("|").map(x => x.trim());
    if (!forms.some(Boolean)) return { err: t("type.err.table") };
    if (forms.length > ps.length) return { err: t("bulk.err.forms", { n: forms.length, m: ps.length }) };
    return { rows: forms.map((f, i) => f ? { type: "conj", fields: { lang, verb: c(1), tense: tn.id, person: ps[i].id, answer: f, translation: c(4), note: c(5) } } : null).filter(Boolean) };
  }
  if (kind === "cloze") {
    if (!CLOZE_GAP.test(c(1))) return { err: t("type.err.gap") };
    if (!c(2)) return { err: t("type.err.answer") };
    return { rows: [{ type: "cloze", fields: { lang, sentence: c(1), answer: c(2), hint: c(3), explanation: c(4), translation: c(5) } }] };
  }
  if (kind === "fix") {
    if (!c(1)) return { err: t("type.err.wrong") };
    if (!c(2)) return { err: t("type.err.correct") };
    return { rows: [{ type: "fix", fields: { lang, wrong: c(1), correct: c(2), explanation: c(3) } }] };
  }
  if (kind === "rule") {
    if (!c(1)) return { err: t("type.err.title") };
    if (!c(2)) return { err: t("type.err.body") };
    return { rows: [{ type: "rule", fields: { lang, title: c(1), body: c(2).replace(/\\n/g, "\n"), examples: c(3).split("|"), translation: c(4) } }] };
  }
  return { err: "?" };
}
// Exemple de saisie (zone de collage), construit depuis la démo des langues de l'import.
function bulkPlaceholder(lg) {
  const D = (LANGUAGES[lg.target] && LANGUAGES[lg.target].demo) || {};
  const lines = arr(D.words).slice(2, 4).map(w => {
    const tr = lg.support.map(code => { const x = arr((LANGUAGES[code].demo || {}).words).find(y => y.key === w.key); return x ? x.term : ""; });
    return tr.concat([w.term, w.ex || "", arr(w.tags).join(",")]).join(";");
  });
  const cz = arr(D.cards).find(x => x.type === "cloze");
  if (cz) lines.push("trou;" + cz.sentence + ";" + cz.answer);
  const ct = arr(D.cards).find(x => x.type === "conjtab");
  if (ct) lines.push("conjtab;" + ct.verb + ";" + tenseName(lg.target, ct.tense) + ";" + ct.forms.join("|"));
  return lines.join("\n");
}
// Ligne d'aperçu d'une carte d'un autre type.
function typedRowLine(row) {
  const c = Object.assign({ type: row.typed }, row.fields);
  return TYPE_ICON[row.typed] + " " + cardTitle(c) + " → " + (row.typed === "conj" ? conjFull(c) : cardSubtitle(c));
}

// Analyse par paquets (ne bloque pas l'écran). lg = langues de la liste cible ; map = association choisie (ou null).
// Renvoie { fresh, dups, invalid, header, sep, ncols, map, sample }.
async function parseBulk(text, targetId, lg, map, onProgress) {
  const existing = new Map();
  if (targetId !== "__new__") cardsOf(targetId).forEach(c => {
    const k = isVocab(c) ? dupKey(c.terms, lg) : typedKey(c.type, c);
    if (!existing.has(k)) existing.set(k, c);
  });
  const seen = new Map();
  const res = { fresh: [], dups: [], invalid: [], header: false, sep: ";", ncols: 0, map: null, sample: [] };
  const lines = bulkLines(text);
  const sep = res.sep = bulkSeparator(lines);
  // En-tête et nombre de colonnes (sur les 200 premières lignes)
  let start = 0, headerMap = null;
  while (start < lines.length && !lines[start].trim()) start++;
  if (start < lines.length && !isTypedLine(lines[start], sep)) {
    headerMap = parseHeader(lines[start].trim().split(sep).map(s => s.trim()));
    if (headerMap) res.header = true;
  }
  let ncols = headerMap ? headerMap.length : 0;
  for (let i = start + (headerMap ? 1 : 0), n = 0; i < lines.length && n < 200; i++) {
    if (!lines[i].trim() || isTypedLine(lines[i], sep)) continue;   // colonnes : lignes de vocabulaire seulement
    n++;
    const cs = lines[i].trim().split(sep);
    ncols = Math.max(ncols, cs.length - (linePrefix(cs) === "vocab" ? 1 : 0));
  }
  res.ncols = ncols = Math.max(ncols, 1);
  let m = map && map.length === ncols ? map : (headerMap ? headerMap.concat(defaultBulkMap(ncols, lg).slice(headerMap.length).map(() => "ignore")) : (savedBulkMap(ncols, lg) || defaultBulkMap(ncols, lg)));
  res.map = m = fixBulkMap(m.map(k => normKind(k, lg)));
  const tgCol = m.indexOf(lg.target);

  for (let i = start + (headerMap ? 1 : 0); i < lines.length; i++) {
    if (i && i % BULK_CHUNK === 0) { if (onProgress) onProgress(i / lines.length); await yieldUI(); }
    const lineNo = i + 1;
    const line = lines[i].trim();
    if (!line) continue;
    let cols = line.split(sep).map(s => s.trim());
    const pre = linePrefix(cols);
    if (pre && pre !== "vocab") {
      // Autre type de carte
      const r = parseTypedLine(pre, cols, lg.target);
      if (r.err) { res.invalid.push({ lineNo, raw: line, reason: r.err }); continue; }
      r.rows.forEach(x => {
        const k = typedKey(x.type, x.fields);
        const row = { lineNo, raw: line, typed: x.type, fields: x.fields, tags: [] };
        if (seen.has(k)) { res.invalid.push({ lineNo, raw: line, reason: t("bulk.err.repeat", { n: seen.get(k) }), repeat: true }); return; }
        seen.set(k, lineNo);
        if (existing.has(k)) { row.card = existing.get(k); res.dups.push(row); }
        else res.fresh.push(row);
      });
      continue;
    }
    if (pre === "vocab") cols = cols.slice(1);
    if (res.sample.length < 3) res.sample.push(cols);
    if (cols.length > ncols) { res.invalid.push({ lineNo, raw: line, reason: t("bulk.err.cols", { n: ncols }) }); continue; }
    const row = { lineNo, raw: line, terms: {}, set: [], ex: {}, tags: [], pos: {} };
    m.forEach((k, j) => {
      const v = cols[j] || "";
      if (k === "ignore") return;
      row.set.push(k);
      if (isLang(k)) { if (v) row.terms[k] = v; }
      else if (k === "tags") row.tags = parseTags(v);
      else if (isPosField(k)) { const code = k.slice(4); if (v) row.pos[code] = parsePos(v, code) || v; } // code reconnu, sinon texte gardé tel quel
      else {                                                       // ex:<code> ou ex:<code>:<code2>
        const p = k.split(":"), e = row.ex[p[1]] || (row.ex[p[1]] = { text: "", tr: {} });
        if (p.length === 2) e.text = v; else if (v) e.tr[p[2]] = v;
      }
    });
    if (tgCol < 0 || !row.terms[lg.target]) { res.invalid.push({ lineNo, raw: line, reason: t("bulk.err.target", { lang: langName(lg.target) }) }); continue; }
    // Au moins une traduction : langue d'appui, ou autre langue (gardée, cachée ; la carte est alors « à compléter », étape 31).
    if (!Object.keys(row.terms).some(c => c !== lg.target && row.terms[c])) {
      res.invalid.push({ lineNo, raw: line, reason: t("bulk.err.support", { langs: lg.support.map(x => langName(x)).join(", ") }) }); continue;
    }
    const k = dupKey(row.terms, lg);
    if (seen.has(k)) { res.invalid.push({ lineNo, raw: line, reason: t("bulk.err.repeat", { n: seen.get(k) }), repeat: true }); continue; }
    seen.set(k, lineNo);
    if (existing.has(k)) { row.card = existing.get(k); res.dups.push(row); }
    else res.fresh.push(row);
  }
  if (onProgress) onProgress(1);
  return res;
}

// Fenêtre d'attente avec texte mis à jour ; renvoie { set(msg), close() }.
function openBusy(msg) {
  const p = el("p", "muted", msg);
  const close = openModal(t("bulk.wait"), p, []);
  return { set: m => { p.textContent = m; }, close };
}

function autoGrow(ta) {
  try { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 2) + "px"; } catch (e) {}
}

function readTextFile(f) {
  return new Promise((ok, ko) => {
    try {
      const r = new FileReader();
      r.onload = () => ok(String(r.result || ""));
      r.onerror = () => ko(r.error || new Error("read"));
      r.readAsText(f, "UTF-8");
    } catch (e) { ko(e); }
  });
}

// Langues de l'import : celles de la liste existante, ou celles choisies pour la nouvelle liste.
function bulkLangs(o) { return o.target === "__new__" ? o.lang : listLangs(o.target); }

// opts : { text, target (id | "__new__"), newName, folder ("" | id | "__new__"), newFolder, lang { target, support } | null,
//          langTouched, file: { name, text, lines } | null, map }
function openBulkImport(opts) {
  opts.file = opts.file || null;
  opts.folder = opts.folder || "";
  const sel = listSelect(opts.target, true);
  const nameInp = textInput(opts.newName, "");
  const nameField = formField(t("bulk.newListName"), nameInp, true);
  const fsel = folderSelect(opts.folder, true);
  const fnameInp = textInput(opts.newFolder || "", "");
  const fnameField = formField(t("folders.newName"), fnameInp, true);
  const folderField = formField(t("folders.folder"), fsel);
  const langBox = el("div");
  // Langues : pré-remplies depuis le dossier (nouvelle liste), ou celles de la liste existante (lecture seule).
  const drawLangs = () => {
    langBox.textContent = "";
    try { ta.placeholder = bulkPlaceholder(sel.value !== "__new__" ? listLangs(sel.value) : (opts.lang || folderLangs(getFolder(fsel.value)))); } catch (e) {}
    if (sel.value !== "__new__") {
      const lg = listLangs(sel.value);
      langBox.appendChild(formField(t("langs.title"), el("div", "lang-ro", pairLabel(lg) + " — " + langName(lg.target)), false, t("bulk.langsOfList")));
      return;
    }
    if (!opts.langTouched || !opts.lang) opts.lang = folderLangs(getFolder(fsel.value));
    langBox.appendChild(langPicker(opts.lang.target, opts.lang.support, (tg, sp) => {
      opts.lang = { target: tg, support: sp }; opts.langTouched = true; opts.map = null; drawLangs();
    }));
  };
  const sync = () => {
    const isNew = sel.value === "__new__";
    nameField.hidden = !isNew; folderField.hidden = !isNew;
    fnameField.hidden = !isNew || fsel.value !== "__new__";
    drawLangs();
  };
  sel.addEventListener("change", () => { opts.map = null; sync(); });
  fsel.addEventListener("change", sync);

  // --- Fichier : bouton + glisser-déposer ---
  // Le bouton est un <label for> lié au vrai input : le navigateur ouvre le sélecteur lui-même (iPhone, Android, ordinateur).
  const fileInp = el("input", "file-input"); fileInp.type = "file"; fileInp.id = "bulkFile-" + uid();
  fileInp.accept = ".txt,.csv,text/plain,text/csv";
  fileInp.tabIndex = -1;
  const pick = el("label", "btn file-pick", t("bulk.fileBtn")); pick.htmlFor = fileInp.id;
  pick.tabIndex = 0; pick.setAttribute("role", "button");
  pick.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInp.click(); } });
  const zone = el("div", "drop-zone");
  const chip = el("div", "file-chip");
  const chipTxt = el("span");
  const rm = el("button", "link-btn", t("bulk.fileRemove")); rm.type = "button";
  chip.append(chipTxt, rm);
  zone.append(fileInp, pick, chip, el("div", "drop-hint", t("bulk.drop")));

  const ta = el("textarea", "bulk-ta");
  ta.value = opts.text;
  ta.placeholder = bulkPlaceholder(bulkLangs({ target: opts.target, lang: opts.lang || accountLangs() }));
  ta.spellcheck = false;
  ta.setAttribute("autocapitalize", "off"); ta.setAttribute("autocorrect", "off");
  ta.addEventListener("input", () => autoGrow(ta));
  const taField = formField(t("bulk.or"), ta, false, t("bulk.format") + " " + t("bulk.formatTypes"));

  const showFile = () => {
    const f = opts.file;
    chip.hidden = !f; pick.hidden = !!f; taField.hidden = !!f;
    if (f) chipTxt.textContent = t("bulk.fileInfo", { name: f.name, n: f.lines });
  };
  rm.addEventListener("click", () => { opts.file = null; opts.map = null; showFile(); setTimeout(() => autoGrow(ta), 0); });

  const loadFile = async f => {
    if (!f) return;
    if (!/\.(txt|csv|tsv)$/i.test(f.name || "") && !/^text\//.test(f.type || "")) { toast(t("bulk.fileType")); return; }
    try {
      const text = await readTextFile(f);
      const base = String(f.name || "").replace(/\.[^.]+$/, "").trim();
      opts.file = { name: f.name, text, lines: countBulkLines(text) };
      opts.map = null;
      sel.value = "__new__"; if (base) nameInp.value = base; sync();
      showFile();
    } catch (e) { toast(t("bulk.fileError")); }
  };
  fileInp.addEventListener("change", () => { const f = fileInp.files && fileInp.files[0]; fileInp.value = ""; loadFile(f); });
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", e => {
    e.preventDefault(); zone.classList.remove("over");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(f);
  });

  const wrap = el("div");
  wrap.append(formField(t("bulk.target"), sel), nameField, folderField, fnameField, langBox,
    formField(t("bulk.file"), zone, false, t("bulk.fileHint")), taField);
  sync();
  showFile();
  openModal(t("bulk.title"), wrap, [
    { label: t("cancel") },
    { label: t("bulk.preview"), kind: "primary", onClick: () => {
      const o = Object.assign({}, opts, { text: ta.value, target: sel.value, newName: nameInp.value.trim(),
        folder: fsel.value, newFolder: fnameInp.value.trim() });
      const src = o.file ? o.file.text : o.text;
      if (!src.trim()) { toast(t("bulk.nothing")); return false; }
      if (o.target === "__new__" && !o.newName) { toast(t("lists.nameRequired")); return false; }
      if (o.target === "__new__" && o.folder === "__new__" && !o.newFolder) { toast(t("folders.nameRequired")); return false; }
      if (o.map && opts.target !== o.target) o.map = null;
      openBulkPreview(o);
    } }
  ]);
  setTimeout(() => autoGrow(ta), 0);
}

// Tableau des colonnes : un menu par colonne (langue, nature, exemple, traduction de l'exemple, tags, ignorer)
// au-dessus de 3 lignes d'exemple.
function bulkColumns(r, lg, onChange) {
  const scroller = el("div", "col-map");
  const table = el("table");
  const hr = el("tr");
  // Associations proposées : langues affichées (displayLangs), leur nature, l'exemple de la langue apprise et ses
  // traductions. Une colonne déjà associée à autre chose (en-tête reconnu) garde son choix : importée, mais cachée.
  const shown = visibleLangs(lg);
  const offer = shown.concat(shown.map(posField), ["ex:" + lg.target], lg.support.map(x => "ex:" + lg.target + ":" + x));
  r.map.forEach((k, i) => {
    const th = el("th");
    const s = el("select", "input");
    const kinds = offer.concat(r.map.filter(x => !offer.includes(x) && !BULK_KINDS.includes(x)).filter((x, j, a) => a.indexOf(x) === j)).concat(BULK_KINDS);
    kinds.forEach(x => { const o = el("option", null, bulkKindLabel(x) + (x === lg.target ? " ★" : "")); o.value = x; s.appendChild(o); });
    s.value = k;
    s.addEventListener("change", () => {
      const m = r.map.slice();
      if (s.value !== "ignore") m.forEach((x, j) => { if (j !== i && x === s.value) m[j] = "ignore"; }); // déjà utilisée ailleurs : l'autre colonne est ignorée
      m[i] = s.value;
      onChange(m);
    });
    th.appendChild(s);
    hr.appendChild(th);
  });
  table.appendChild(hr);
  r.sample.forEach(cols => {
    const tr = el("tr");
    r.map.forEach((k, i) => { const td = el("td", k === "ignore" ? "muted" : null, cols[i] || ""); if (isLang(k)) td.lang = k; tr.appendChild(td); });
    table.appendChild(tr);
  });
  scroller.appendChild(table);
  return formField(t("bulk.columns"), scroller, false, t("bulk.columnsHint", { lang: langName(lg.target) }));
}

async function openBulkPreview(opts) {
  const lg = bulkLangs(opts);
  const busy = openBusy(t("bulk.analyzing", { p: 0 }));
  let r;
  try {
    r = await parseBulk(opts.file ? opts.file.text : opts.text, opts.target, lg, opts.map,
      x => busy.set(t("bulk.analyzing", { p: Math.round(x * 100) })));
  } catch (e) { busy.close(); toast(t("bulk.nothing")); return; }
  busy.close();
  opts.map = r.map;
  let dupMode = "ignore";
  let closeFn = null;
  const wrap = el("div");

  const sum = el("div", "preview-sum");
  const dest = opts.target === "__new__" ? opts.newName : (getList(opts.target) || {}).name;
  sum.appendChild(el("div", "muted", t("bulk.dest", { name: dest || "", pair: pairLabel(lg) })));
  if (opts.file) sum.appendChild(el("div", "muted", t("bulk.fileInfo", { name: opts.file.name, n: opts.file.lines }) + (r.header ? " · " + t("bulk.header") : "")));
  else if (r.header) sum.appendChild(el("div", "muted", t("bulk.header")));
  sum.appendChild(el("div", null, t("bulk.newCount", { n: r.fresh.length })));
  const byType = {};
  r.fresh.forEach(x => { const k = x.typed || "vocab"; byType[k] = (byType[k] || 0) + 1; });
  if (Object.keys(byType).some(k => k !== "vocab")) {
    sum.appendChild(el("div", "muted", CARD_TYPES.filter(k => byType[k]).map(k => t("type." + k) + " : " + byType[k]).join(" · ")));
  }
  if (r.dups.length) sum.appendChild(el("div", null, t("bulk.dupCount", { n: r.dups.length })));
  if (r.invalid.length) sum.appendChild(el("div", null, t("bulk.invalidCount", { n: r.invalid.length })));
  wrap.appendChild(sum);

  wrap.appendChild(bulkColumns(r, lg, m => {
    if (!m.includes(lg.target)) toast(t("bulk.needTarget", { lang: langName(lg.target) }));
    if (closeFn) closeFn();
    openBulkPreview(Object.assign({}, opts, { map: m }));
  }));

  const cardLine = row => row.typed ? typedRowLine(row) : (row.terms[lg.target] || "—") + " — " + lg.support.map(c => row.terms[c]).filter(Boolean).join(" · ");
  // Section paginée (BULK_PAGE lignes par page) : supporte des milliers de lignes.
  const section = (title, rows, cls, fn) => {
    const f = el("div", "field");
    f.appendChild(el("label", null, title));
    const box = el("div", "preview-box");
    f.appendChild(box);
    let page = 0;
    const pages = Math.ceil(rows.length / BULK_PAGE);
    const pager = el("div", "pager");
    const prev = el("button", null, "‹"), next = el("button", null, "›"), info = el("span");
    prev.type = next.type = "button";
    pager.append(prev, info, next);
    const draw = () => {
      box.textContent = "";
      const a = page * BULK_PAGE, b = Math.min(rows.length, a + BULK_PAGE);
      for (let i = a; i < b; i++) box.appendChild(el("div", "pl " + cls, fn(rows[i])));
      box.scrollTop = 0;
      info.textContent = t("bulk.page", { a: a + 1, b, n: rows.length });
      prev.disabled = page === 0; next.disabled = page >= pages - 1;
    };
    prev.addEventListener("click", () => { if (page > 0) { page--; draw(); } });
    next.addEventListener("click", () => { if (page < pages - 1) { page++; draw(); } });
    if (pages > 1) f.appendChild(pager);
    draw();
    return f;
  };

  if (r.invalid.length) {
    wrap.appendChild(section(t("bulk.invalidTitle"), r.invalid, "bad",
      row => t("bulk.line", { n: row.lineNo }) + " : " + row.reason + " — " + row.raw));
  }
  if (r.dups.length) {
    const f = section(t("bulk.dupTitle"), r.dups, "dup", row => t("bulk.line", { n: row.lineNo }) + " : " + cardLine(row));
    const seg = el("div", "seg");
    ["ignore", "replace"].forEach(m => {
      const b = el("button", null, t("bulk." + m));
      b.setAttribute("aria-pressed", String(m === dupMode));
      b.addEventListener("click", () => {
        dupMode = m;
        seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      });
      seg.appendChild(b);
    });
    f.append(seg, el("div", "hint", t("bulk.replaceHint")));
    wrap.appendChild(f);
  }
  if (r.fresh.length) {
    wrap.appendChild(section(t("bulk.newTitle"), r.fresh, "", cardLine));
  }

  closeFn = openModal(t("bulk.title"), wrap, [
    { label: t("bulk.back"), onClick: () => { openBulkImport(opts); } },
    { label: t("bulk.import"), kind: "primary", onClick: () => {
      const nReplace = dupMode === "replace" ? r.dups.length : 0;
      if (!r.fresh.length && !nReplace) { toast(t("bulk.nothing")); return false; }
      rememberBulkMap(r.map);
      runBulkImport(opts, r, nReplace, lg);
    } }
  ]);
}

// Applique l'import par lots de CONFIG.IMPORT_BATCH cartes, dans l'ordre des lignes, avec barre de progression.
// Chaque lot est enregistré (appareil + cloud) avant de passer au suivant.
// Lot refusé par l'appareil : le lot est annulé, les lots précédents sont gardés. Envoi cloud refusé : le lot est
// gardé sur l'appareil (synchro plus tard). Dans les deux cas : arrêt et ligne à partir de laquelle reprendre.
// Nouvelle liste : créée dans le dossier choisi (ou un nouveau dossier) ; ses langues ne sont enregistrées
// que si elles diffèrent de celles du dossier (sinon elle en hérite).
async function runBulkImport(opts, r, nReplace, lg) {
  const rows = r.fresh.concat(nReplace ? r.dups : []).sort((a, b) => a.lineNo - b.lineNo);
  const total = rows.length;
  const prog = openProgress(t("bulk.title"), t("bulk.progress", { a: 0, n: total }));
  let listId = opts.target, newList = null, newFolder = null;
  if (listId === "__new__") {
    let folderId = opts.folder || null;
    if (folderId === "__new__") {
      newFolder = { id: uid(), name: opts.newFolder, order: nextOrder(state.folders) };
      state.folders.push(newFolder); folderId = newFolder.id;
    } else if (folderId && !getFolder(folderId)) folderId = null;
    newList = { id: uid(), name: opts.newName, folderId, order: nextOrder(listsIn(folderId)), createdAt: Date.now() };
    if (lg.target !== folderLangs(getFolder(folderId)).target) newList.target = lg.target;   // appui : celui du profil (étape 35)
    ensureLearning(lg.target);
    state.lists.push(newList); listId = newList.id;
  }
  const st = state;
  const addedIds = [];
  let done = 0, added = 0, replaced = 0, stop = null;
  for (let i = 0; i < total; i += CONFIG.IMPORT_BATCH) {
    const batch = rows.slice(i, i + CONFIG.IMPORT_BATCH);
    const undo = [], batchIds = [];
    let nAdd = 0, nRep = 0;
    batch.forEach(row => {
      if (row.card && row.typed) {
        // Autre type : les champs importés remplacent le contenu ; progression et règle liée conservées
        const c = row.card;
        undo.push([c, normTypedFields(c.type, c)]);
        const keepRule = c.ruleId;
        Object.assign(c, normTypedFields(row.typed, row.fields));
        if (keepRule && "ruleId" in c) c.ruleId = keepRule;
        nRep++;
      } else if (row.typed) {
        const nc = newTypedCard(listId, row.typed, Object.assign({}, row.fields, { lang: lg.target }), []);
        state.cards.push(nc); batchIds.push(nc.id); nAdd++;
      } else if (row.card) {
        const c = row.card;
        undo.push([c, { terms: Object.assign({}, c.terms), pos: Object.assign({}, c.pos), examples: c.examples, example: c.example, tags: c.tags, own: c.own }]);
        const snap = Dict.track(c);                     // dictionnaire commun (étape 36)
        // Colonnes importées : remplacent le contenu existant ; progression conservée
        row.set.forEach(k => {
          if (isLang(k)) { if (row.terms[k]) c.terms[k] = row.terms[k]; else delete c.terms[k]; }
          else if (k === "tags") c.tags = row.tags;
          else if (isPosField(k)) { const code = k.slice(4); c.pos = Object.assign({}, c.pos); if (row.pos[code]) c.pos[code] = row.pos[code]; else delete c.pos[code]; }
          else { const p = k.split(":"), e = row.ex[p[1]] || { text: "", tr: {} }; setExPart(c, p[1], p[2] || null, p[2] ? e.tr[p[2]] : e.text, p[1] === lg.target); }
        });
        Dict.changed(c, snap);                          // valeurs remplacées : commun rempli ou proposition
        nRep++;
      } else {
        const nc = newCard(listId, row.terms, normExamples(row.ex), row.tags, row.pos, lg.target);
        state.cards.push(nc); batchIds.push(nc.id); nAdd++;
      }
    });
    state.updatedAt = Date.now();
    const res = await Storage.saveNow(state);
    if (state !== st) { prog.close(); return; } // compte changé entre-temps
    if (!res.local) {
      // Annule ce lot seulement (les lots précédents sont déjà enregistrés).
      const drop = new Set(batchIds);
      state.cards = state.cards.filter(c => !drop.has(c.id));
      undo.forEach(([c, v]) => Object.assign(c, v));
      if (newList && !addedIds.length) {
        state.lists = state.lists.filter(l => l !== newList);
        if (newFolder) state.folders = state.folders.filter(f => f !== newFolder);
      }
      state.updatedAt = Date.now();
      Storage.save(state);
      stop = { key: "bulk.stopLocal", line: batch[0].lineNo };
      break;
    }
    addedIds.push(...batchIds); added += nAdd; replaced += nRep;
    done += batch.length;
    prog.set(done / total, t("bulk.progress", { a: done, n: total }));
    if (!res.remote) {
      if (done < total) stop = { key: "bulk.stopRemote", line: rows[done].lineNo };
      else toast(t("storage.info.error"));
      break;
    }
    await yieldUI();
  }
  prog.close();
  lv.listId = (newList && !state.lists.includes(newList)) ? null : listId; lv.query = "";
  render();
  if (added + replaced > 0) {                   // journal : import terminé (ou arrêté)
    const il = getList(listId);
    Activity.log("import", { n: added, replaced, list: il ? il.name : "", stopped: !!stop });
  }
  if (stop) {
    openModal(t("bulk.stopTitle"), el("p", null, t(stop.key, { n: added + replaced, line: stop.line })), [{ label: t("close"), kind: "primary" }]);
    Dict.afterAdd(addedIds).then(() => { try { if (typeof AutoMaj !== "undefined") AutoMaj.kick("import"); } catch (e) {} });   // dictionnaire commun (étape 36) : cartes déjà importées ; étape 80 : cases vides complétées toutes seules
    return;
  }
  toast(t("bulk.done", { n: added, m: replaced }));
  // Dictionnaire commun (étape 36) : cartes reliées (cases vides remplies tout de suite), puis complétion proposée
  Dict.afterAdd(addedIds).then(() => offerCompletion(addedIds)); // champs vides : proposer de les compléter
}
