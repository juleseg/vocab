"use strict";

// === ADMINISTRATION : SAUVEGARDES (ÉTAPE 50) ===
// Écran #admin-sauvegardes (admin, mode Supabase). Fonctions SQL du script supabase-etape50.sql (security definer,
// contrôle is_admin()) : admin_backups_list (lignes de la table backups, taille totale, attente avant « Sauvegarder
// maintenant »), admin_backup_status (alerte du tableau de bord). Fonction Supabase « backup » (claude/backup-index.ts).
// Textes : js/i18n/backup-<langue>.js.
// - Liste : les sauvegardes gardées (8 réussies au plus) et les erreurs récentes ; pour chacune : date, type (planifiée /
//   manuelle), état, taille, comptes, cartes, durée ; message d'une erreur. Taille totale de ce qui est gardé.
// - « Sauvegarder maintenant » : appelle la fonction backup (jeton de l'admin) et ATTEND le résultat. 1 fois par heure au
//   plus (erreur bk_rate côté serveur, bouton aussi grisé avec les minutes restantes) ; une sauvegarde déjà en cours : bk_busy.
// - « Télécharger » : lien signé de 60 secondes demandé au Storage (règle « backups: lire (admin) »), fichier .json.gz
//   récupéré puis enregistré. Chaque téléchargement et chaque extraction sont notés au journal (admin_backup).
// - « Extraire un compte » : petit outil pour restaurer UN compte sans ouvrir le fichier à la main : le fichier est lu dans
//   l'appli (décompression gzip du navigateur), l'admin choisit le compte, l'appli écrit le même fichier .json que
//   Administration → compte → Actions → Exporter ; il se réimporte avec Actions → Importer (voir guide-restauration.md).
// - Script pas lancé : « Lancez le script SQL de l'étape 50 » ; fonction pas déployée : « Déployez la fonction backup ».
const BK_FN = "backup";
const bk = { started: false, loading: false, err: "", missing: false, data: null, fn: "unknown", fnVersion: "", busy: false, msg: "", msgBad: false };

function bkRerender() { if (currentScreen === "adminbk") renderAdminBackups(); }
function bkErrText(e) { return alIsMissing(e) ? t("bk.missing") : aqErrText(e); }
// Taille lisible : 480 Ko, 1,2 Mo.
function bkSize(n) {
  n = Number(n);
  if (!isFinite(n) || n < 0) return "—";
  const f = (v, d) => v.toLocaleString(state.settings.uiLang, { maximumFractionDigits: d });
  if (n >= 1048576) return f(n / 1048576, 1) + " " + t("bk.mb");
  return f(Math.max(1, Math.round(n / 1024)), 0) + " " + t("bk.kb");
}
function bkWhen(s) {
  try {
    const d = new Date(s);
    return isNaN(d) ? "—" : d.toLocaleDateString(state.settings.uiLang, { year: "numeric", month: "short", day: "numeric" }) + " " +
      d.toLocaleTimeString(state.settings.uiLang, { hour: "2-digit", minute: "2-digit" });
  } catch (e) { return "—"; }
}
function bkDuration(ms) { ms = Number(ms); return isFinite(ms) && ms > 0 ? (ms < 1000 ? "<1 s" : Math.round(ms / 100) / 10 + " s") : "—"; }

async function bkLoad() {
  bk.started = true; bk.loading = true; bk.err = "";
  bkRerender();
  try {
    bk.data = await aqRpc("admin_backups_list");
    bk.missing = false;
  } catch (e) { bk.data = null; bk.missing = alIsMissing(e); bk.err = bk.missing ? "" : bkErrText(e); }
  bk.loading = false;
  bkRerender();
  if (!bk.missing && bk.fn === "unknown") bkCheckFn();
}
// La fonction « backup » est-elle déployée ? (GET sans effet : renvoie sa version)
async function bkCheckFn() {
  bk.fn = "checking";
  try {
    const r = await withTimeout(Supa.client().functions.invoke(BK_FN, { method: "GET" }), 15000);
    if (r && r.error) {
      const ctx = r.error.context, st = ctx && typeof ctx.status === "number" ? ctx.status : 0;
      bk.fn = st === 404 || !st ? "missing" : "ok";
    } else { bk.fn = "ok"; bk.fnVersion = r && r.data && r.data.version ? String(r.data.version) : ""; }
  } catch (e) { bk.fn = sbErrKind(e) === "net" ? "unknown" : "missing"; }
  bkRerender();
}

