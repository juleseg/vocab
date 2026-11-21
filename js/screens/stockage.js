"use strict";

// === RÉGLAGES → DONNÉES ET STOCKAGE → STOCKAGE HORS LIGNE (ÉTAPE 79) ===
// Carte #stockCard (index.html) : ce que cet appareil garde pour réviser sans Internet. Tout passe par Offline
// (js/hors-ligne.js) ; rien n'est écrit dans le compte (les choix restent sur l'appareil).
//  - espace utilisé (total et par type : texte des cartes, images, dictionnaire) et espace disponible ;
//  - par type : images des cartes, dictionnaire commun ; sons = voix du téléphone (rien à télécharger, état par langue) ;
//  - listes à garder hors ligne, liste par liste (mes listes, listes communes / partagées) ;
//  - « Télécharger » (barre de progression, pause, reprise ; Wi-Fi conseillé avant un gros téléchargement) ;
//  - « Libérer de la place » (retire ce qui est téléchargé, jamais les cartes).
// renderStockCard() est appelé par renderSettings (js/screens/reglages.js). La carte se dessine tout de suite avec ce qui
// est connu, puis les comptes (images présentes, espace) arrivent (hlRefresh).
const hl = { st: null, use: null, at: 0, who: null, busy: false, again: false, tm: null, prep: false };

function hlBytes(b) {
  b = num(Number(b), 0);
  if (b <= 0) return t("img.kb", { n: "0" });
  if (b >= 1073741824) {
    let s;
    try { s = (b / 1073741824).toLocaleString(state.settings.uiLang, { maximumFractionDigits: 1 }); } catch (e) { s = String(Math.round(b / 107374182.4) / 10); }
    return t("hl.gb", { n: s });
  }
  return imgSize(b);
}
function hlCan() { return !!Storage.getUser() && Storage.syncInfo().remote && Offline.imgOk(); }

function renderStockCard() {
  if (!$("#stockCard")) return;
  hlDraw();
  hlRefresh(false);
}
async function hlRefresh(force) {
  if (hl.busy) { hl.again = hl.again || !!force; return; }
  if (!force && Date.now() - hl.at < 1500) return;
  const who = Storage.getUser();
  if (!who) return;
  hl.busy = true;
  try {
    const st = await Offline.status(), use = await Offline.usage(!!force);
    if (Storage.getUser() !== who) return;
    hl.st = st; hl.use = use; hl.at = Date.now(); hl.who = who;
    hlDraw();
  } catch (e) {}
  finally { hl.busy = false; if (hl.again) { hl.again = false; hlRefresh(true); } }
}
// Offline a changé (choix, avancement, fin d'un téléchargement) : la carte suit, sans tout recalculer à chaque image.
function hlOnChange() {
  if (typeof currentScreen === "undefined" || currentScreen !== "settings") { hl.at = 0; return; }
  hlDraw();
  hlSum();
  clearTimeout(hl.tm);
  const run = !!Offline.job();
  hl.tm = setTimeout(() => hlRefresh(!run), run ? 2000 : 150);
}
// Résumé de la section « Données et stockage » (en-tête replié) : suit les choix sans redessiner tous les Réglages.
function hlSum() {
  const se = document.querySelector("#sec-data .acc-s");
  if (!se) return;
  const n = Offline.keptCount();
  const s = n ? t("hl.sum", { n }) : (typeof SyncUi !== "undefined" ? SyncUi.label() : "");
  se.textContent = s; se.hidden = !s;
}
Offline.on(hlOnChange);

