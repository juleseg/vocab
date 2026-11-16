"use strict";

// === LANGUES ===
// Toutes les langues apprises / d'appui. Ajouter une langue = ajouter une entrée ici, rien d'autre.
//   names      : nom de la langue dans chaque langue d'interface (sert aussi à reconnaître l'en-tête d'un import)
//   tts        : voix de synthèse vocale
//   normalize  : règles de comparaison du mode Écrit (case : casse ignorée ; accents : accents tolérés ; spaces : espaces tolérés)
//   gender     : les noms ont un genre (nm, nf, nmf, nmpl, nfpl obligatoires, jamais « n »)
//   bridge     : langue « pont » ajoutée aux langues d'appui (anglais) : voir supportLangs (étape 31)
//   pos        : abréviation de chaque nature grammaticale, dans la convention des dictionnaires de cette langue
//   grammar    : tenses [{ id, names { fr, ko, en }, persons? (personnes propres à ce temps), que? }]
//                persons [{ id, label (texte, ou { fr, ko, en }), pronoun?, elide? }] — niveaux de politesse pour le coréen
//                notes [{ fr, ko, en }] : aides proposées pour le champ « note » d'une carte de conjugaison
//                join(forme, personne, temps) : forme affichée avec le pronom (« nous irons », « j'ai », « que j'aille »)
//   demo       : liste « Démo » d'un compte qui apprend cette langue
//                words [{ key, term, pos, ex, tags }] : mots ; key relie le même mot dans les autres langues (traductions)
//                cards [...] : autres types de cartes ; les textes { fr, ko, en } sont pris dans la 1re langue d'appui disponible
const LANG_DEFAULT = "fr"; // langue apprise par défaut d'un nouveau compte (si rien n'est choisi)
const FR_VOWEL = /^[aeiouyhàâäéèêëîïôöûüœæ]/i;
const LANGUAGES = {
  fr: { code: "fr", names: { fr: "Français", ko: "프랑스어", en: "French" }, tts: "fr-FR",
        normalize: { case: true, accents: true, spaces: false }, gender: true,
        pos: { nm: "n.m.", nf: "n.f.", nmf: "n.m. et f.", nmpl: "n.m.pl.", nfpl: "n.f.pl.", n: "n.", v: "v.", vpr: "v. pr.",
               adj: "adj.", adv: "adv.", prep: "prép.", conj: "conj.", pron: "pron.", interj: "interj.", expr: "expr." },
        grammar: {
          tenses: [
            { id: "present", names: { fr: "présent", ko: "직설법 현재", en: "present" } },
            { id: "passe_compose", names: { fr: "passé composé", ko: "복합 과거", en: "passé composé (compound past)" } },
            { id: "imparfait", names: { fr: "imparfait", ko: "반과거", en: "imperfect" } },
            { id: "plus_que_parfait", names: { fr: "plus-que-parfait", ko: "대과거", en: "pluperfect" } },
            { id: "futur_simple", names: { fr: "futur simple", ko: "단순 미래", en: "simple future" } },
            { id: "futur_anterieur", names: { fr: "futur antérieur", ko: "전미래", en: "future perfect" } },
            { id: "cond_present", names: { fr: "conditionnel présent", ko: "조건법 현재", en: "present conditional" } },
            { id: "cond_passe", names: { fr: "conditionnel passé", ko: "조건법 과거", en: "past conditional" } },
            { id: "subj_present", names: { fr: "subjonctif présent", ko: "접속법 현재", en: "present subjunctive" }, que: true },
            { id: "imperatif", names: { fr: "impératif présent", ko: "명령법 현재", en: "imperative" },
              persons: [{ id: "2s", label: "(tu)" }, { id: "1p", label: "(nous)" }, { id: "2p", label: "(vous)" }] },
            { id: "passe_simple", names: { fr: "passé simple", ko: "단순 과거", en: "passé simple (simple past)" }, optional: true }
          ],
          persons: [
            { id: "1s", label: "je", pronoun: "je", elide: "j'" }, { id: "2s", label: "tu", pronoun: "tu" },
            { id: "3s", label: "il/elle/on", pronoun: "il/elle/on" }, { id: "1p", label: "nous", pronoun: "nous" },
            { id: "2p", label: "vous", pronoun: "vous" }, { id: "3p", label: "ils/elles", pronoun: "ils/elles" }
          ],
          notes: [
            { fr: "auxiliaire avoir", ko: "조동사 avoir", en: "auxiliary avoir" },
            { fr: "auxiliaire être", ko: "조동사 être", en: "auxiliary être" },
            { fr: "irrégulier", ko: "불규칙", en: "irregular" },
            { fr: "1er groupe (-er)", ko: "1군 동사 (-er)", en: "1st group (-er)" },
            { fr: "2e groupe (-ir)", ko: "2군 동사 (-ir)", en: "2nd group (-ir)" },
            { fr: "3e groupe", ko: "3군 동사", en: "3rd group" }
          ],
          join(form, p, tense) {
            if (!p || !p.pronoun) return form;
            let pr = p.elide && FR_VOWEL.test(form) ? p.elide : p.pronoun;
            if (tense && tense.que) pr = (FR_VOWEL.test(pr) ? "qu'" : "que ") + pr;
            return pr.endsWith("'") ? pr + form : pr + " " + form;
          }
        },
        demo: {
          words: [
            { key: "hello", term: "bonjour", pos: "interj", ex: "Bonjour, comment ça va ?", tags: ["salutations"] },
            { key: "thanks", term: "merci", pos: "interj", ex: "Merci beaucoup !", tags: ["salutations"] },
            { key: "fly", term: "voler / s'envoler", pos: "v", ex: "L'oiseau vole au-dessus de la maison.", tags: ["verbes"] },
            { key: "eat", term: "manger", pos: "v", ex: "Je mange une pomme.", tags: ["verbes"] },
            { key: "drink", term: "boire", pos: "v", ex: "Elle boit un café le matin.", tags: ["verbes"] },
            { key: "water", term: "l'eau", pos: "nf", ex: "Un verre d'eau, s'il vous plaît.", tags: ["noms"] },
            { key: "house", term: "la maison", pos: "nf", ex: "Je rentre à la maison.", tags: ["noms"] },
            { key: "cat", term: "le chat", pos: "nm", ex: "Le chat dort sur le canapé.", tags: ["noms", "animaux"] },
            { key: "school", term: "l'école", pos: "nf", ex: "Les enfants vont à l'école.", tags: ["noms"] },
            { key: "beautiful", term: "beau / belle", pos: "adj", ex: "Quelle belle journée !", tags: ["adjectifs"] }
          ],
          cards: [
            { type: "rule", key: "r1", title: "à + le = au · à + les = aux",
              body: { ko: "**à + le** → **au**\n**à + les** → **aux**\n- à + la, à + l' : 그대로", fr: "**à + le** → **au**\n**à + les** → **aux**\n- à + la, à + l' : pas de changement", en: "**à + le** → **au**\n**à + les** → **aux**\n- à + la, à + l': no change" },
              examples: ["Je vais au cinéma.", "Je parle aux enfants.", "Je vais à la plage."],
              translation: { ko: "전치사 à 뒤에 le / les 가 오면 au / aux 로 줄여 씁니다.", en: "à + le becomes au, à + les becomes aux." } },
            { type: "conjtab", verb: "aller", tense: "present", forms: ["vais", "vas", "va", "allons", "allez", "vont"],
              translation: { ko: "가다", en: "to go" }, note: { ko: "불규칙", en: "irregular", fr: "irrégulier" } },
            { type: "cloze", sentence: "Je vais ___ boulangerie.", answer: "à la", ruleKey: "r1",
              hint: { ko: "전치사 + 관사", en: "preposition + article", fr: "préposition + article" },
              explanation: { ko: "aller à + la (boulangerie 는 여성 명사)", en: "aller à + la (boulangerie is feminine)", fr: "aller à + la (boulangerie est féminin)" },
              translation: { ko: "빵집에 가요.", en: "I'm going to the bakery." } },
            { type: "fix", wrong: "Je suis allé au boulangerie.", correct: "Je suis allé à la boulangerie.", ruleKey: "r1",
              explanation: { ko: "boulangerie 는 여성 명사 → à la", en: "boulangerie is feminine → à la", fr: "boulangerie est féminin → à la" } }
          ]
        } },
  ko: { code: "ko", names: { fr: "Coréen", ko: "한국어", en: "Korean" }, tts: "ko-KR",
        normalize: { case: true, accents: false, spaces: true }, gender: false,
        pos: { nm: "명", nf: "명", nmf: "명", nmpl: "명", nfpl: "명", n: "명", v: "동", vpr: "동",
               adj: "형", adv: "부", prep: "조", conj: "접", pron: "대", interj: "감", expr: "구" },
        grammar: {
          tenses: [
            { id: "present", names: { fr: "présent", ko: "현재", en: "present" } },
            { id: "past", names: { fr: "passé", ko: "과거", en: "past" } },
            { id: "future", names: { fr: "futur", ko: "미래", en: "future" } },
            { id: "progressive", names: { fr: "progressif (-고 있다)", ko: "진행 (-고 있다)", en: "progressive (-고 있다)" } },
            { id: "e_go", names: { fr: "terminaison -고 (et)", ko: "-고", en: "ending -고 (and)" }, persons: "form" },
            { id: "e_aseo", names: { fr: "terminaison -아서/어서 (donc, puis)", ko: "-아서/어서", en: "ending -아서/어서 (so, then)" }, persons: "form" },
            { id: "e_myeon", names: { fr: "terminaison -(으)면 (si)", ko: "-(으)면", en: "ending -(으)면 (if)" }, persons: "form" },
            { id: "e_jiman", names: { fr: "terminaison -지만 (mais)", ko: "-지만", en: "ending -지만 (but)" }, persons: "form" },
            { id: "e_nikka", names: { fr: "terminaison -(으)니까 (parce que)", ko: "-(으)니까", en: "ending -(으)니까 (because)" }, persons: "form" }
          ],
          // Pas de personnes en coréen : niveaux de politesse. "form" = forme unique (terminaisons de liaison).
          persons: [
            { id: "formal", label: "합니다체", names: { fr: "formel", en: "formal" } },
            { id: "polite", label: "해요체", names: { fr: "poli", en: "polite" } },
            { id: "casual", label: "반말", names: { fr: "familier", en: "casual" } }
          ],
          personSets: { form: [{ id: "form", label: { fr: "forme", ko: "형태", en: "form" } }] },
          notes: [
            { fr: "irrégulier", ko: "불규칙", en: "irregular" },
            { fr: "irrégulier en ㅂ", ko: "ㅂ 불규칙", en: "ㅂ irregular" },
            { fr: "irrégulier en ㄷ", ko: "ㄷ 불규칙", en: "ㄷ irregular" },
            { fr: "irrégulier en 르", ko: "르 불규칙", en: "르 irregular" }
          ]
        },
        demo: {
          words: [
            { key: "hello", term: "안녕하세요", pos: "interj", ex: "안녕하세요, 만나서 반가워요.", tags: ["인사"] },
            { key: "thanks", term: "감사합니다", pos: "interj", ex: "도와주셔서 감사합니다.", tags: ["인사"] },
            { key: "fly", term: "날다", pos: "v", ex: "새가 하늘을 날아요.", tags: ["동사"] },
            { key: "eat", term: "먹다", pos: "v", ex: "저는 사과를 먹어요.", tags: ["동사"] },
            { key: "drink", term: "마시다", pos: "v", ex: "아침에 커피를 마셔요.", tags: ["동사"] },
            { key: "water", term: "물", pos: "n", ex: "물 한 잔 주세요.", tags: ["명사"] },
            { key: "house", term: "집", pos: "n", ex: "집에 가요.", tags: ["명사"] },
            { key: "cat", term: "고양이", pos: "n", ex: "고양이가 소파에서 자요.", tags: ["명사", "동물"] },
            { key: "school", term: "학교", pos: "n", ex: "아이들이 학교에 가요.", tags: ["명사"] },
            { key: "beautiful", term: "아름답다", pos: "adj", ex: "정말 아름다운 날이에요.", tags: ["형용사"] }
          ],
          cards: [
            { type: "rule", key: "r1", title: "N + 에 가다",
              body: { fr: "Lieu où l'on va : **nom + 에** + 가다 / 오다.\n- 학교**에** 가요 : je vais à l'école\n- 집**에** 와요 : je viens à la maison", en: "Place you go to: **noun + 에** + 가다 / 오다.\n- 학교**에** 가요: I go to school\n- 집**에** 와요: I come home" },
              examples: ["학교에 가요.", "한국에 가고 싶어요.", "집에 왔어요."],
              translation: { fr: "에 marque la destination.", en: "에 marks the destination." } },
            { type: "conjtab", verb: "가다", tense: "present", forms: ["갑니다", "가요", "가"], translation: { fr: "aller", en: "to go" } },
            { type: "conjtab", verb: "먹다", tense: "past", forms: ["먹었습니다", "먹었어요", "먹었어"], translation: { fr: "manger", en: "to eat" } },
            { type: "cloze", sentence: "저는 학교___ 가요.", answer: "에", ruleKey: "r1",
              hint: { fr: "particule", en: "particle", ko: "조사" },
              explanation: { fr: "Destination : nom + 에 + 가다", en: "Destination: noun + 에 + 가다", ko: "장소 + 에 + 가다" },
              translation: { fr: "Je vais à l'école.", en: "I go to school." } },
            { type: "fix", wrong: "저는 학교를 가요.", correct: "저는 학교에 가요.", ruleKey: "r1",
              explanation: { fr: "Avec 가다, la destination prend 에.", en: "With 가다, the destination takes 에.", ko: "가다 앞의 장소에는 에를 씁니다." } }
          ]
        } },
  en: { code: "en", names: { fr: "Anglais", ko: "영어", en: "English" }, tts: "en-US",
        normalize: { case: true, accents: true, spaces: false }, gender: false, bridge: true,
        pos: { nm: "n.", nf: "n.", nmf: "n.", nmpl: "n. pl.", nfpl: "n. pl.", n: "n.", v: "v.", vpr: "v.",
               adj: "adj.", adv: "adv.", prep: "prep.", conj: "conj.", pron: "pron.", interj: "interj.", expr: "phr." },
        grammar: {
          tenses: [
            { id: "present_simple", names: { fr: "présent simple", ko: "현재 단순", en: "present simple" } },
            { id: "present_continuous", names: { fr: "présent continu", ko: "현재 진행", en: "present continuous" } },
            { id: "past_simple", names: { fr: "prétérit (past simple)", ko: "과거 단순", en: "past simple" } },
            { id: "past_continuous", names: { fr: "passé continu", ko: "과거 진행", en: "past continuous" } },
            { id: "present_perfect", names: { fr: "present perfect", ko: "현재 완료", en: "present perfect" } },
            { id: "future_will", names: { fr: "futur (will)", ko: "미래 (will)", en: "future (will)" } },
            { id: "going_to", names: { fr: "futur proche (going to)", ko: "미래 (going to)", en: "going to" } },
            { id: "conditional", names: { fr: "conditionnel (would)", ko: "조건 (would)", en: "conditional (would)" } },
            { id: "irregular", names: { fr: "verbes irréguliers", ko: "불규칙 동사", en: "irregular verbs" }, persons: "irregular" }
          ],
          persons: [
            { id: "1s", label: "I", pronoun: "I" }, { id: "2s", label: "you", pronoun: "you" },
            { id: "3s", label: "he/she/it", pronoun: "he/she/it" }, { id: "1p", label: "we", pronoun: "we" },
            { id: "2p", label: { fr: "you (pluriel)", ko: "you (복수)", en: "you (plural)" }, pronoun: "you" }, { id: "3p", label: "they", pronoun: "they" }
          ],
          personSets: { irregular: [
            { id: "base", label: { fr: "base verbale", ko: "원형", en: "base form" } },
            { id: "past", label: { fr: "prétérit", ko: "과거형", en: "past simple" } },
            { id: "participle", label: { fr: "participe passé", ko: "과거분사", en: "past participle" } }
          ] },
          notes: [
            { fr: "irrégulier", ko: "불규칙", en: "irregular" },
            { fr: "régulier", ko: "규칙", en: "regular" }
          ]
        },
        demo: {
          words: [
            { key: "hello", term: "hello", pos: "interj", ex: "Hello, how are you?", tags: ["greetings"] },
            { key: "thanks", term: "thank you", pos: "expr", ex: "Thank you very much!", tags: ["greetings"] },
            { key: "fly", term: "to fly", pos: "v", ex: "The bird flies over the house.", tags: ["verbs"] },
            { key: "eat", term: "to eat", pos: "v", ex: "I eat an apple.", tags: ["verbs"] },
            { key: "drink", term: "to drink", pos: "v", ex: "She drinks coffee in the morning.", tags: ["verbs"] },
            { key: "water", term: "water", pos: "n", ex: "A glass of water, please.", tags: ["nouns"] },
            { key: "house", term: "house / home", pos: "n", ex: "I'm going home.", tags: ["nouns"] },
            { key: "cat", term: "cat", pos: "n", ex: "The cat sleeps on the sofa.", tags: ["nouns", "animals"] },
            { key: "school", term: "school", pos: "n", ex: "The children go to school.", tags: ["nouns"] },
            { key: "beautiful", term: "beautiful", pos: "adj", ex: "What a beautiful day!", tags: ["adjectives"] }
          ],
          cards: [
            { type: "rule", key: "r1", title: "Present simple: he / she / it + -s",
              body: { fr: "Avec **he / she / it**, on ajoute **-s** (ou **-es**) au verbe.\n- go → goes\n- do → does\n- have → has", ko: "**he / she / it** 뒤에서는 동사에 **-s**(또는 **-es**)를 붙입니다.\n- go → goes\n- do → does\n- have → has" },
              examples: ["She works in Seoul.", "He goes to school.", "It has four legs."],
              translation: { fr: "Au présent simple, -s à la 3e personne du singulier.", ko: "현재 단순 시제의 3인칭 단수에는 -s." } },
            { type: "conjtab", verb: "to be", tense: "present_simple", forms: ["am", "are", "is", "are", "are", "are"],
              translation: { fr: "être", ko: "이다 / 있다" }, note: { fr: "irrégulier", ko: "불규칙", en: "irregular" } },
            { type: "conjtab", verb: "go", tense: "irregular", forms: ["go", "went", "gone"], translation: { fr: "aller", ko: "가다" } },
            { type: "cloze", sentence: "She ___ to school every day.", answer: "goes", ruleKey: "r1",
              hint: { fr: "go, présent simple", ko: "go, 현재 단순", en: "go, present simple" },
              explanation: { fr: "she → go + -es = goes", ko: "she → go + -es = goes", en: "she → go + -es = goes" },
              translation: { fr: "Elle va à l'école tous les jours.", ko: "그녀는 매일 학교에 가요." } },
            { type: "fix", wrong: "He don't like coffee.", correct: "He doesn't like coffee.", ruleKey: "r1",
              explanation: { fr: "he/she/it → does not (doesn't)", ko: "he/she/it → does not (doesn't)", en: "he/she/it → does not (doesn't)" } }
          ]
        } }
};
const LANG_CODES = Object.keys(LANGUAGES);