// --- Écran ---
function renderAdminBackups() {
  const root = $("#screen-adminbk");
  if (!root) return;
  root.textContent = "";
  const back = el("button", "link-btn", t("aq.back"));
  back.addEventListener("click", () => { location.hash = "#" + HASH_OF.admin; });
  root.appendChild(back);
  const top = el("div", "adm-top");
  top.appendChild(el("h2", null, t("bk.title")));
  const ref = el("button", "link-btn", t("admin.refresh"));
  ref.addEventListener("click", bkLoad);
  top.appendChild(ref);
  root.appendChild(top);
  if (!bk.started) { bkLoad(); return; }
  if (bk.missing) { root.appendChild(el("div", "card q-err", t("bk.missing"))); return; }
  root.appendChild(el("p", "q-note", t("bk.help")));
  root.appendChild(el("p", "q-note bk-private", "🔒 " + t("bk.private")));
  if (bk.loading && !bk.data) { root.appendChild(el("div", "empty", t("admin.loading"))); return; }
  if (bk.err) { root.appendChild(el("div", "card q-err", bk.err)); return; }
  if (!bk.data) return;
  if (bk.fn === "missing") root.appendChild(el("div", "card q-err", t("bk.fnMissing")));
  const d = bk.data, rows = arr(d.rows);

  // Résumé + « Sauvegarder maintenant »
  const c = el("div", "card bk-sum");
  const kv = (k, v) => { const r = el("div", "rl-kv"); r.append(el("span", null, k), el("b", null, v)); c.appendChild(r); };
  const lastOk = rows.find(r => r.status === "ok");
  kv(t("bk.kept"), t("bk.keptVal", { n: num(Number(d.kept), 0) }));
  kv(t("bk.total"), bkSize(d.total_bytes));
  kv(t("bk.last"), lastOk ? bkWhen(lastOk.created_at) : t("bk.never"));
  const wait = num(Number(d.wait_minutes), 0);
  const running = !!d.running || bk.busy;
  const go = el("button", "btn primary bk-go", bk.busy ? t("bk.running") : t("bk.now"));
  go.type = "button"; go.id = "bkNow";
  go.disabled = running || wait > 0 || bk.fn === "missing";
  go.addEventListener("click", bkRun);
  c.appendChild(go);
  if (bk.busy) c.appendChild(el("p", "muted bk-note", t("bk.runningHint")));
  else if (d.running) c.appendChild(el("p", "muted bk-note", t("bk.alreadyRunning")));
  else if (wait > 0) c.appendChild(el("p", "muted bk-note", t("bk.wait", { n: wait })));
  if (bk.msg) { const m = el("p", "bk-msg" + (bk.msgBad ? " q-err" : ""), bk.msg); m.setAttribute("role", "status"); c.appendChild(m); }
  root.appendChild(c);

  // Liste
  if (!rows.length) { root.appendChild(el("div", "empty", t("bk.none"))); return; }
  const list = el("div", "bk-list");
  rows.forEach(r => list.appendChild(bkRow(r)));
  root.appendChild(list);
}

function bkRow(r) {
  const box = el("div", "card bk-row bk-" + r.status);
  const head = el("div", "al-head");
  const tags = el("span", "ce-tags");
  tags.append(el("span", "al-tag" + (r.status === "error" ? " bad" : ""), t("bk.st." + r.status)), el("span", "al-tag", t("bk.kind." + r.kind)));
  head.append(tags, el("span", "al-time", bkWhen(r.created_at)));
  box.appendChild(head);
  if (r.status === "ok") {
    box.appendChild(el("div", "al-dev", [bkSize(r.size_bytes), t("bk.accounts", { n: num(Number(r.accounts), 0) }), t("bk.cards", { n: num(Number(r.cards), 0) }),
      t("bk.tables", { n: num(Number(r.tables_count), 0) }), bkDuration(r.duration_ms)].join(" · ")));
    if (r.file_name) box.appendChild(el("div", "bk-file", r.file_name + (r.app_version ? " · v" + r.app_version : "")));
    const acts = el("div", "btns two bk-acts");
    const dl = el("button", "btn", t("bk.download")), ex = el("button", "btn", t("bk.extract"));
    dl.type = "button"; ex.type = "button";
    dl.addEventListener("click", () => bkDownload(r));
    ex.addEventListener("click", () => bkExtract(r));
    acts.append(dl, ex);
    box.appendChild(acts);
  } else if (r.status === "error") {
    box.appendChild(el("div", "bk-err", String(r.message || "")));
  } else {
    box.appendChild(el("div", "muted", t("bk.alreadyRunning")));
  }
  return box;
}

