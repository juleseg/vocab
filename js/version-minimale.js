"use strict";

// === VERSION MINIMALE ACCEPTÉE PAR LE SERVEUR (ÉTAPE 88) ===
// Serveur : claude/supabase-etape88.sql. L'admin règle une « version minimale acceptée » (Administration → Notifications →
// Versions, js/screens/admin-versionmin.js ; 0 = désactivé). Un appareil plus ancien, ou qui ne dit pas sa version, est
// refusé par le serveur pour toutes les données (tables et fonctions) : HTTP 426, code PT426, message
// « app_version_too_old », details = version minimale, hint « app_version ». Le compte admin n'est jamais refusé.
// 1. L'appli dit sa version : en-tête x-app-version (= APP_VERSION) sur chaque requête de données (/rest/v1/ seulement :
//    jamais la connexion /auth/v1/, le stockage ni les fonctions Edge, qui n'acceptent pas cet en-tête). Branché par
//    Supa.init (js/storage-supabase.js), de la requête vers l'appli : Release.gateFetch → VerMin.wrapFetch (en-tête, refus
//    reconnu) → journal des erreurs → VerMin.guardFetch (plus rien ne part) → ConnLocal.guardFetch. Le journal des erreurs
//    ne voit donc jamais un refus de version (ce n'est pas une erreur de l'appli).
// 2. Le serveur refuse (cache ancien, appli pas rechargée) : écran « Mise à jour nécessaire » (#vmBlock) avec un bouton de
//    rechargement (Release.update : page relue sans le cache, puis rechargement). JAMAIS de déconnexion automatique,
//    JAMAIS de suppression des données de l'appareil. Le refus n'est gardé qu'en mémoire (rien sur l'appareil).
//    Tant que c'est refusé, les requêtes de données échouent tout de suite « comme une coupure réseau » (aucune requête
//    ne part) : tout ce qui est fait reste en attente sur l'appareil et part après la mise à jour. Passent toujours :
//    la connexion et les fonctions VM_OPEN_RPC (les mêmes que côté serveur).
// 3. Hors ligne, rien ne change : aucune requête, donc aucun refus ; l'écran est caché tant que l'appareil est hors ligne.
// 4. Le réglage est relu (app_min_version) toutes les VM_CHECK_MS, au retour au premier plan et au retour d'Internet :
//    version de nouveau acceptée (réglage remis à 0) → l'écran disparaît, la synchro reprend (Storage.retry).
// 5. Sécurité : si le serveur refusait l'en-tête lui-même (pré-contrôle du navigateur), une requête d'essai le prouve,
//    l'en-tête n'est plus envoyé pendant cette session et l'appli marche comme la version 86 (une ligne au journal des
//    erreurs). Dans ce cas l'admin ne peut pas régler de version minimale (le serveur ne voit pas la version : vm_self).
// Sans Supabase (mode local) : rien.
const VM_HEADER = "x-app-version";
const VM_CODE = "PT426";
const VM_OPEN_RPC = ["username_exists", "app_release_latest", "app_settings_get", "app_min_version", "my_profile", "pin_changed", "device_touch"];
const VM_CHECK_MS = 60000;      // écran affiché : relecture du réglage
const VM_STILL_MS = 600000;     // après un rechargement : « toujours la même version » pendant 10 min

