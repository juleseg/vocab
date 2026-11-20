"use strict";

// === ADMINISTRATION : IMAGES DU DICTIONNAIRE COMMUN (ÉTAPE 49) ===
// Onglet « Images » de l'écran Dictionnaire (#admin-dictionnaire, js/screens/admin-dictionnaire.js).
// Images Wikimedia proposées par les comptes pour un sens (table dict_images, script supabase-etape49.sql) :
// en attente / validées / refusées, 50 par page. Valider : l'appli de l'admin recopie l'image dans common/<sens>/ (Storage),
// puis admin_dict_image_decide (l'ancienne image du sens passe à « remplacée », son fichier est supprimé) ; refuser :
// admin_dict_image_decide(…, false). Journal : admin_dict (image_accept / image_reject), écrit par la fonction SQL.
// Fichier proposé disparu (carte supprimée entre-temps) : message, la proposition est refusée.
const aim = { status: "pending", page: 0, data: null, err: "", missing: false, loading: false, started: false, busy: false };
function aimRerender() { if (typeof adRerender === "function") adRerender(); }
async function aimLoad() {
  aim.started = true; aim.loading = true; aim.err = "";
  aimRerender();
  try {
    const r = await aqRpc("admin_dict_images", { p_status: aim.status, p_limit: AD_PAGE, p_offset: aim.page * AD_PAGE });
    aim.data = { total: num(Number(r && r.total), 0), pending: num(Number(r && r.pending), 0), rows: arr(r && r.rows) };
    aim.missing = false;
  } catch (e) { aim.missing = alIsMissing(e); aim.err = aim.missing ? t("img.adm.missing") : aqErrText(e); }
  aim.loading = false;
  aimRerender();
}
function aimSection(root) {
  if (!aim.started) { aimLoad(); }
  if (aim.missing) { root.appendChild(el("div", "card q-err", t("img.adm.missing"))); return; }
  if (aim.err) root.appendChild(el("p", "q-err", aim.err));
  const st = el("div", "seg ad-tabs");
  ["pending", "accepted", "rejected"].forEach(k => {
    const b = el("button", null, t("dict.st." + k)); b.type = "button"; b.setAttribute("aria-pressed", String(aim.status === k));
    b.addEventListener("click", () => { if (aim.status === k) return; aim.status = k; aim.page = 0; aimLoad(); });
    st.appendChild(b);
  });
  root.appendChild(st);
  if (aim.data && aim.status === "pending") root.appendChild(el("p", "muted", t("img.adm.sum", { n: aim.data.pending })));
  if (aim.loading && !aim.data) { root.appendChild(el("p", "muted", t("queue.loading"))); return; }
  const data = aim.data || { total: 0, rows: [] };
  if (!data.rows.length) { root.appendChild(el("p", "muted", t("img.adm.none"))); return; }
  const list = el("div", "ad-list ci-adm");
  data.rows.forEach(r => list.appendChild(aimRow(r)));
  root.appendChild(list);
  root.appendChild(adPager(aim.page, data.total, p => { aim.page = p; aimLoad(); }));
}
function aimWords(w) {
  const v = w || {};
  const order = [state.settings.uiLang].concat(Object.keys(v).sort()).filter((L, i, a) => a.indexOf(L) === i && v[L]);
  return order.map(L => L.toUpperCase() + " " + v[L]).join(" · ") || "—";
}
function aimRow(r) {
  const row = el("div", "card ci-arow");
  const pics = el("div", "ci-apics");
  const path = r.status === "accepted" && r.common_path ? r.common_path : r.path;
  const im = { path, src: "wikimedia", author: r.author, license: r.license, page: r.page };
  const p1 = el("div", "ci-apic");
  p1.appendChild(Images.node(im, { cls: "ci-athumb" }));
  p1.appendChild(el("div", "hint", t(r.status === "pending" ? "img.adm.proposed" : "dict.st." + r.status)));
  pics.appendChild(p1);
  if (r.status === "pending" && r.current) {
    const p2 = el("div", "ci-apic");
    p2.appendChild(Images.node({ path: r.current, src: "wikimedia" }, { cls: "ci-athumb" }));
    p2.appendChild(el("div", "hint", t("img.adm.current")));
    pics.appendChild(p2);
  }
  row.appendChild(pics);
  const m = el("div", "ci-ameta");
  const w = el("button", "link-btn ad-words", aimWords(r.words)); w.type = "button";
  w.addEventListener("click", () => { if (typeof adOpenSense === "function") adOpenSense(r.sense_id); });
  m.appendChild(w);
  m.appendChild(el("div", "muted", imgCredit(im)));
  if (r.page) { const a = el("a", "ci-zlink", t("img.page")); a.href = r.page; a.target = "_blank"; a.rel = "noopener noreferrer"; m.appendChild(a); }
  m.appendChild(el("div", "muted ad-meta", adDate(r.created_at) + " · " + imgSize(r.size) +
    (r.status !== "pending" && r.decided_at ? " · " + t("dict.st." + r.status) + " " + adDate(r.decided_at) : "")));
  row.appendChild(m);
  if (r.status === "pending") {
    const btns = el("div", "btns two");
    const no = modGate(el("button", "btn", t("dict.reject")), "dict.decide"), ok = modGate(el("button", "btn primary", t("dict.accept")), "dict.decide");   // étape 66
    no.type = ok.type = "button";
    no.addEventListener("click", () => aimDecide(r, false));
    ok.addEventListener("click", () => aimDecide(r, true));
    btns.append(no, ok);
    row.appendChild(btns);
  }
  return row;
}
async function aimDecide(r, accept) {
  if (aim.busy) return;
  aim.busy = true;
  try {
    if (!accept) {
      await aqRpc("admin_dict_image_decide", { p_id: r.id, p_accept: false, p_common_path: null });
      toast(t("img.adm.rejected"));
    } else {
      const dst = "common/" + r.sense_id + "/" + imgRandName() + (String(r.path).endsWith(".jpg") ? ".jpg" : ".webp");
      let cp = null;
      try { cp = await withTimeout(Images.bucket().copy(r.path, dst), 20000); } catch (e) { cp = { error: e }; }
      if (cp && cp.error) {
        if (/not.?found|does not exist/i.test(String(cp.error.message || cp.error.error || cp.error))) {
          await aqRpc("admin_dict_image_decide", { p_id: r.id, p_accept: false, p_common_path: null });
          toast(t("img.adm.gone"));
        } else toast(t("img.err.send"));
      } else {
        const res = await aqRpc("admin_dict_image_decide", { p_id: r.id, p_accept: true, p_common_path: dst });
        if (res && res.old_path) await Images.remove([res.old_path]);   // ancienne image du sens
        toast(t("img.adm.done"));
      }
    }
  } catch (e) {
    toast(String((e && e.hint) || "") === "img_done" ? t("img.err.done") : adErr(e));
  }
  aim.busy = false;
  aimLoad();
}