function hlCheck(id, label, checked, onChange, sub, extra) {
  const lab = el("label", "check-row hl-row");
  const cb = document.createElement("input");
  cb.type = "checkbox"; cb.id = id; cb.checked = !!checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  const tx = el("span", "hl-row-tx");
  tx.appendChild(el("span", "hl-row-t", label));
  if (sub) tx.appendChild(el("span", "hl-row-s", sub));
  lab.append(cb, tx);
  if (extra) lab.appendChild(extra);
  return lab;
}
// Après un choix : un petit complément part tout seul ; un gros attend le bouton « Télécharger » (Wi-Fi conseillé).
async function hlAfterChoice() {
  if (Offline.job() || navigator.onLine === false || !hlCan()) return;
  try {
    await Offline.prepare();
    const st = await Offline.status();
    if (Offline.job()) return;
    if (st.todo.img > 0 && st.todo.img <= HL_AUTO_MAX && !st.todo.dict && !Offline.heavy(st.todo.bytes, false)) Offline.run({ auto: true });
    else hlRefresh(true);
  } catch (e) {}
}
async function hlGo() {
  if (Offline.job() || hl.prep) return;
  hl.prep = true; hlDraw();
  let st = null;
  try { await Offline.prepare(); st = await Offline.status(); } catch (e) {}
  hl.prep = false;
  if (!st || (!st.todo.img && !st.todo.dict)) { hlRefresh(true); toast(t("hl.dl.ok")); return; }
  if (!Offline.heavy(st.todo.bytes, st.todo.dict)) { Offline.run(); return; }
  hlDraw();
  const body = el("div");
  body.appendChild(el("p", null, t(st.todo.img ? "hl.wifi.text" : "hl.wifi.textDict", { size: hlBytes(st.todo.bytes), n: st.todo.img })));
  if (st.todo.img && st.todo.dict) body.appendChild(el("p", null, t("hl.wifi.dict")));
  const n = Offline.net();
  body.appendChild(el("p", "muted", t(n.cell === true || n.save ? "hl.wifi.cell" : "hl.wifi.advice")));
  openModal(t("hl.wifi.title"), body, [
    { label: t("hl.wifi.later") },
    { label: t("hl.dl"), kind: "primary", onClick: () => { Offline.run(); } }
  ]);
}
function hlFreeAsk() {
  const u = hl.use || { img: { bytes: 0, n: 0 }, dict: { bytes: 0, n: 0 } };
  const body = el("div");
  body.appendChild(el("p", null, t("hl.free.text", { img: hlBytes(u.img.bytes), dict: hlBytes(u.dict.bytes) })));
  body.appendChild(el("p", "hl-safe", t("hl.free.safe")));
  body.appendChild(el("p", "muted", t("hl.free.lists")));
  openModal(t("hl.free.title"), body, [
    { label: t("cancel") },
    { label: t("hl.free.go"), kind: "danger", onClick: () => {
      Offline.freeUp().then(n => { toast(t("hl.free.done", { size: hlBytes(n) })); hlRefresh(true); }).catch(() => {});
    } }
  ]);
}