function isLang(code) { return typeof code === "string" && Object.prototype.hasOwnProperty.call(LANGUAGES, code); }
// Nom d'une langue dans la langue de l'interface (ou dans ui si donné).
function langName(code, ui) {
  const L = LANGUAGES[code];
  if (!L) return String(code || "");
  const u = ui || (state && state.settings && state.settings.uiLang) || "fr";
  return L.names[u] || L.names.fr || code;
}
function langCodes(codes) { return arr(codes).map(c => String(c).toUpperCase()).join("·"); }
// « KO·EN → FR » : langues d'appui → langue apprise
function pairLabel(lg) { return langCodes(lg.support) + " → " + langCodes([lg.target]); }
function langRules(code) { return (LANGUAGES[code] && LANGUAGES[code].normalize) || { case: true, accents: true, spaces: false }; }
// --- Langues d'appui (étape 31) ---
// Plus choisies à la main : calculées depuis la langue apprise et la langue de l'interface.
//   - toujours la langue de l'interface ;
//   - plus la langue « pont » (bridge : anglais), sauf si c'est la langue apprise ou déjà la langue de l'interface ;
//   - si l'interface est dans la langue apprise : la langue pont seule (ou, si on apprend la langue pont, la 1re autre langue).
// Ordre : interface, puis pont. Les champs support des dossiers / listes / compte restent dans les données, ignorés.
// Toutes les autres langues d'une carte sont cachées partout (gardées dans terms, elles réapparaissent si l'interface change).
function bridgeLang() { return LANG_CODES.find(c => LANGUAGES[c].bridge) || ""; }
function uiLangNow() {
  let u = "";
  try { u = (state && state.settings && state.settings.uiLang) || ""; } catch (e) {}   // state pas encore créé au chargement
  if (!isLang(u)) { try { u = defaultLang(); } catch (e) { u = ""; } }                  // langue de l'appareil (écran de connexion)
  return isLang(u) ? u : (bridgeLang() || LANG_CODES[0]);
}
function supportLangs(target, uiLang) {
  const ui = isLang(uiLang) ? uiLang : uiLangNow();
  const br = bridgeLang();
  if (ui === target) {
    if (br && br !== target) return [br];
    const o = LANG_CODES.find(c => c !== target);
    return o ? [o] : [];
  }
  const out = [ui];
  if (br && br !== target && br !== ui) out.push(br);
  return out;
}
// Langues visibles d'une carte de vocabulaire : langue apprise + langues d'appui (dans l'ordre d'affichage).
function visibleLangs(lg) { return [lg.target].concat(lg.support); }
// Ancien nom gardé : langues d'appui calculées pour l'interface actuelle.
function defaultSupportFor(target) { return supportLangs(target); }
function cleanSupport(support, target) {
  const out = [];
  arr(support).forEach(c => { if (isLang(c) && c !== target && !out.includes(c)) out.push(c); });
  return out;
}
// Héritage compte → dossier → liste : le dernier niveau qui a une langue apprise l'emporte.
// Langues d'appui : toujours calculées (supportLangs), jamais lues dans les données.
function resolveLangs(levels, uiLang) {
  let target = isLang(LANG_DEFAULT) ? LANG_DEFAULT : LANG_CODES[0];
  levels.forEach(o => { if (o && isLang(o.target)) target = o.target; });
  return { target, support: supportLangs(target, uiLang) };
}
function accountLangs() { return resolveLangs([{ target: state.settings.defaultTarget, support: state.settings.defaultSupport }]); }
function folderLangs(folder) { return resolveLangs([accountLangs(), folder]); }
function listLangs(listOrId) {
  const l = typeof listOrId === "string" ? getList(listOrId) : listOrId;
  const f = l && l.folderId ? getFolder(l.folderId) : null;
  return resolveLangs([accountLangs(), f, l]);
}
function cardLangs(c) { return listLangs(c.listId); }
function sameLangs(a, b) { return a.target === b.target && a.support.join() === b.support.join(); }

