"use strict";

// === LANGUES ===
// Toutes les langues apprises / d'appui. Ajouter une langue = ajouter une entrée ici, rien d'autre.
//   names      : nom de la langue dans chaque langue d'interface (sert aussi à reconnaître l'en-tête d'un import)
//   tts        : voix de synthèse vocale
//   normalize  : règles de comparaison du mode Écrit (case : casse ignorée ; accents : accents tolérés ; spaces : espaces tolérés)
//   gender     : les noms ont un genre (nm, nf, nmf, nmpl, nfpl obligatoires, jamais « n »)
//   pos        : abréviation de chaque nature grammaticale, dans la convention des dictionnaires de cette langue
//   grammar    : (facultatif, étape 35 : fr, en, ko seulement) — sans grammar, pas de type conj ni de mode Tableau
//                tenses [{ id, names { fr, ko, en }, persons? (personnes propres à ce temps), que? }]
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
        normalize: { case: true, accents: true, spaces: false }, gender: false,
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
        } },
  // --- Étape 35 : langues sans grammar (vocabulaire, trou, erreur, règle ; pas de conjugaison ni de mode Tableau) ---
  it: { code: "it", names: { fr: "Italien", ko: "이탈리아어", en: "Italian" }, tts: "it-IT",
        normalize: { case: true, accents: true, spaces: false }, gender: true,
        pos: { nm: "s.m.", nf: "s.f.", nmf: "s.m. e f.", nmpl: "s.m.pl.", nfpl: "s.f.pl.", n: "s.", v: "v.", vpr: "v. rifl.",
               adj: "agg.", adv: "avv.", prep: "prep.", conj: "cong.", pron: "pron.", interj: "inter.", expr: "loc." },
        demo: { words: [
          { key: "hello", term: "ciao", pos: "interj", ex: "Ciao, come stai?", tags: ["saluti"] },
          { key: "thanks", term: "grazie", pos: "interj", ex: "Grazie mille!", tags: ["saluti"] },
          { key: "fly", term: "volare", pos: "v", ex: "L'uccello vola sopra la casa.", tags: ["verbi"] },
          { key: "eat", term: "mangiare", pos: "v", ex: "Mangio una mela.", tags: ["verbi"] },
          { key: "drink", term: "bere", pos: "v", ex: "Lei beve un caffè la mattina.", tags: ["verbi"] },
          { key: "water", term: "l'acqua", pos: "nf", ex: "Un bicchiere d'acqua, per favore.", tags: ["nomi"] },
          { key: "house", term: "la casa", pos: "nf", ex: "Torno a casa.", tags: ["nomi"] },
          { key: "cat", term: "il gatto", pos: "nm", ex: "Il gatto dorme sul divano.", tags: ["nomi", "animali"] },
          { key: "school", term: "la scuola", pos: "nf", ex: "I bambini vanno a scuola.", tags: ["nomi"] },
          { key: "beautiful", term: "bello / bella", pos: "adj", ex: "Che bella giornata!", tags: ["aggettivi"] }
        ] } },
  es: { code: "es", names: { fr: "Espagnol", ko: "스페인어", en: "Spanish" }, tts: "es-ES",
        normalize: { case: true, accents: true, spaces: false }, gender: true,
        pos: { nm: "m.", nf: "f.", nmf: "m. y f.", nmpl: "m. pl.", nfpl: "f. pl.", n: "s.", v: "v.", vpr: "v. prnl.",
               adj: "adj.", adv: "adv.", prep: "prep.", conj: "conj.", pron: "pron.", interj: "interj.", expr: "loc." },
        demo: { words: [
          { key: "hello", term: "hola", pos: "interj", ex: "Hola, ¿qué tal?", tags: ["saludos"] },
          { key: "thanks", term: "gracias", pos: "interj", ex: "¡Muchas gracias!", tags: ["saludos"] },
          { key: "fly", term: "volar", pos: "v", ex: "El pájaro vuela sobre la casa.", tags: ["verbos"] },
          { key: "eat", term: "comer", pos: "v", ex: "Como una manzana.", tags: ["verbos"] },
          { key: "drink", term: "beber", pos: "v", ex: "Ella bebe café por la mañana.", tags: ["verbos"] },
          { key: "water", term: "el agua", pos: "nf", ex: "Un vaso de agua, por favor.", tags: ["sustantivos"] },
          { key: "house", term: "la casa", pos: "nf", ex: "Vuelvo a casa.", tags: ["sustantivos"] },
          { key: "cat", term: "el gato", pos: "nm", ex: "El gato duerme en el sofá.", tags: ["sustantivos", "animales"] },
          { key: "school", term: "la escuela", pos: "nf", ex: "Los niños van a la escuela.", tags: ["sustantivos"] },
          { key: "beautiful", term: "bonito / bonita", pos: "adj", ex: "¡Qué día tan bonito!", tags: ["adjetivos"] }
        ] } },
  // Allemand : trois genres (der / die / das) ; les codes nm / nf ne couvrent pas le neutre, donc « n » + article dans le mot.
  de: { code: "de", names: { fr: "Allemand", ko: "독일어", en: "German" }, tts: "de-DE",
        normalize: { case: true, accents: true, spaces: false }, gender: false,
        pos: { nm: "Subst.", nf: "Subst.", nmf: "Subst.", nmpl: "Subst. Pl.", nfpl: "Subst. Pl.", n: "Subst.", v: "V.", vpr: "refl. V.",
               adj: "Adj.", adv: "Adv.", prep: "Präp.", conj: "Konj.", pron: "Pron.", interj: "Interj.", expr: "Redew." },
        demo: { words: [
          { key: "hello", term: "hallo", pos: "interj", ex: "Hallo, wie geht's?", tags: ["Begrüßung"] },
          { key: "thanks", term: "danke", pos: "interj", ex: "Vielen Dank!", tags: ["Begrüßung"] },
          { key: "fly", term: "fliegen", pos: "v", ex: "Der Vogel fliegt über das Haus.", tags: ["Verben"] },
          { key: "eat", term: "essen", pos: "v", ex: "Ich esse einen Apfel.", tags: ["Verben"] },
          { key: "drink", term: "trinken", pos: "v", ex: "Sie trinkt morgens einen Kaffee.", tags: ["Verben"] },
          { key: "water", term: "das Wasser", pos: "n", ex: "Ein Glas Wasser, bitte.", tags: ["Nomen"] },
          { key: "house", term: "das Haus", pos: "n", ex: "Ich gehe nach Hause.", tags: ["Nomen"] },
          { key: "cat", term: "die Katze", pos: "n", ex: "Die Katze schläft auf dem Sofa.", tags: ["Nomen", "Tiere"] },
          { key: "school", term: "die Schule", pos: "n", ex: "Die Kinder gehen zur Schule.", tags: ["Nomen"] },
          { key: "beautiful", term: "schön", pos: "adj", ex: "Was für ein schöner Tag!", tags: ["Adjektive"] }
        ] } },
  pt: { code: "pt", names: { fr: "Portugais", ko: "포르투갈어", en: "Portuguese" }, tts: "pt-PT",
        normalize: { case: true, accents: true, spaces: false }, gender: true,
        pos: { nm: "s.m.", nf: "s.f.", nmf: "s.2g.", nmpl: "s.m.pl.", nfpl: "s.f.pl.", n: "s.", v: "v.", vpr: "v. pron.",
               adj: "adj.", adv: "adv.", prep: "prep.", conj: "conj.", pron: "pron.", interj: "interj.", expr: "loc." },
        demo: { words: [
          { key: "hello", term: "olá", pos: "interj", ex: "Olá, tudo bem?", tags: ["saudações"] },
          { key: "thanks", term: "obrigado / obrigada", pos: "interj", ex: "Muito obrigado!", tags: ["saudações"] },
          { key: "fly", term: "voar", pos: "v", ex: "O pássaro voa sobre a casa.", tags: ["verbos"] },
          { key: "eat", term: "comer", pos: "v", ex: "Eu como uma maçã.", tags: ["verbos"] },
          { key: "drink", term: "beber", pos: "v", ex: "Ela bebe café de manhã.", tags: ["verbos"] },
          { key: "water", term: "a água", pos: "nf", ex: "Um copo de água, por favor.", tags: ["substantivos"] },
          { key: "house", term: "a casa", pos: "nf", ex: "Vou para casa.", tags: ["substantivos"] },
          { key: "cat", term: "o gato", pos: "nm", ex: "O gato dorme no sofá.", tags: ["substantivos", "animais"] },
          { key: "school", term: "a escola", pos: "nf", ex: "As crianças vão à escola.", tags: ["substantivos"] },
          { key: "beautiful", term: "bonito / bonita", pos: "adj", ex: "Que dia bonito!", tags: ["adjetivos"] }
        ] } },
  ja: { code: "ja", names: { fr: "Japonais", ko: "일본어", en: "Japanese" }, tts: "ja-JP",
        normalize: { case: true, accents: false, spaces: true }, gender: false,
        pos: { nm: "名", nf: "名", nmf: "名", nmpl: "名", nfpl: "名", n: "名", v: "動", vpr: "動",
               adj: "形", adv: "副", prep: "助", conj: "接", pron: "代", interj: "感", expr: "句" },
        demo: { words: [
          { key: "hello", term: "こんにちは", pos: "interj", ex: "こんにちは、お元気ですか。", tags: ["あいさつ"] },
          { key: "thanks", term: "ありがとう", pos: "interj", ex: "どうもありがとう。", tags: ["あいさつ"] },
          { key: "fly", term: "飛ぶ", pos: "v", ex: "鳥が家の上を飛びます。", tags: ["動詞"] },
          { key: "eat", term: "食べる", pos: "v", ex: "りんごを食べます。", tags: ["動詞"] },
          { key: "drink", term: "飲む", pos: "v", ex: "朝、コーヒーを飲みます。", tags: ["動詞"] },
          { key: "water", term: "水", pos: "n", ex: "水を一杯ください。", tags: ["名詞"] },
          { key: "house", term: "家", pos: "n", ex: "家に帰ります。", tags: ["名詞"] },
          { key: "cat", term: "猫", pos: "n", ex: "猫がソファで寝ています。", tags: ["名詞", "動物"] },
          { key: "school", term: "学校", pos: "n", ex: "子どもたちは学校に行きます。", tags: ["名詞"] },
          { key: "beautiful", term: "美しい", pos: "adj", ex: "本当に美しい日ですね。", tags: ["形容詞"] }
        ] } },
  zh: { code: "zh", names: { fr: "Chinois", ko: "중국어", en: "Chinese" }, tts: "zh-CN",
        normalize: { case: true, accents: false, spaces: true }, gender: false,
        pos: { nm: "名", nf: "名", nmf: "名", nmpl: "名", nfpl: "名", n: "名", v: "动", vpr: "动",
               adj: "形", adv: "副", prep: "介", conj: "连", pron: "代", interj: "叹", expr: "短语" },
        demo: { words: [
          { key: "hello", term: "你好", pos: "interj", ex: "你好，最近怎么样？", tags: ["问候"] },
          { key: "thanks", term: "谢谢", pos: "interj", ex: "非常感谢！", tags: ["问候"] },
          { key: "fly", term: "飞", pos: "v", ex: "鸟在房子上面飞。", tags: ["动词"] },
          { key: "eat", term: "吃", pos: "v", ex: "我吃一个苹果。", tags: ["动词"] },
          { key: "drink", term: "喝", pos: "v", ex: "她早上喝咖啡。", tags: ["动词"] },
          { key: "water", term: "水", pos: "n", ex: "请给我一杯水。", tags: ["名词"] },
          { key: "house", term: "家", pos: "n", ex: "我回家了。", tags: ["名词"] },
          { key: "cat", term: "猫", pos: "n", ex: "猫在沙发上睡觉。", tags: ["名词", "动物"] },
          { key: "school", term: "学校", pos: "n", ex: "孩子们去学校。", tags: ["名词"] },
          { key: "beautiful", term: "美丽", pos: "adj", ex: "多么美丽的一天！", tags: ["形容词"] }
        ] } }
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
// --- Profil de langues (étape 35, remplace la règle automatique de l'étape 31) ---
// settings.learning = [{ lang, support|null }] : langues apprises, chacune avec une langue d'appui FACULTATIVE.
// Langues affichées pour une carte : la langue apprise (en grand), puis la langue de l'interface, puis la langue d'appui
// de cette langue apprise si elle existe et est différente. Aucune autre langue n'apparaît (gardées dans les données, cachées).
// Héritage : profil → dossier → liste (langue apprise : target ; une liste peut remplacer la langue d'appui : support =
// code de langue, ou null = aucune ; absent = celle du profil). Les anciens tableaux support (étapes 1 à 34) sont gardés
// dans legacySupport, ignorés.
function hasGrammar(code) { return !!(LANGUAGES[code] && LANGUAGES[code].grammar && arr(LANGUAGES[code].grammar.tenses).length); }
function uiLangNow() {
  let u = "";
  try { u = (state && state.settings && state.settings.uiLang) || ""; } catch (e) {}   // state pas encore créé au chargement
  if (!isLang(u)) { try { u = defaultLang(); } catch (e) { u = ""; } }                  // langue de l'appareil (écran de connexion)
  return isLang(u) ? u : "en";
}
// Profil propre : langues connues, sans doublon, appui différent de la langue apprise (sinon null).
function normLearning(raw) {
  const out = [];
  arr(raw).forEach(x => {
    const lang = x && typeof x === "object" ? x.lang : x;
    if (!isLang(lang) || out.some(y => y.lang === lang)) return;
    const sp = x && typeof x === "object" && isLang(x.support) && x.support !== lang ? x.support : null;
    out.push({ lang, support: sp });
  });
  return out;
}
// Appui équivalent à l'ancienne règle de l'étape 31 (migration 4 → 5) : anglais si on n'apprend pas l'anglais et que
// l'interface n'est pas en anglais, sinon aucun. Interface = langue apprise : la langue qui était affichée (anglais, ou français).
function legacySupportFor(lang, ui) {
  if (ui === lang) return lang !== "en" ? "en" : (LANG_CODES.find(c => c !== lang) || null);
  return lang !== "en" && ui !== "en" ? "en" : null;
}
function settingsNow(settings) { if (settings) return settings; try { return (state && state.settings) || {}; } catch (e) { return {}; } }
function learningOf(settings) { return normLearning(settingsNow(settings).learning); }
// Langue apprise par défaut du compte (listes sans langue) : 1re langue du profil.
function accountTarget(settings) {
  const s = settingsNow(settings), L = learningOf(s);
  if (L.length) return L[0].lang;
  return isLang(s.defaultTarget) ? s.defaultTarget : (isLang(LANG_DEFAULT) ? LANG_DEFAULT : LANG_CODES[0]);
}
// Langue d'appui du profil pour une langue apprise (null si aucune ou si la langue n'est pas dans le profil).
function profileSupport(target, settings) { const x = learningOf(settings).find(y => y.lang === target); return x ? x.support : null; }
// Langues de l'autre côté de la carte, dans l'ordre : interface, puis appui (si présent et différent).
function supportLangs(target, uiLang, appui) {
  const ui = isLang(uiLang) ? uiLang : uiLangNow();
  const sp = appui === undefined ? profileSupport(target) : appui;
  const out = [];
  if (ui !== target) out.push(ui);
  if (isLang(sp) && sp !== target && sp !== ui) out.push(sp);
  return out;
}
// Langues visibles d'une carte de vocabulaire : langue apprise + langues d'appui (dans l'ordre d'affichage).
function visibleLangs(lg) { return [lg.target].concat(lg.support); }
function cleanSupport(support, target) {
  const out = [];
  arr(support).forEach(c => { if (isLang(c) && c !== target && !out.includes(c)) out.push(c); });
  return out;
}
// Remplacement de l'appui posé sur un niveau : code, null (aucune) ou undefined (pas de remplacement).
function supportOverride(o) { return o && (o.support === null || (typeof o.support === "string" && isLang(o.support))) ? o.support : undefined; }
// Héritage : le dernier niveau qui a une langue apprise l'emporte ; l'appui vient du dernier remplacement, sinon du profil.
// Renvoie { target, support: [langues affichées en plus de la langue apprise], appui: code|null, own: remplacé ou non }.
function resolveLangs(levels, uiLang, settings) {
  let target = accountTarget(settings), ov;
  arr(levels).forEach(o => { if (!o) return; if (isLang(o.target)) target = o.target; const x = supportOverride(o); if (x !== undefined) ov = x; });
  const appui = ov !== undefined ? ov : profileSupport(target, settings);
  return { target, support: supportLangs(target, uiLang || settingsNow(settings).uiLang, appui), appui: isLang(appui) && appui !== target ? appui : null, own: ov !== undefined };
}
// Langues pour une langue apprise donnée (sans liste) : celles du profil.
function langsFor(target) { return resolveLangs([{ target }]); }
// Ajoute une langue apprise au profil de données d'un autre compte (copie par l'admin), sans langue d'appui.
function addLearningTo(data, code) {
  if (!data || !data.settings || !isLang(code)) return;
  if (!Array.isArray(data.settings.learning) || !data.settings.learning.length) return;   // ancien format : déduit à la migration
  const L = normLearning(data.settings.learning);
  if (!L.some(x => x.lang === code)) { L.push({ lang: code, support: null }); data.settings.learning = L; }
}
// === Fonction centrale (ÉTAPE 35) : langues affichées d'une carte, d'une liste (objet ou id) ou d'un dossier. ===
// Utilisée partout : cartes, listes, recherche, révision (4 modes), audio, À valider, complétion, badges, fichiers
// et demandes pour Claude, import, fiche admin. cardLangs / listLangs / folderLangs / accountLangs l'appellent.
function displayLangs(x) {
  if (!x) return resolveLangs([]);
  if (typeof x === "string") { const l = getList(x); return l ? displayLangs(l) : resolveLangs([]); }
  if ("listId" in x) {                                     // carte
    const lg = displayLangs(x.listId);
    if (isVocab(x)) {                                      // carte posée dans une autre langue étudiée (étape 37)
      const L = studyCtxLang(x);
      if (L && L !== lg.target && studyLangs(x.listId).includes(L)) return studyLg(L);
    }
    if (isVocab(x) || !isLang(x.lang) || x.lang === lg.target) return lg;
    return langsFor(x.lang);                               // autre type dans une autre langue que la liste
  }
  if ("folderId" in x) return resolveLangs([x.folderId ? getFolder(x.folderId) : null, x]);   // liste
  return resolveLangs([x]);                                // dossier
}
// === LANGUES ÉTUDIÉES D'UNE LISTE (ÉTAPE 37) ===
// Une liste peut être étudiée dans plusieurs langues : l.targets = [langue principale, autres langues…].
//  - La 1re place suit toujours la langue apprise réglée (target de la liste, du dossier ou du profil) : seules les
//    langues suivantes de l.targets sont lues ici (la 1re case enregistrée sert de repère pour la migration 5 → 6).
//  - Une carte de vocabulaire posée dans une autre langue L : mot de L en grand, langue de l'interface et langue
//    d'appui de L (profil) de l'autre côté, exemple examples[L]. Les autres types gardent leur langue (champ lang).
//  - StudyCtx.cards : idCarte → langue pendant une session de révision (une seule langue par carte) ;
//    une « vue » de statistiques (Leitner.unit) porte sa langue dans unitLang.
const StudyCtx = { cards: new Map() };
function studyCtxLang(c) {
  if (!c) return "";
  if (typeof c.unitLang === "string") return c.unitLang;
  if (!StudyCtx.cards.size) return "";
  try { if (!rv.s || currentScreen !== "review") return ""; } catch (e) { return ""; }   // seulement sur l'écran de révision
  return StudyCtx.cards.get(c.id) || "";
}
// Langues étudiées d'une liste (objet ou id) : [principale, autres…], sans doublon.
function studyLangs(listOrId) {
  const l = typeof listOrId === "string" ? getList(listOrId) : listOrId;
  if (!l) return [];
  const out = [displayLangs(l).target];
  arr(l.targets).slice(1).forEach(x => { if (isLang(x) && !out.includes(x)) out.push(x); });
  return out;
}
function studyExtraLangs(listOrId) { return studyLangs(listOrId).slice(1); }
// Langues affichées pour une langue étudiée en plus : interface + appui du profil pour cette langue.
function studyLg(L) { return Object.assign(langsFor(L), { study: true }); }
// Langue principale d'une carte (sans tenir compte d'une session) : langue de la liste, ou lang des autres types.
function primaryLang(c) {
  if (!c) return accountTarget();
  if (!isVocab(c) && isLang(c.lang)) return c.lang;
  return displayLangs(c.listId).target;
}
// Langues dans lesquelles une carte est étudiée : vocabulaire = langues de sa liste ; autres types = leur langue.
function cardStudyLangs(c) { return isVocab(c) ? studyLangs(c.listId) : [primaryLang(c)]; }
// Langues visibles d'une liste, toutes langues étudiées comprises (« À valider », dictionnaire, fichiers pour Claude).
function studyVisibleLangs(listOrId) {
  const out = [];
  studyLangs(listOrId).forEach((L, i) => {
    const lg = i === 0 ? displayLangs(typeof listOrId === "string" ? getList(listOrId) : listOrId) : studyLg(L);
    visibleLangs(lg).forEach(x => { if (!out.includes(x)) out.push(x); });
  });
  return out;
}
// Champs absolus d'une langue étudiée en plus (complétion, « À valider ») :
//   "exl:<L>" = phrase d'exemple dans L (examples[L].text), "exlt:<L>:<code>" = sa traduction dans code.
function exlField(L) { return "exl:" + L; }
function exltField(L, code) { return "exlt:" + L + ":" + code; }
function isExlField(f) { return typeof f === "string" && /^exl:[a-z]{2,3}$/.test(f) && isLang(f.slice(4)); }
function isExltField(f) { const m = typeof f === "string" && /^exlt:([a-z]{2,3}):([a-z]{2,3})$/.exec(f); return !!m && isLang(m[1]) && isLang(m[2]); }
function exlParts(f) { const p = String(f).split(":"); return { L: p[1], code: p[2] || "" }; }
// Champs à remplir pour les langues étudiées en plus d'une carte de vocabulaire : mot, nature, exemple et ses
// traductions dans chaque langue L, plus les mots des langues affichées de L absentes de la langue principale.
function studyExtraFields(c, only) {
  if (!c || !isVocab(c)) return [];
  const extra = studyExtraLangs(c.listId);
  if (!extra.length) return [];
  const base = visibleLangs(displayLangs(c.listId)), out = [];
  extra.forEach(L => {
    if (only && L !== only) return;
    const lg = studyLg(L);
    out.push(L, posField(L), exlField(L));
    lg.support.forEach(code => {
      out.push(exltField(L, code));
      if (!base.includes(code) && !out.includes(code)) out.push(code, posField(code));
    });
  });
  return out.filter((x, i, a) => a.indexOf(x) === i);
}
// Champs manquants d'une carte dans une langue étudiée L (bilan, badges par langue). fillFields / genderFields :
// js/completion.js (appelés à l'exécution).
function studyGapFields(c, L) {
  if (!c || !isVocab(c)) return [];
  if (L === primaryLang(c)) {
    const lg = displayLangs(c.listId);
    return fillFields(c, lg, true).filter(f => !fieldVal(c, f, lg).trim()).concat(genderFields(c, lg));
  }
  return studyExtraFields(c, L).filter(f => !fieldVal(c, f).trim());
}