function hlDraw() {
  const box = $("#stockCard");
  if (!box) return;
  const who = Storage.getUser();
  if (hl.who !== who) { hl.st = null; hl.use = null; hl.who = who; hl.at = 0; }
  box.textContent = "";
  box.appendChild(el("h2", null, t("hl.title")));
  box.appendChild(el("p", "hint hl-intro", t("hl.intro")));
  const p = Offline.prefs(), st = hl.st, u = hl.use, can = hlCan(), job = Offline.job();

  // --- Espace utilisé (total, par type) et disponible ---
  const use = el("div", "hl-use");
  use.id = "hlUse";
  if (!u) use.appendChild(el("p", "muted", t("hl.calc")));
  else {
    const sum = u.texts + u.img.bytes + u.dict.bytes, total = u.total != null ? Math.max(u.total, sum) : sum;
    const top = el("div", "hl-use-top");
    top.appendChild(el("span", "hl-use-n", t("hl.used", { n: hlBytes(total) })));
    if (u.quota != null) top.appendChild(el("span", "hl-use-free", t("hl.avail", { n: hlBytes(Math.max(0, u.quota - total)) })));
    use.appendChild(top);
    if (u.quota != null) {
      const bar = el("div", "progress hl-bar"), fill = el("div", "progress-fill");
      fill.style.width = Math.min(100, Math.max(total > 0 ? 1 : 0, Math.round(total / u.quota * 100))) + "%";
      bar.appendChild(fill);
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", t("hl.used", { n: hlBytes(total) }));
      use.appendChild(bar);
    }
    const ul = el("ul", "hl-use-list");
    const line = (k, v, id) => { const li = el("li"); if (id) li.id = id; li.append(el("span", null, k), el("b", null, v)); ul.appendChild(li); };
    line(t("hl.u.texts"), hlBytes(u.texts), "hlUseTexts");
    line(t("hl.u.img", { n: u.img.n }), hlBytes(u.img.bytes), "hlUseImg");
    line(t("hl.u.dict", { n: u.dict.n }), hlBytes(u.dict.bytes), "hlUseDict");
    if (total > sum + 1024) line(t("hl.u.app"), hlBytes(total - sum), "hlUseApp");
    line(t("hl.u.snd"), t("hl.u.snd0"));
    use.appendChild(ul);
  }
  box.appendChild(use);

  if (!can) {   // sans compte en ligne (ou images indisponibles) : tout est déjà sur l'appareil, rien à choisir
    box.appendChild(el("p", "muted hl-note", t(Storage.syncInfo().remote ? "hl.noimg" : "hl.local")));
    return;
  }
  if (!Offline.cacheOk()) box.appendChild(el("p", "hl-warn", t("hl.unsup")));

  // --- Par type ---
  box.appendChild(el("h3", "hl-h", t("hl.types")));
  box.appendChild(hlCheck("hlImg", t("hl.t.img"), p.img, v => { Offline.setImg(v); if (v) hlAfterChoice(); }, t("hl.t.imgHint")));
  const dm = Offline.dictMeta();
  let dsub = t("hl.t.dictHint");
  if (dm && dm.n) {
    let d = "";
    try { d = dm.at ? new Date(dm.at).toLocaleDateString(state.settings.uiLang) : ""; } catch (e) {}
    dsub = t(!dm.done ? "hl.dict.part" : dm.upd ? "hl.dict.upd" : "hl.dict.have", { n: dm.n, size: hlBytes(dm.bytes), d });
  }
  let dref = null;
  if (dm && dm.done && Offline.dictOk()) {
    dref = el("button", "link-btn hl-dref", t("hl.dict.refresh"));
    dref.type = "button"; dref.id = "hlDictGo";
    dref.setAttribute("data-net", "1");
    dref.addEventListener("click", e => { e.preventDefault(); Offline.setDict(true); Offline.dictStale(); hlGo(); });
  }
  if (Offline.dictOk()) box.appendChild(hlCheck("hlDict", t("hl.t.dict"), p.dict, v => { Offline.setDict(v); if (v) hlRefresh(true); }, dsub, dref));
  // Sons : voix du téléphone, par langue du profil
  const snd = el("div", "hl-snd");
  snd.id = "hlSnd";
  snd.appendChild(el("div", "hl-row-t", t("hl.t.snd")));
  snd.appendChild(el("div", "hl-row-s", t("hl.snd.hint")));
  const chips = el("div", "hl-chips");
  Offline.voices().forEach(v => {
    const c = el("span", "hl-chip" + (v.has ? (v.local ? " ok" : " net") : " no"), t(v.has ? (v.local ? "hl.snd.ok" : "hl.snd.net") : "hl.snd.no", { lang: langName(v.lang) }));
    chips.appendChild(c);
  });
  snd.appendChild(chips);
  snd.appendChild(el("div", "hl-row-s", t("hl.snd.mic")));
  box.appendChild(snd);

  // --- Listes à garder hors ligne ---
  box.appendChild(el("h3", "hl-h", t("hl.lists")));
  box.appendChild(el("p", "hint", t("hl.lists.hint")));
  const rows = st ? st.rows : state.lists.map(l => ({ id: l.id, name: listLabel(l) || l.name, shared: isSharedList(l), owner: "", cards: -1, imgs: 0, have: 0 }));
  if (!rows.length) box.appendChild(el("p", "muted", t("hl.lists.none")));
  else {
    const all = el("div", "hl-all");
    [["hlAll", "hl.all", true], ["hlNone", "hl.none", false]].forEach(x => {
      const b = el("button", "link-btn", t(x[1]));
      b.type = "button"; b.id = x[0];
      b.addEventListener("click", () => { Offline.setLists(rows.map(r => r.id), x[2]); if (x[2]) hlAfterChoice(); });
      all.appendChild(b);
    });
    box.appendChild(all);
    const group = (title, list, gid) => {
      if (!list.length) return;
      const g = el("div", "hl-group");
      g.id = gid;
      g.appendChild(el("div", "hl-group-t", title));
      list.forEach(r => {
        const kept = !!p.lists[r.id];
        const bits = [];
        if (r.cards >= 0) bits.push(t("hl.row.cards", { n: r.cards }));
        if (r.imgs) bits.push(kept && p.img ? t("hl.row.img", { h: r.have, t: r.imgs }) : t("hl.row.imgs", { n: r.imgs }));
        if (r.owner) bits.push(t("hl.owner", { name: r.owner }));
        let badge = null;
        if (kept && st) {
          const ready = !p.img || !r.imgs || r.have >= r.imgs;
          badge = el("span", "hl-badge" + (ready ? " ok" : ""), t(ready ? "hl.row.ready" : "hl.row.todo", { n: r.imgs - r.have }));
        }
        const row = hlCheck("hlL-" + r.id, r.name, kept, v => { Offline.setLists([r.id], v); if (v) hlAfterChoice(); }, bits.join(" · "), badge);
        row.dataset.list = r.id;
        g.appendChild(row);
      });
      box.appendChild(g);
    };
    group(t("hl.mine"), rows.filter(r => !r.shared), "hlMine");
    group(t("hl.shared"), rows.filter(r => r.shared), "hlShared");
  }

  // --- Téléchargement ---
  const act = el("div", "hl-act");
  act.id = "hlAct";
  const todo = st ? st.todo : { img: 0, bytes: 0, dict: false };
  if (job) {
    const pr = el("div", "hl-prog");
    const bar = el("div", "progress"), fill = el("div", "progress-fill");
    const frac = job.total ? job.done / job.total : 0;
    fill.style.width = Math.round(frac * 100) + "%";
    bar.appendChild(fill);
    bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(Math.round(frac * 100)));
    const txt = el("p", "muted progress-text", job.phase === "img" ? t("hl.run", { done: job.done + job.fail, total: job.total })
      : job.phase === "dict" ? (job.total ? t("hl.run.dict", { done: job.done, total: job.total }) : t("hl.run.dict0")) : t("hl.run.prep"));
    txt.id = "hlProgText";
    pr.append(bar, txt);
    act.appendChild(pr);
    const pb = el("button", "btn", t("hl.pause"));
    pb.type = "button"; pb.id = "hlPause";
    pb.addEventListener("click", () => Offline.pause());
    act.appendChild(pb);
  } else {
    const need = todo.img > 0 || todo.dict;
    if (p.job === 1 && need) act.appendChild(el("p", "hl-warn", t(navigator.onLine === false ? "hl.cut.off" : "hl.cut")));
    if (p.job === 2 && need) act.appendChild(el("p", "muted hl-note", t("hl.paused")));
    const err = Offline.lastError();
    if (err && need) { const e = el("p", "syn-err", t("hl.err", { msg: err })); e.id = "hlErr"; act.appendChild(e); }
    if (p.miss > 0) act.appendChild(el("p", "muted hl-note", t("hl.miss", { n: p.miss })));
    const any = Object.keys(p.lists).length > 0 || p.dict;
    if (need || hl.prep || !st) {
      const parts = [];
      if (todo.img) parts.push(t("hl.dl.img", { n: todo.img, size: hlBytes(todo.bytes) }));
      if (todo.dict) parts.push(t("hl.dl.dict"));
      const b = el("button", "btn primary", hl.prep || !st ? t("hl.run.prep") : t(p.job === 1 || p.job === 2 ? "hl.resume" : "hl.dl") + (parts.length ? " (" + parts.join(" + ") + ")" : ""));
      b.type = "button"; b.id = "hlGo";
      b.setAttribute("data-net", "1");
      b.disabled = hl.prep || !st;
      b.addEventListener("click", hlGo);
      act.appendChild(b);
      if (need && navigator.onLine === false) act.appendChild(el("p", "muted hl-note", t("hl.offline")));
    } else {
      const ok = el("p", "hl-ok", t(any ? "hl.dl.ok" : "hl.dl.none"));
      ok.id = "hlOk";
      act.appendChild(ok);
    }
  }
  const fr = el("button", "btn", t("hl.free"));
  fr.type = "button"; fr.id = "hlFree";
  fr.disabled = !u || (u.img.bytes + u.dict.bytes) <= 0;
  fr.addEventListener("click", hlFreeAsk);
  act.appendChild(fr);
  act.appendChild(el("p", "hint", t("hl.free.hint")));
  box.appendChild(act);
}