// --- Champs d'une carte ---
function term(c, code) { return (c && c.terms && typeof c.terms[code] === "string") ? c.terms[code] : ""; }
function targetTerm(c, lg) { return term(c, (lg || cardLangs(c)).target); }
// Traductions remplies dans les langues d'appui, dans l'ordre : [{ code, text }]
function supportTerms(c, lg) {
  return (lg || cardLangs(c)).support.map(code => ({ code, text: term(c, code) })).filter(x => x.text.trim());
}
// Langues d'appui sans traduction (case « à compléter »).
function missingSupport(c, lg) { lg = lg || cardLangs(c); return isVocab(c) ? lg.support.filter(code => !term(c, code).trim()) : []; }
function supportText(c, lg) { return supportTerms(c, lg).map(x => x.text).join(" · "); }
// Carte utilisable en révision : mot dans la langue apprise + au moins une langue d'appui (autres types : typedUsable).
function cardUsable(c, lg) { if (!isVocab(c)) return typedUsable(c); lg = lg || cardLangs(c); return !!targetTerm(c, lg).trim() && supportTerms(c, lg).length > 0; }
// Champ générique : code de langue, "example", "pos:<code>" (nature grammaticale dans cette langue)
// ou "f:<champ>" (champ d'un autre type de carte : translation, hint, explanation, note, examples ; exemples séparés par « | »).
const TYPED_FILL_FIELDS = ["translation", "hint", "explanation", "note", "examples"];
function typedField(name) { return "f:" + name; }
function isTypedField(f) { return typeof f === "string" && f.startsWith("f:") && TYPED_FILL_FIELDS.includes(f.slice(2)); }
function fieldVal(c, f) {
  if (f === "example") return String(c.example || "");
  if (isTypedField(f)) { const k = f.slice(2); return k === "examples" ? arr(c.examples).join(" | ") : String(c[k] || ""); }
  if (isPosField(f)) return (c.pos && typeof c.pos[f.slice(4)] === "string") ? c.pos[f.slice(4)] : "";
  return term(c, f);
}
function setFieldVal(c, f, v) {
  if (f === "example") c.example = v;
  else if (isTypedField(f)) { const k = f.slice(2); if (k === "examples") c.examples = String(v || "").split("|").map(x => x.trim()).filter(Boolean); else c[k] = v; }
  else if (isPosField(f)) { c.pos = Object.assign({}, c.pos); if (v) c.pos[f.slice(4)] = v; else delete c.pos[f.slice(4)]; }
  else { c.terms[f] = v; }
}

