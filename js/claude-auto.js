"use strict";

// === DEMANDES À CLAUDE SANS VALIDATION (ÉTAPE 73) ===
// Ce que Claude renvoie (compléter, vérifier, genre manquant, générer ; accès direct, file d'attente, copier-coller, fichier)
// s'applique DIRECTEMENT aux cartes : plus de passage par « À valider ».
// RÈGLE DES CASES (Jules) : une case remplie PAR CLAUDE peut être réécrite par une nouvelle réponse de Claude ; une case
// remplie ou validée PAR L'UTILISATEUR est CONSERVÉE (la version de l'utilisateur gagne toujours).
// Origine d'une case : marque « cl:<champ> » dans le tableau existant c.auto (pas de nouveau champ de carte, DATA_VERSION 8
// inchangé ; un appareil plus ancien garde ces marques telles quelles, car c.auto est une liste de textes).
//   <champ> = nom absolu du champ : code de langue (mot), "pos:<code>", "exl:<langue>" (exemple), "exlt:<langue>:<code>"
//   (traduction de l'exemple), "f:<champ>" (autres types de cartes). "example" / "extr:<code>" sont ramenés à exl / exlt.
// Sans marque « cl: » = case de l'utilisateur. Toutes les cases remplies AVANT l'étape 73 n'ont pas de marque : elles
// comptent donc comme venant de l'utilisateur (sécurité). La marque part dès que l'utilisateur change la case
// (éditeur de carte : ClAuto.snap / ClAuto.afterEdit) ou utilise sa phrase comme exemple (js/sentences.js).
// Exception : « Genre manquant » (nature « n » sans genre, étape 60) : le genre donné par Claude complète la case.
// Restent dans « À valider » : les doublons (« dup » : suppression d'une carte, jamais automatique), les propositions déjà
// en attente avant l'étape 73, et les cartes générées qui n'ont pas pu être créées telles quelles (case non valide).
const ClAuto = (() => {
  const P = "cl:";
  let applied = 0, kept = 0;   // compteurs depuis le lancement (lus par différence : file d'attente, messages)

  // Nom absolu d'un champ (ne dépend plus de la langue apprise de la liste).
  function canon(c, f) {
    if (!c || !isVocab(c)) return f;
    const T = cardLangs(c).target;
    if (f === "example") return exlField(T);
    if (isExTrField(f)) return exltField(T, f.slice(5));
    return f;
  }
  const key = (c, f) => P + canon(c, f);
  function has(c, f) { return !!c && Array.isArray(c.auto) && c.auto.includes(key(c, f)); }
  function mark(c, f) {
    if (!Array.isArray(c.auto)) c.auto = [];
    const k = key(c, f);
    if (!c.auto.includes(k)) c.auto.push(k);
  }
  function unmark(c, f) { if (Array.isArray(c.auto)) c.auto = c.auto.filter(a => a !== key(c, f)); }
  function marks(c) { return arr(c && c.auto).filter(a => String(a).startsWith(P)).map(a => String(a).slice(P.length)); }
  // Marque « généré, non validé » d'origine (étapes 17 à 72) : les marques « cl: » ne comptent pas.
  function legacyAuto(c) { return arr(c && c.auto).filter(a => !String(a).startsWith(P)); }

  // Genre manquant (étape 60) : « n » sans genre → nom avec genre donné par Claude.
  function genderFill(c, f, nv) {
    return isPosField(f) && posNeedsGender(c, f.slice(4)) && POS_GENDERED.includes(nv);
  }

  // Applique une valeur de Claude. type : "completion" | "correction". nv : valeur déjà nettoyée et valide.
  // Renvoie true si la case a été écrite.
  function apply(c, f, type, nv) {
    const cur = String(fieldVal(c, f) || "").trim();
    if (cur === nv) return false;                                       // déjà cette valeur
    if (type === "completion" && isVocab(c) && f === cardLangs(c).target) return false;   // mot de la langue apprise : jamais complété
    if (cur && !has(c, f) && !genderFill(c, f, nv)) { kept++; return false; }   // case de l'utilisateur : conservée
    const next = Object.assign({}, c, { terms: Object.assign({}, c.terms), pos: Object.assign({}, c.pos) });   // setFieldVal ne modifie pas examples en place
    setFieldVal(next, f, nv);
    if (!cardUsable(next) && cardUsable(c)) return false;              // valeur qui rendrait la carte inutilisable
    const snap = Dict.track(c);                                         // dictionnaire commun (étape 36), comme une acceptation
    setFieldVal(c, f, nv);
    Dict.changed(c, snap);                                              // case vide du commun → remplie ; déjà remplie → proposition (validée par l'admin)
    mark(c, f);                                                         // case de Claude : réécrivable par Claude
    const ak = typeof autoKeyOf === "function" && isVocab(c) ? autoKeyOf(f) : "";
    if (ak && Array.isArray(c.auto)) c.auto = c.auto.filter(a => a !== ak);   // plus « générée par le dictionnaire »
    state.proposals = state.proposals.filter(p => !(p.cardId === c.id && p.field === f));   // ancienne proposition sur la même case : inutile
    if (isVocab(c)) state.checkedSig[c.id] = cardSig(c);
    applied++;
    return true;
  }

  // Carte créée par Claude (« Générer des cartes ») : toutes ses cases remplies viennent de Claude.
  function markCard(c) {
    if (!c) return;
    const fs = isVocab(c) ? checkFields(c).concat(studyExtraFields(c)) : checkFields(c);
    fs.forEach(f => { if (String(fieldVal(c, f) || "").trim()) mark(c, f); });
  }

  // Éditeur de carte : valeurs des cases de Claude avant l'enregistrement, puis marques retirées des cases changées à la main.
  function snap(c) {
    const o = {};
    marks(c).forEach(f => { o[f] = String(fieldVal(c, f) || ""); });
    return o;
  }
  function afterEdit(c, before) {
    if (!c || !before) return;
    Object.keys(before).forEach(f => {
      if (String(fieldVal(c, f) || "").trim() !== before[f].trim()) unmark(c, f);
    });
  }

  return {
    has, mark, unmark, marks, legacyAuto, apply, markCard, snap, afterEdit, canon,
    applied: () => applied, kept: () => kept
  };
})();
window.App.ClAuto = ClAuto;