// --- Sauvegarder maintenant ---
async function bkRun() {
  if (bk.busy) return;
  bk.busy = true; bk.msg = ""; bk.msgBad = false;
  bkRerender();
  const done = (msg, bad) => { bk.busy = false; bk.msg = msg; bk.msgBad = !!bad; bkLoad(); };
  try {
    const r = await withTimeout(Supa.client().functions.invoke(BK_FN, { body: { action: "run" } }), 170000);
    if (r && r.error) {
      const e = r.error, ctx = e && e.context;
      let status = 0, info = null;
      if (ctx && typeof ctx.status === "number") { status = ctx.status; try { info = await ctx.json(); } catch (x) {} }
      if (status === 404 || (!status && /fetch|relay|failed to send/i.test(String(e.message || e.name || "")))) { bk.fn = "missing"; return done(t("bk.fnMissing"), true); }
      if (status === 429) return done(t("bk.wait", { n: num(Number(info && info.wait_minutes), 60) }), true);
      if (status === 409) return done(t("bk.alreadyRunning"), true);
      if (status === 403) return done(t("aq.err.denied"), true);
      if (info && info.error === "sql_missing") return done(t("bk.missing"), true);
      return done(t("bk.failed") + (info && info.message ? " (" + String(info.message).slice(0, 160) + ")" : ""), true);
    }
    const b = (r && r.data && r.data.backup) || {};
    Activity.log("admin_backup", { action: "run", size: num(Number(b.size_bytes), 0), accounts: num(Number(b.accounts), 0), cards: num(Number(b.cards), 0) });
    toast(t("bk.done", { s: bkSize(b.size_bytes), a: num(Number(b.accounts), 0), c: num(Number(b.cards), 0) }));
    done(t("bk.done", { s: bkSize(b.size_bytes), a: num(Number(b.accounts), 0), c: num(Number(b.cards), 0) }), false);
  } catch (e) {
    done(sbErrKind(e) === "net" ? t("queue.err.net") : t("bk.failedWait"), true);
  }
}

// --- Télécharger ---
// Récupère le fichier par un lien signé de 60 secondes. Renvoie les octets (ArrayBuffer).
async function bkFetch(name) {
  const cl = Supa.client();
  if (!cl) throw new Error("no client");
  const s = await withTimeout(cl.storage.from("backups").createSignedUrl(name, 60), 20000);
  if (s && s.error) throw s.error;
  const url = s && s.data && (s.data.signedUrl || s.data.signedURL);
  if (!url) throw new Error("no link");
  const res = await withTimeout(fetch(url, { cache: "no-store" }), 120000);
  if (!res.ok) throw new Error("http " + res.status);
  return await res.arrayBuffer();
}
async function bkDownload(r) {
  const pg = openProgress(t("bk.download"), t("bk.fetching"), []);
  let buf;
  try { buf = await bkFetch(r.file_name); }
  catch (e) { pg.close(); toast(t("bk.dlFail")); return; }
  pg.close();
  const ok = await fxSave(r.file_name, new Blob([buf], { type: "application/gzip" }));
  Activity.log("admin_backup", { action: "download", file: r.file_name });
  if (ok === true) toast(t("bk.dlDone"));
  else if (ok !== "declined") toast(t("bk.dlNoSave"));
}

// --- Extraire un compte ---
async function bkGunzipJson(buf) {
  if (typeof DecompressionStream !== "function") throw new Error("no gzip");
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  w.write(new Uint8Array(buf)); w.close();
  return JSON.parse(await new Response(ds.readable).text());
}
async function bkExtract(r) {
  const pg = openProgress(t("bk.extract"), t("bk.fetching"), []);
  let file;
  try { file = await bkGunzipJson(await bkFetch(r.file_name)); }
  catch (e) { pg.close(); toast(t(typeof DecompressionStream !== "function" ? "bk.noGzip" : "bk.dlFail")); return; }
  pg.close();
  const tb = (file && file.tables) || {};
  const profiles = arr(tb.profiles), rows = arr(tb.user_data);
  if (!profiles.length) { toast(t("bk.noAccounts")); return; }
  const count = uid => rows.filter(x => x.user_id === uid).length;
  const accts = profiles.slice().sort((a, b) => String(a.identifiant).localeCompare(String(b.identifiant)));
  const wrap = el("div", "bk-extract");
  wrap.appendChild(el("p", null, t("bk.extractHelp", { d: bkWhen(r.created_at) })));
  const sel = el("select", "input"); sel.id = "bkAcct";
  accts.forEach(a => { const o = el("option", null, String(a.identifiant) + " (" + t("bk.pieces", { n: count(a.user_id) }) + ")"); o.value = a.user_id; sel.appendChild(o); });
  wrap.appendChild(formField(t("aq.f.account"), sel));
  wrap.appendChild(el("p", "muted", t("bk.extractNext")));
  openModal(t("bk.extract"), wrap, [
    { label: t("cancel") },
    { label: t("bk.extractGo"), kind: "primary", onClick: () => {
      const a = accts.find(x => x.user_id === sel.value);
      if (!a) return false;
      setTimeout(() => bkExtractOne(file, a, r), 0);
    } }
  ]);
}
async function bkExtractOne(file, a, r) {
  const mine = arr(file.tables.user_data).filter(x => x.user_id === a.user_id).map(x => ({ key: x.key, data: x.data }));
  let raw = null;
  try { raw = Storage.unpackRows(mine); } catch (e) { raw = null; }
  if (!raw) { toast(t("bk.noData", { id: a.identifiant })); return; }
  const data = normalizeData(raw);
  Activity.log("admin_backup", { action: "extract", target: a.identifiant, file: r.file_name });
  await exportData(data, "vocabulaire-" + a.identifiant + "-sauvegarde-" + String(r.file_name || "").slice(6, 16) + ".json");
}