function accountLangs() { return resolveLangs([]); }
function folderLangs(folder) { return resolveLangs([folder]); }
function listLangs(listOrId) { return displayLangs(listOrId); }
function cardLangs(c) { return displayLangs(c); }
// Menu de langues (création de compte, profil, liste) : noneLabel = 1re option « aucune » (valeur ""), sinon pas d'option vide ;
// exclude : codes retirés ; only : codes proposés (par défaut toutes les langues de LANGUAGES).
function langSelect(value, noneLabel, onChange, exclude, only) {
  const s = el("select", "input");
  if (noneLabel != null) { const o = el("option", null, noneLabel); o.value = ""; s.appendChild(o); }
  (only || LANG_CODES).filter(c => isLang(c) && !arr(exclude).includes(c)).forEach(c => { const o = el("option", null, langName(c)); o.value = c; s.appendChild(o); });
  s.value = value || "";
  if (s.value !== (value || "") && s.options.length) s.selectedIndex = 0;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

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

// --- Phrases d'exemple (étape 35) ---
// Carte de vocabulaire : examples = { <langue apprise>: { text, tr: { <langue>: traduction } } }, une par langue apprise.
// Ancien champ example : gardé, copie de l'exemple de la langue apprise de la liste (lu si examples est vide).
// Attention : examples d'une fiche de règle (type rule) = liste de phrases, autre chose.
function exMap(c) { return c && isVocab(c) && c.examples && typeof c.examples === "object" && !Array.isArray(c.examples) ? c.examples : null; }
function exEntry(c, lang) {
  const m = exMap(c), e = m && m[lang];
  if (e && typeof e === "object") return { text: String(e.text || ""), tr: (e.tr && typeof e.tr === "object") ? e.tr : {} };
  if ((!m || !Object.keys(m).length) && c && isVocab(c) && c.example) return { text: String(c.example), tr: {} };
  return null;
}
function exText(c, lang) { const e = exEntry(c, lang); return e ? e.text : ""; }
function exTr(c, lang, code) { const e = exEntry(c, lang); return e && typeof e.tr[code] === "string" ? e.tr[code] : ""; }
// Écrit l'exemple (code absent) ou sa traduction dans code, sans modifier les objets d'origine (copies).
function setExPart(c, lang, code, v, mirror) {
  const cur = exEntry(c, lang) || { text: "", tr: {} };
  const e = { text: cur.text, tr: Object.assign({}, cur.tr) };
  v = String(v == null ? "" : v).trim();
  if (code) { if (v) e.tr[code] = v; else delete e.tr[code]; } else e.text = v;
  const m = Object.assign({}, exMap(c) || {});
  if (e.text || Object.keys(e.tr).length) m[lang] = e; else delete m[lang];
  c.examples = m;
  if (!code && mirror) c.example = e.text;
}
// Exemples propres (stockage, import) : { langue: { text, tr: { langue: texte } } }, entrées vides retirées.
function normExamples(o) {
  const out = {};
  if (!o || typeof o !== "object" || Array.isArray(o)) return out;
  Object.keys(o).forEach(k => {
    if (!/^[a-z]{2,3}(-[a-z0-9]+)?$/i.test(k)) return;
    const e = o[k] && typeof o[k] === "object" ? o[k] : { text: o[k] };
    const text = e.text == null ? "" : String(e.text).trim(), tr = normTerms(e.tr);
    if (text || Object.keys(tr).length) out[k] = { text, tr };
  });
  return out;
}
// Champs d'exemple : "example" (exemple dans la langue apprise de la carte) et "extr:<code>" (sa traduction dans code).
function exTrField(code) { return "extr:" + code; }
function isExTrField(f) { return typeof f === "string" && f.startsWith("extr:") && isLang(f.slice(5)); }
// Langue concernée par un champ (traduction, nature, traduction de l'exemple), sinon "".
function fieldCode(f) { return isLang(f) ? f : isPosField(f) ? f.slice(4) : isExTrField(f) ? f.slice(5) : isExlField(f) ? f.slice(4) : isExltField(f) ? exlParts(f).L : ""; }

// Champ générique : code de langue, "example", "extr:<code>", "pos:<code>" (nature grammaticale dans cette langue)
// ou "f:<champ>" (champ d'un autre type de carte : translation, hint, explanation, note, examples ; exemples séparés par « | »).
// lg (facultatif) : langues de la carte déjà calculées.
const TYPED_FILL_FIELDS = ["translation", "hint", "explanation", "note", "examples"];
function typedField(name) { return "f:" + name; }
function isTypedField(f) { return typeof f === "string" && f.startsWith("f:") && TYPED_FILL_FIELDS.includes(f.slice(2)); }
function fieldVal(c, f, lg) {
  if (isExlField(f)) return isVocab(c) ? exText(c, f.slice(4)) : "";
  if (isExltField(f)) { const x = exlParts(f); return isVocab(c) ? exTr(c, x.L, x.code) : ""; }
  if (f === "example") return isVocab(c) ? exText(c, (lg || cardLangs(c)).target) : String(c.example || "");
  if (isExTrField(f)) return isVocab(c) ? exTr(c, (lg || cardLangs(c)).target, f.slice(5)) : "";
  if (isTypedField(f)) { const k = f.slice(2); return k === "examples" ? arr(c.examples).join(" | ") : String(c[k] || ""); }
  if (isPosField(f)) return (c.pos && typeof c.pos[f.slice(4)] === "string") ? c.pos[f.slice(4)] : "";
  return term(c, f);
}
function setFieldVal(c, f, v, lg) {
  if (isExlField(f)) { if (isVocab(c)) setExPart(c, f.slice(4), null, v, f.slice(4) === primaryLang(c)); return; }
  if (isExltField(f)) { const x = exlParts(f); if (isVocab(c)) setExPart(c, x.L, x.code, v); return; }
  if (f === "example") { if (isVocab(c)) setExPart(c, (lg || cardLangs(c)).target, null, v, true); else c.example = v; }
  else if (isExTrField(f)) { if (isVocab(c)) setExPart(c, (lg || cardLangs(c)).target, f.slice(5), v); }
  else if (isTypedField(f)) { const k = f.slice(2); if (k === "examples") c.examples = String(v || "").split("|").map(x => x.trim()).filter(Boolean); else c[k] = v; }
  else if (isPosField(f)) { c.pos = Object.assign({}, c.pos); if (v) c.pos[f.slice(4)] = v; else delete c.pos[f.slice(4)]; }
  else { c.terms[f] = v; }
}
// Nœud « exemple + traductions » d'une carte de vocabulaire (révision, listes) ; null si pas d'exemple.
// Exemple dans la langue apprise, puis ses traductions dans les langues affichées (interface, appui), dans l'ordre.
function exampleNode(c, cls, lg) {
  if (!isVocab(c)) return null;
  lg = lg || cardLangs(c);
  const tx = exText(c, lg.target);
  if (!tx) return null;
  const d = el("div", cls || "sw-ex");
  const m = el("div", "ex-main", tx); m.lang = lg.target; d.appendChild(m);
  lg.support.forEach(code => { const v = exTr(c, lg.target, code); if (v) { const x = el("div", "ex-tr", v); x.lang = code; d.appendChild(x); } });
  return d;
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