const VerMin = (() => {
  const SS_TRY = CONFIG.LS_USER_PREFIX + "vermin:try";
  let blocked = false;          // le serveur refuse cette version (en mémoire seulement)
  let blockedFor = null;        // … pour ce compte : un autre compte (l'admin n'est jamais refusé) repart de zéro
  let min = 0;                  // version minimale annoncée par le refus (0 = inconnue)
  let hdr = "new";              // en-tête : "new" (jamais vu passer) | "ok" | "off" (refusé par le serveur : plus envoyé)
  let inner = null;             // fetch sous VerMin (Release.gateFetch)
  let timer = null, busy = false, probing = null, updating = false, askOut = false, msg = "", bound = false;

  const urlOf = input => typeof input === "string" ? input : String((input && input.url) || input || "");
  const methodOf = (input, init) => String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
  const isRest = url => /\/rest\/v1\//.test(url);
  const rpcOf = url => { const m = /\/rest\/v1\/rpc\/([\w-]+)/.exec(url); return m ? m[1] : ""; };
  const openCall = url => VM_OPEN_RPC.includes(rpcOf(url));
  const online = () => navigator.onLine !== false;
  const relBlocked = () => { try { return typeof Release !== "undefined" && Release.blocked(); } catch (e) { return false; } };
  const cur = () => { try { return Storage.getUser() || null; } catch (e) { return null; } };
  // Refus en cours pour le compte ouvert (jamais sur l'écran de connexion, jamais pour le compte suivant).
  const active = () => blocked && blockedFor !== null && cur() === blockedFor;

  // Échec « comme une coupure réseau » (même forme que ConnLocal : une lecture reçoit une réponse d'erreur que la
  // bibliothèque ne réessaie pas).
  function netFail(url, input, init) {
    const m = methodOf(input, init);
    if (m === "GET" || m === "HEAD") {
      return Promise.resolve(new Response(JSON.stringify({ message: "TypeError: Failed to fetch", code: "", details: "", hint: "" }),
        { status: 599, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.reject(new TypeError("Failed to fetch"));
  }
  function withHeader(init) {
    const h = new Headers((init && init.headers) || {});
    h.set(VM_HEADER, String(APP_VERSION));
    return Object.assign({}, init || {}, { headers: h });
  }
  const isRefusal = (status, j) => status === 426 || !!(j && (j.code === VM_CODE || j.message === "app_version_too_old" || j.hint === "app_version"));

  // Refus du serveur, rendu à l'appli comme une coupure réseau (marque lue par guardFetch).
  function refusedError() { const e = new TypeError("Failed to fetch"); e.vermin = true; return e; }

  // --- fetch du client Supabase, SOUS le journal des erreurs : en-tête de version, refus du serveur reconnu ---
  function wrapFetch(base) {
    inner = typeof base === "function" ? base : (a, b) => window.fetch(a, b);
    return function (input, init) {
      let url = "";
      try { url = urlOf(input); } catch (e) {}
      if (!isRest(url)) return inner(input, init);
      const send = hdr !== "off" && typeof input === "string";
      return inner(input, send ? withHeader(init) : init).then(res => {
        if (send && hdr === "new") hdr = "ok";
        if (!res || res.status < 400 || res.status === 401) return res;
        return res.clone().json().then(j => {
          if (!isRefusal(res.status, j)) return res;
          refused(j);
          throw refusedError();
        }, e => {
          if (e && e.vermin) throw e;
          if (res.status !== 426) return res;
          refused(null);
          throw refusedError();
        });
      }, err => {
        // Échec réseau alors que l'en-tête n'est jamais passé : est-ce l'en-tête que le serveur refuse ?
        if (!send || hdr !== "new" || !online() || relBlocked()) throw err;
        return probe(url).then(off => {
          if (!off) throw err;
          return inner(input, init);        // la requête n'était jamais partie (pré-contrôle refusé) : renvoyée sans l'en-tête
        });
      });
    };
  }
  // --- fetch du client Supabase, AU-DESSUS du journal des erreurs : tant que le serveur refuse, plus rien ne part ---
  function guardFetch(base) {
    const f = typeof base === "function" ? base : (a, b) => window.fetch(a, b);
    return function (input, init) {
      let url = "";
      try { url = urlOf(input); } catch (e) {}
      if (!isRest(url)) return f(input, init);
      if (active() && !openCall(url)) return netFail(url, input, init);
      return f(input, init).catch(err => {
        if (err && err.vermin) return netFail(url, input, init);
        throw err;
      });
    };
  }
  // Deux requêtes d'essai en lecture (app_release_latest) : sans l'en-tête, puis avec. Vrai = seul l'en-tête fait échouer.
  function probe(url) {
    if (probing) return probing;
    probing = (async () => {
      try {
        const base = url.slice(0, url.indexOf("/rest/v1/")) + "/rest/v1/rpc/app_release_latest";
        const h = { apikey: Supa.anonKey(), "Content-Type": "application/json", Accept: "application/json" };
        const call = hh => withTimeout(inner(base, { method: "POST", headers: hh, body: "{}", cache: "no-store" }), 12000).then(r => !!r, () => false);
        if (!(await call(h))) return false;                    // serveur injoignable de toute façon
        const hv = Object.assign({}, h); hv[VM_HEADER] = String(APP_VERSION);
        if ((await call(hv)) || (await call(hv))) { if (hdr === "new") hdr = "ok"; return false; }   // deux essais : pas un hasard du réseau
        hdr = "off";
        try { if (typeof ErrLog !== "undefined") ErrLog.capture("supabase", "version : en-tête " + VM_HEADER + " refusé par le serveur (plus envoyé)", "", "vermin"); } catch (e) {}
        return true;
      } catch (e) { return false; }
      finally { probing = null; }
    })();
    return probing;
  }

  // --- Le serveur refuse cette version ---
  function refused(j) {
    const n = j ? parseInt(String(j.details || ""), 10) : NaN;
    if (n > 0) min = n;
    const u = cur();
    if (blocked && blockedFor === u) { paint(); return; }
    blocked = true; blockedFor = u; askOut = false;
    try {
      const at = Number(sessionStorage.getItem(SS_TRY) || 0);
      if (at && Date.now() - at < VM_STILL_MS) msg = "vm.still";
    } catch (e) {}
    bind();
    clearInterval(timer);
    timer = setInterval(check, VM_CHECK_MS);
    paint();
    try { if (typeof Release !== "undefined") Release.check(true).then(paint, paint); } catch (e) {}   // annonce obligatoire : son écran passe devant
  }
  function accepted() {
    if (!blocked) return;
    const was = active();
    clear();
    try { sessionStorage.removeItem(SS_TRY); } catch (e) {}
    paint();
    if (!was) return;
    try { if (typeof Storage !== "undefined" && Storage.getUser() && Storage.retry) Storage.retry(); } catch (e) {}   // lecture du serveur puis fusion (étapes 77 et 78)
    try { toast(t("vm.back")); } catch (e) {}
  }
  function clear() {
    blocked = false; blockedFor = null; min = 0; msg = ""; askOut = false;
    clearInterval(timer); timer = null;
  }
  // Relecture du réglage (fonction toujours ouverte). Renvoie true si la lecture a réussi.
  async function check() {
    if (blocked && !active()) { clear(); paint(); return false; }   // compte fermé ou changé : le refus ne vaut plus
    if (!blocked || busy || !inner || !online()) return false;
    busy = true;
    try {
      const c = Supa.client();
      if (!c) return false;
      const r = await withTimeout(c.rpc("app_min_version"), 12000);
      if (!r || r.error || !r.data) return false;
      const m = num(Number(r.data.min), 0);
      if (r.data.ok === true || m <= 0 || parseInt(APP_VERSION, 10) >= m) accepted();
      else { min = m; paint(); }
      return true;
    } catch (e) { return false; }
    finally { busy = false; }
  }
  function bind() {
    if (bound) return;
    bound = true;
    try {
      window.addEventListener("online", () => { paint(); check(); });
      window.addEventListener("offline", paint);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      // Le clavier ne sort pas de l'écran affiché (l'appli derrière ne doit pas réagir).
      document.addEventListener("focusin", ev => {
        const box = $("#vmBlock");
        if (!box || box.hidden || box.contains(ev.target)) return;
        const b = box.querySelector("button");
        if (b) { try { b.focus(); } catch (e) {} }
      });
    } catch (e) {}
  }

  // --- Écran « Mise à jour nécessaire » ---
  function shown() { return active() && online() && !relBlocked(); }
  function paint() {
    try {
      let box = $("#vmBlock");
      const on = shown();
      document.body.classList.toggle("vm-locked", on);
      if (!on) { if (box) { box.hidden = true; box.textContent = ""; } return; }
      if (!box) {
        box = el("div", "rl-block vm-block");
        box.id = "vmBlock";
        box.setAttribute("role", "alertdialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-labelledby", "vmBlockTitle");
        document.body.appendChild(box);
      }
      const had = !box.hidden && box.firstChild;
      box.hidden = false;
      box.textContent = "";
      const card = el("div", "rl-card vm-card");
      card.appendChild(el("div", "rl-icon", "⬆️"));
      const h = el("h2", null, t("vm.title"));
      h.id = "vmBlockTitle";
      card.appendChild(h);
      card.appendChild(el("p", null, min > 0 ? t("vm.text", { v: APP_VERSION, n: min }) : t("vm.textNoMin", { v: APP_VERSION })));
      card.appendChild(el("p", "rl-keep", t("vm.keep")));
      if (msg) { const p = el("p", "rl-msg", t(msg, { v: APP_VERSION })); p.setAttribute("role", "status"); card.appendChild(p); }
      const go = el("button", "btn primary rl-go", updating ? t("rl.updating") : t("vm.reload"));
      go.type = "button"; go.id = "vmReload"; go.disabled = updating;
      go.addEventListener("click", () => update());
      card.appendChild(go);
      // Changer de compte (geste de l'utilisateur, en deux temps) : jamais fait tout seul.
      const out = el("button", "vm-out", askOut ? t("vm.logoutSure") : t("account.logout"));
      out.type = "button"; out.id = "vmLogout"; out.disabled = updating;
      out.addEventListener("click", () => {
        if (!askOut) { askOut = true; paint(); return; }
        leave();
      });
      card.appendChild(out);
      box.appendChild(card);
      if (!had) { try { go.focus(); } catch (e) {} }
    } catch (e) {}
  }
  // « Recharger » : même mise à jour que le bouton de l'étape 48 (rien n'est effacé ; hors ligne → message).
  async function update() {
    if (updating) return;
    msg = "";
    if (!online()) { msg = "rl.offline"; paint(); return; }
    updating = true; paint();
    try { sessionStorage.setItem(SS_TRY, String(Date.now())); } catch (e) {}
    try {
      if (typeof Release !== "undefined") await Release.update();     // recharge la page si tout va bien
      else location.reload();
    } catch (e) {}
    updating = false;
    msg = "rl.offline";                                               // toujours là : la mise à jour n'a pas pu se faire
    paint();
  }
  // « Se déconnecter » demandé par l'utilisateur sur l'écran : déconnexion habituelle (les données restent sur l'appareil).
  async function leave() {
    clear();
    paint();
    try { await logout(); } catch (e) {}
    clear();                                                          // un refus arrivé pendant la déconnexion ne compte plus
    paint();
  }

  return {
    wrapFetch, guardFetch, check, paint, update,
    blocked: () => active(),
    status: () => ({ blocked: active(), min, header: hdr, shown: shown() })
  };
})();