// --- Nature grammaticale ---
// Codes communs à toutes les langues ; l'abréviation affichée vient de LANGUAGES[langue].pos.
const POS_CODES = ["nm", "nf", "nmf", "nmpl", "nfpl", "n", "v", "vpr", "adj", "adv", "prep", "conj", "pron", "interj", "expr"];
const POS_GENDERED = ["nm", "nf", "nmf", "nmpl", "nfpl"];
function isPosField(f) { return typeof f === "string" && f.startsWith("pos:") && isLang(f.slice(4)); }
function posField(code) { return "pos:" + code; }
// Codes proposés pour une langue : noms avec genre si la langue a un genre, sinon « n ».
function posCodesFor(lng) {
  const g = !!(LANGUAGES[lng] && LANGUAGES[lng].gender);
  return POS_CODES.filter(x => g ? x !== "n" : !POS_GENDERED.includes(x));
}
// Abréviation du dictionnaire (« n.f. », « 명 », « v. ») ; texte libre (import non reconnu) affiché tel quel.
function posLabel(code, lng) {
  if (!code) return "";
  const L = LANGUAGES[lng];
  return (L && L.pos && L.pos[code]) || code;
}
// Code de nature pour un texte saisi ou importé (code, abréviation d'une langue, « nom féminin »…), sinon "".
// Le code est ensuite adapté à la langue du mot : « nf » → « n » pour une langue sans genre.
function parsePos(raw, lng) {
  const k = s => normText(s).replace(/[\s.]+/g, "");
  const x = k(raw);
  if (!x) return "";
  let code = POS_CODES.find(c => c === x) || "";
  if (!code) {
    const order = [lng].concat(LANG_CODES.filter(c => c !== lng)).filter(isLang);
    for (const L of order) { const p = LANGUAGES[L].pos || {}; code = POS_CODES.find(c => p[c] && k(p[c]) === x) || ""; if (code) break; }
  }
  if (!code) for (const u of ["fr", "en", "ko"]) { code = POS_CODES.find(c => I18N[u]["pos." + c] && k(I18N[u]["pos." + c]) === x) || ""; if (code) break; }
  if (!code || !isLang(lng)) return code;
  const g = !!LANGUAGES[lng].gender;
  if (!g && POS_GENDERED.includes(code)) return "n";
  if (g && code === "n") return "";                // nom sans genre refusé pour une langue à genre
  return code;
}
// Petite étiquette affichée à côté du mot, ou null.
function posTag(c, lng) {
  const v = c && c.pos && c.pos[lng];
  if (!v) return null;
  const s = el("span", "pos", posLabel(v, lng));
  if (POS_CODES.includes(v)) s.title = t("pos." + v);
  return s;
}

// --- Dossiers ---
function getFolder(id) { return (id && state.folders.find(f => f.id === id)) || null; }
function byOrder(a, b) { return a.order - b.order; }
function sortedFolders() { return state.folders.slice().sort(byOrder); }
function listsIn(folderId) { return state.lists.filter(l => (l.folderId || null) === (folderId || null)).sort(byOrder); }
// Toutes les listes dans l'ordre d'affichage : dossiers dans l'ordre, puis « Sans dossier ».
function orderedLists() {
  const out = [];
  sortedFolders().forEach(f => out.push(...listsIn(f.id)));
  out.push(...listsIn(null));
  return out;
}
function nextOrder(items) { return items.reduce((m, x) => Math.max(m, num(x.order, -1)), -1) + 1; }
function listLabel(l) { const f = l && getFolder(l.folderId); return l ? (f ? f.name + " › " : "") + l.name : ""; }
