"use strict";

// === NOUVEAUTÉS (CHANGELOG, étape 39) ===
// Une entrée par version visible pour les utilisateurs, la plus récente EN PREMIER.
// { version: "<APP_VERSION>", date: "AAAA-MM-JJ", points: { ko: [...], fr: [...], en: [...] } }
// 2 à 5 points courts par version, simples, sans détail technique, dans les 3 langues de l'interface.
// Règle de travail : chaque étape future ajoute son entrée ici (sauf les étapes sans changement visible).
// Les premières entrées regroupent les grandes fonctions livrées avant l'étape 39.
const CHANGELOG = [
  {
    version: "53", date: "2026-11-19",
    points: {
      ko: [
        "친구를 응원하세요: 친구 정보의 ‘💬 응원하기’로 준비된 메시지를 보낼 수 있어요. 친구는 자기 앱 언어로 읽어요.",
        "친구 화면의 ‘친구 소식’: 연속 학습 달성, 새 레벨, 배지, 오늘 목표, 대결 승리… 한 번 눌러 축하하세요.",
        "‘받은 메시지’에서 응원을 읽고 ‘고마워요’로 답할 수 있어요. 응원 받기는 설정 → 친구에서 끌 수 있어요.",
        "설정과 앱 정보의 ‘팀에 문의하기’로 Vocab 팀에 직접 메시지를 보내고 답변을 받아 보세요."
      ],
      fr: [
        "Encourage tes amis : « 💬 Encourager » sur la fiche d'un ami envoie un message tout prêt, qu'il lit dans la langue de son appli.",
        "« Ce que font tes amis » (écran Amis) : palier de série, nouveau niveau, badge, objectif du jour, duel gagné… félicite-les en un toucher.",
        "Lis tes encouragements dans « Messages reçus » et réponds « Merci » en un toucher. Tu peux couper les encouragements (Réglages → Amis).",
        "« Écrire à l'équipe » (Réglages et À propos) : envoie un message à l'équipe Vocab et reçois sa réponse dans l'appli."
      ],
      en: [
        "Cheer your friends on: “💬 Cheer” on a friend's card sends a ready-made message, which they read in their app language.",
        "“What your friends are up to” (Friends screen): streak milestone, new level, badge, daily goal, duel won… congratulate them in one tap.",
        "Read your cheers in “Messages received” and reply “Thanks” in one tap. You can turn cheers off (Settings → Friends).",
        "“Write to the team” (Settings and About): send a message to the Vocab team and get the reply in the app."
      ]
    }
  },
  {
    version: "52", date: "2026-11-18",
    points: {
      ko: [
        "설정과 앱 정보에서 앱 개선 아이디어를 제안할 수 있어요: 새 기능, 문제, 콘텐츠 등.",
        "‘내 아이디어’에서 진행 상황과 팀의 답변을 확인하세요.",
        "채택된 아이디어에는 XP, 스트릭 프리즈, ‘아이디어 채택’ 배지를 받을 수 있어요.",
        "언어 이름이 더 알기 쉬워졌어요: 앱 언어, 학습 언어, 도움 언어(선택). 카드 미리 보기와 '?' 설명도 있어요."
      ],
      fr: [
        "Propose tes idées pour améliorer l'appli (nouvelle fonction, problème, contenu…) depuis les Réglages ou À propos.",
        "Suis-les dans « Mes idées » : leur état et la réponse de l'équipe.",
        "Une idée retenue peut te rapporter des XP, des gels de série et le badge « Idée retenue ».",
        "Noms des langues plus clairs : langue de l'appli, langue apprise, langue d'aide (facultatif), avec un aperçu de carte et une aide « ? »."
      ],
      en: [
        "Suggest ideas to improve the app (new feature, problem, content…) from Settings or About.",
        "Follow them in “My ideas”: their status and the team's reply.",
        "A kept idea can earn you XP, streak freezes and the “Idea kept” badge.",
        "Clearer language names: app language, language you're learning, helper language (optional), with a card preview and a “?” help."
      ]
    }
  },
  {
    version: "51", date: "2026-11-18",
    points: {
      ko: [
        "앱 둘러보기 안내를 새로 고쳤어요: 목록에 학습 언어를 추가하는 방법을 알려 주고, 앱 정보(ⓘ)도 소개해요."
      ],
      fr: [
        "Le tutoriel a été revu : il montre maintenant comment ajouter une langue apprise à une liste, et présente ⓘ À propos."
      ],
      en: [
        "The tutorial has been revised: it now shows how to add a learning language to a list, and introduces ⓘ About."
      ]
    }
  },
  {
    version: "50", date: "2026-11-18",
    points: {
      ko: [
        "이제 데이터가 매주 자동으로 백업돼요. 문제가 생겨도 되살릴 수 있어요."
      ],
      fr: [
        "Tes données sont maintenant sauvegardées automatiquement chaque semaine : en cas de problème, elles peuvent être récupérées."
      ],
      en: [
        "Your data is now backed up automatically every week, so it can be recovered if something goes wrong."
      ]
    }
  },
  {
    version: "49", date: "2026-11-18",
    points: {
      ko: [
        "카드에 이미지를 넣을 수 있어요: 휴대폰 사진이나 위키미디어의 자유 이용 이미지 (저작자와 라이선스 표시).",
        "이미지는 카드, 쓰기, 질문자, 객관식, 60초 레이스 모드에서 보여요. 이미지를 누르면 크게 보여요.",
        "목록마다 이미지를 보여 줄 쪽을 고를 수 있어요: 자동, 질문 쪽, 답 쪽, 안 보기.",
        "위키미디어 이미지를 공용 사전에 제안할 수 있어요. 승인되면 이미지가 없는 이 단어의 카드에 보여요.",
        "본 이미지는 휴대폰에 저장돼서 인터넷 없이도 보여요. 설정에서 사용한 공간을 볼 수 있어요 (최대 50MB)."
      ],
      fr: [
        "Ajoute une image à une carte : une photo de ton téléphone ou une image libre de Wikimedia (auteur et licence affichés).",
        "Les images apparaissent dans les modes Cartes, Écrit, Interrogateur, QCM et Course 60 s. Touche une image pour l'agrandir.",
        "Pour chaque liste, choisis où montrer les images : automatique, côté question, côté réponse ou jamais.",
        "Propose une image Wikimedia au dictionnaire commun : une fois validée, elle apparaît sur les cartes de ce mot qui n'en ont pas.",
        "Les images déjà vues restent sur ton téléphone, même sans Internet. Les Réglages montrent la place utilisée (50 Mo au plus)."
      ],
      en: [
        "Add a picture to a card: a photo from your phone or a free picture from Wikimedia (author and license shown).",
        "Pictures show in Cards, Writing, Quizzer, Multiple choice and 60-second race modes. Tap a picture to enlarge it.",
        "For each list, choose where pictures show: automatic, question side, answer side or never.",
        "Suggest a Wikimedia picture for the shared dictionary: once approved, it shows on cards of this word that have none.",
        "Pictures you've seen stay on your phone, even offline. Settings show the space used (50 MB at most)."
      ]
    }
  },
  {
    version: "48", date: "2026-11-18",
    points: {
      ko: [
        "새 버전이 나오면 앱이 알려 줘요 (알림과 '업데이트' 배너).",
        "'업데이트'를 한 번 누르면 앱이 새 버전을 받아 다시 시작해요.",
        "꼭 필요한 업데이트라면 계속하기 전에 앱이 먼저 물어봐요. 그동안 데이터는 휴대폰에 그대로 있어요."
      ],
      fr: [
        "Quand une nouvelle version sort, l'appli te le dit (notification et bandeau « Mettre à jour »).",
        "Un toucher sur « Mettre à jour » : l'appli télécharge la nouvelle version et redémarre.",
        "Si une mise à jour est nécessaire, l'appli te la demande avant de continuer. Tes données restent sur ton téléphone en attendant."
      ],
      en: [
        "When a new version comes out, the app tells you (notification and \"Update\" banner).",
        "One tap on \"Update\": the app downloads the new version and restarts.",
        "If an update is needed, the app asks for it before you continue. Your data stays on your phone in the meantime."
      ]
    }
  },
  {
    version: "47", date: "2026-11-18",
    points: {
      ko: [
        "앱이 각 단어를 언제 다시 복습할지 더 잘 골라요: 잘 아는 단어는 덜, 어려운 단어는 더 자주 나와요.",
        "버튼은 그대로예요 (알아요 / 다시 보기 / 몰라요). 지금까지의 진도는 그대로 이어져요.",
        "새 화면 '복습 리듬'(설정): 집중 95% · 균형 90% · 가볍게 85% · 최소 80% 또는 직접 설정. 단어가 언제 다시 나오는지, 하루 몇 장을 복습하게 되는지 바로 보여 줘요.",
        "통계에서 예상 기억률을 볼 수 있어요.",
        "목록이나 폴더 메뉴의 '진도 초기화'로 한 언어 또는 모든 언어의 진도를 처음부터 다시 시작할 수 있어요."
      ],
      fr: [
        "L'appli choisit mieux quand revoir chaque mot : les mots bien sus reviennent moins souvent, les mots difficiles plus souvent.",
        "Les boutons ne changent pas (Su / À revoir / Pas su) et ta progression actuelle est gardée.",
        "Nouvel écran « Rythme de révision » (Réglages) : Intensif 95 % · Équilibré 90 % · Léger 85 % · Minimum 80 %, ou ton propre taux. Tu vois tout de suite quand un mot revient et combien de cartes par jour ça fait.",
        "Stats : vois ta rétention estimée.",
        "Nouveau « Réinitialiser la progression » dans le menu d'une liste ou d'un dossier, pour une langue ou toutes."
      ],
      en: [
        "The app better chooses when to review each word: words you know well come back less often, hard words more often.",
        "Buttons do not change (Knew it / To review / Didn't know) and your current progress is kept.",
        "New \"Review pace\" screen (Settings): Intensive 95% · Balanced 90% · Light 85% · Minimum 80%, or your own rate. You see right away when a word comes back and how many cards per day it means.",
        "Stats: see your estimated retention.",
        "New \"Reset progress\" in a list or folder menu, for one language or all of them."
      ]
    }
  },
  {
    version: "46", date: "2026-11-18",
    points: {
      ko: [
        "새 복습 모드 '받아쓰기': 학습 언어로 단어나 예문을 읽어 주면 들은 대로 써요. 다시 듣기와 느린 속도도 있어요.",
        "새 복습 모드 '발음': 번역을 보고 단어나 문장을 소리 내어 말하면 앱이 알아듣고 맞는지 알려 줘요 (3번 시도).",
        "복습 화면의 '모드'에서 고르고, 단어·예문·둘 다 중에서 선택할 수 있어요. 진도, XP, 오늘의 도전에 반영돼요."
      ],
      fr: [
        "Nouveau mode Dictée : l'appli lit le mot ou la phrase d'exemple dans la langue apprise, tu l'écris. Réécoute et vitesse lente possibles.",
        "Nouveau mode Prononciation : tu vois la traduction, tu dis le mot ou la phrase à voix haute, l'appli vérifie (3 essais).",
        "À choisir dans « Mode » de Réviser, avec des mots, des phrases ou les deux. Ils comptent pour la progression, les XP et les défis du jour."
      ],
      en: [
        "New Dictation mode: the app reads the word or example sentence in the language you're learning, and you type it. Listen again or slow it down.",
        "New Pronunciation mode: you see the translation, say the word or sentence out loud, and the app checks it (3 tries).",
        "Pick them in Review → Mode, with words, sentences or both. They count for your progress, XP and daily challenges."
      ]
    }
  },
  {
    version: "45", date: "2026-11-18",
    points: {
      ko: [
        "내 단어로 만든 이야기: 목록을 열고 '이야기 만들기'를 누르면 Claude가 그 목록의 단어로 짧은 이야기를 써 줘요.",
        "언어, 수준(초급·중급·고급), 길이, 단어 5~15개를 고를 수 있어요. 기본으로 복습할 단어가 선택돼요.",
        "표시된 단어를 누르면 번역과 발음을 듣고, 문장마다 듣거나 번역을 볼 수 있어요.",
        "마지막의 질문 3개에 답하고 XP를 받으세요. 이야기는 목록마다 저장되고, 카드는 바뀌지 않아요."
      ],
      fr: [
        "Histoires avec tes mots : ouvre une liste et touche « Créer une histoire », Claude écrit un court texte avec les mots de cette liste.",
        "Choisis la langue, le niveau (débutant, intermédiaire, avancé), la longueur et 5 à 15 mots ; les mots à revoir sont choisis d'office.",
        "Touche un mot surligné pour sa traduction et sa prononciation ; écoute l'histoire phrase par phrase et affiche la traduction quand tu veux.",
        "Réponds aux 3 questions de la fin pour gagner des XP. Les histoires sont gardées dans chaque liste, et tes cartes ne changent pas."
      ],
      en: [
        "Stories with your words: open a list and tap \"Create a story\", Claude writes a short text with the words of that list.",
        "Choose the language, level (beginner, intermediate, advanced), length and 5 to 15 words; words to review are picked for you.",
        "Tap a highlighted word for its translation and pronunciation; listen sentence by sentence and show the translation whenever you like.",
        "Answer the 3 questions at the end to earn XP. Stories are kept in each list, and your cards never change."
      ]
    }
  },
  {
    version: "44", date: "2026-11-18",
    points: {
      ko: [
        "주간 리그: 친구 화면에서 이번 주(월요일~일요일) XP 순위, 시상대, 내 순위를 확인하세요.",
        "월요일과 화요일에는 지난주 결과도 볼 수 있어요.",
        "친구에게 대결 신청! 내 목록의 카드 10장으로 같은 문제를 풀고, 정답 수와 시간으로 승부해요.",
        "대결에서 XP를 얻고 이기면 보너스도 받아요. 버튼 하나로 재대결할 수 있어요.",
        "대결은 카드 학습 진도를 바꾸지 않고, 친구는 내 목록을 볼 수 없어요."
      ],
      fr: [
        "Ligue de la semaine : dans Amis, ton classement XP entre amis du lundi au dimanche, avec podium et ta place.",
        "Le lundi et le mardi, les résultats de la semaine passée restent visibles.",
        "Défie un ami en duel : 10 cartes d'une de tes listes, les mêmes questions pour vous deux, le meilleur score gagne (puis le plus rapide).",
        "Les duels rapportent des XP, avec un bonus de victoire, et la revanche se lance en un toucher.",
        "Les duels ne changent pas la progression de tes cartes, et ton ami ne voit jamais tes listes."
      ],
      en: [
        "Weekly league: in Friends, your XP ranking among friends from Monday to Sunday, with a podium and your place.",
        "On Monday and Tuesday, last week's results stay visible.",
        "Challenge a friend to a duel: 10 cards from one of your lists, the same questions for both of you, best score wins (then fastest).",
        "Duels earn XP, with a victory bonus, and a rematch is just one tap away.",
        "Duels don't change the progress of your cards, and your friend never sees your lists."
      ]
    }
  },
  {
    version: "43", date: "2026-11-18",
    points: {
      ko: [
        "이제 답할 때마다 XP를 얻어요. 쓰기와 활용표 모드는 XP가 더 많아요.",
        "XP가 쌓이면 레벨이 올라가요. 홈 화면과 통계에서 진행 막대를 확인하세요.",
        "매일 오늘의 도전 3개! 모두 완료하면 보너스 XP를 받아요.",
        "새 배지: 첫 만점, 카드 100 / 1000 / 5000장, 도전 7일, 60초 레이스 첫 기록, 레벨 배지.",
        "친구가 내 레벨과 이번 주 XP를 볼 수 있어요. 설정 > 친구에서 숨길 수 있어요."
      ],
      fr: [
        "Tu gagnes maintenant des XP à chaque réponse, et plus en mode Écrit et Tableau.",
        "Les XP font monter ton niveau : barre de progression à l'Accueil et dans Stats.",
        "Chaque jour, 3 défis du jour à l'Accueil, avec un bonus si tu les fais tous.",
        "Nouveaux badges : premier sans-faute, 100 / 1000 / 5000 cartes, 7 jours de défis, premier record à la Course 60 s, niveaux.",
        "Tes amis voient ton niveau et tes XP de la semaine ; tu peux les cacher dans Réglages > Amis."
      ],
      en: [
        "You now earn XP for every answer, and more in Write and Table modes.",
        "XP raises your level: see the progress bar on Home and in Stats.",
        "Every day, 3 daily challenges on Home, with a bonus when you complete all of them.",
        "New badges: first perfect round, 100 / 1000 / 5000 cards, 7 days of challenges, first 60-second race record, levels.",
        "Friends can see your level and weekly XP; you can hide them in Settings > Friends."
      ]
    }
  },
  {
    version: "42", date: "2026-11-17",
    points: {
      ko: [
        "새 연습 게임 4가지: 객관식, 60초 레이스, 짝 맞추기, 순서 맞추기.",
        "복습 화면의 '연습 게임'에서 고르면 돼요. 범위는 평소처럼 목록, 폴더, 언어로 정해요.",
        "게임도 오늘의 목표와 연속 기록에 들어가요. 틀린 카드는 카드 모드로 다시 볼 수 있어요.",
        "60초 레이스에서 내 최고 기록에 도전해 보세요. 게임 소리는 설정에서 켤 수 있어요."
      ],
      fr: [
        "4 nouveaux jeux d'entraînement : QCM, Course 60 s, Paires et Remettre en ordre.",
        "Choisis-les dans Réviser, rubrique « Jeux d'entraînement », sur tes listes, dossiers et langues habituels.",
        "Les jeux comptent pour l'objectif du jour et la série ; les erreurs peuvent être revues en mode Cartes.",
        "Bats ton record à la Course 60 s. Les sons des jeux s'activent dans les Réglages."
      ],
      en: [
        "4 new practice games: Multiple choice, 60-second race, Pairs and Put in order.",
        "Pick them in Review, under \"Practice games\", with your usual lists, folders and languages.",
        "Games count toward your daily goal and streak; you can review your mistakes in Cards mode.",
        "Beat your best score in the 60-second race. Turn on game sounds in Settings."
      ]
    }
  },
  {
    version: "41", date: "2026-11-17",
    points: {
      ko: [
        "앱에 문제가 생기면 자동으로 알려 줘서 더 빨리 고칠 수 있어요.",
        "개인 정보와 카드 내용은 절대 보내지 않아요.",
        "인터넷이 끊겨도 기다렸다가 다시 연결되면 보내요. 앱은 느려지지 않아요."
      ],
      fr: [
        "Quand un problème survient, l'appli le signale toute seule pour qu'il soit corrigé plus vite.",
        "Rien de personnel n'est envoyé : ni tes cartes, ni tes données.",
        "Hors connexion, le signalement attend le retour du réseau, sans ralentir l'appli."
      ],
      en: [
        "When something goes wrong, the app now reports it by itself so it can be fixed faster.",
        "Nothing personal is sent: not your cards, not your data.",
        "Offline, the report waits until you're back online, without slowing the app down."
      ]
    }
  },
  {
    version: "40", date: "2026-11-17",
    points: {
      ko: [
        "새 사용법 안내: 앱의 실제 화면을 따라가며 주요 기능을 10단계로 보여 줘요.",
        "일부 단계에서는 '직접 해 보기'로 바로 연습할 수 있어요 (예: 카드 추가).",
        "설정이나 앱 정보에서 언제든지 안내를 다시 볼 수 있어요."
      ],
      fr: [
        "Nouveau tutoriel guidé : une visite des vrais écrans de l'appli en une dizaine d'étapes.",
        "Certaines étapes proposent « Essayer » pour s'exercer tout de suite (ex. ajouter une carte).",
        "À revoir quand tu veux depuis Réglages ou À propos."
      ],
      en: [
        "New guided tutorial: a tour of the app's real screens in about ten steps.",
        "Some steps offer \"Try it\" so you can practice right away (e.g. adding a card).",
        "Replay it any time from Settings or About."
      ]
    }
  },
  {
    version: "39", date: "2026-11-17",
    points: {
      ko: [
        "새 화면 '앱 정보': 버전, 새로운 기능, 앱 공유를 한곳에서 볼 수 있어요.",
        "'공유' 버튼으로 카카오톡, 문자 등으로 친구에게 앱을 보낼 수 있어요.",
        "옆에 있는 사람에게는 QR 코드를 보여 주세요. 휴대폰 카메라로 바로 열려요.",
        "새 버전이 나오면 바뀐 점을 한 번 알려 드려요."
      ],
      fr: [
        "Nouvel écran « À propos » : version, nouveautés et partage de l'appli au même endroit.",
        "Bouton « Partager » pour envoyer l'appli à un ami (WhatsApp, SMS, KakaoTalk…).",
        "Un QR code à montrer à quelqu'un à côté : il s'ouvre avec l'appareil photo du téléphone.",
        "À chaque nouvelle version, une fenêtre présente les nouveautés une fois."
      ],
      en: [
        "New \"About\" screen: version, what's new and app sharing in one place.",
        "\"Share\" button to send the app to a friend (WhatsApp, SMS, KakaoTalk…).",
        "A QR code to show someone next to you: it opens with the phone camera.",
        "Each new version shows what's new once, in a small window."
      ]
    }
  },
  {
    version: "38", date: "2026-11-17",
    points: {
      ko: [
        "처음 열 때 알림을 켤지 물어보는 창이 나와요. 버튼 하나로 켤 수 있어요.",
        "아이폰에서는 먼저 앱을 홈 화면에 추가하는 방법을 알려 드려요.",
        "'나중에'를 누르면 7일 동안 다시 묻지 않아요."
      ],
      fr: [
        "À la première ouverture, une fenêtre propose d'activer les notifications en un bouton.",
        "Sur iPhone, elle explique d'abord comment installer l'appli sur l'écran d'accueil.",
        "« Plus tard » : la question ne revient pas avant 7 jours."
      ],
      en: [
        "On first launch, a window offers to turn on notifications with one button.",
        "On iPhone, it first explains how to add the app to the home screen.",
        "\"Later\": you won't be asked again for 7 days."
      ]
    }
  },
  {
    version: "37", date: "2026-11-17",
    points: {
      ko: [
        "같은 목록을 다른 언어로도 공부할 수 있어요 (예: 한국어 다음에 이탈리아어).",
        "언어마다 진도가 따로 저장돼요.",
        "복습할 때 학습 언어를 고를 수 있어요."
      ],
      fr: [
        "Une même liste peut avoir une autre langue apprise (ex. coréen, puis italien).",
        "La progression est gardée séparément pour chaque langue.",
        "Au moment de réviser, on choisit la ou les langues."
      ],
      en: [
        "The same list can also be learned in another language (e.g. Korean, then Italian).",
        "Progress is kept separately for each language.",
        "When reviewing, you choose the language(s)."
      ]
    }
  },
  {
    version: "36", date: "2026-11-17",
    points: {
      ko: [
        "공용 사전: 한 사람이 채운 번역과 예문을 모두가 함께 써요.",
        "새 카드를 만들면 빈칸이 바로 채워지는 경우가 많아요.",
        "목록과 진도는 계속 나만 볼 수 있어요."
      ],
      fr: [
        "Dictionnaire commun : les traductions et exemples remplis une fois servent à tout le monde.",
        "En créant une carte, les cases vides se remplissent souvent toutes seules.",
        "Vos listes et votre progression restent privées."
      ],
      en: [
        "Shared dictionary: translations and examples filled in once help everyone.",
        "When you create a card, empty fields often fill in by themselves.",
        "Your lists and progress stay private."
      ]
    }
  },
  {
    version: "35", date: "2026-11-17",
    points: {
      ko: [
        "여러 언어를 동시에 배울 수 있어요 (한국어, 프랑스어, 영어, 이탈리아어, 스페인어, 독일어, 포르투갈어, 일본어, 중국어).",
        "학습 언어마다 도움 언어를 하나 고를 수 있어요 (선택).",
        "예문은 학습 언어로, 번역과 함께 보여요."
      ],
      fr: [
        "Apprenez plusieurs langues à la fois (9 langues : coréen, français, anglais, italien, espagnol, allemand, portugais, japonais, chinois).",
        "Pour chaque langue apprise, une langue d'aide au choix (facultatif).",
        "Les phrases d'exemple sont dans la langue apprise, avec leur traduction."
      ],
      en: [
        "Learn several languages at once (9 languages: Korean, French, English, Italian, Spanish, German, Portuguese, Japanese, Chinese).",
        "For each language you're learning, an optional helper language.",
        "Example sentences are in the language you're learning, with their translation."
      ]
    }
  },
  {
    version: "34", date: "2026-11-17",
    points: {
      ko: [
        "알림: 오늘의 목표 알림, 연속 기록이 끊길 위기 알림, 친구 소식.",
        "알림 종류를 하나씩 켜고 끌 수 있어요.",
        "조용한 시간(기본 22시~8시)에는 알림이 오지 않아요."
      ],
      fr: [
        "Notifications : rappel de l'objectif du jour, série en danger, nouvelles des amis.",
        "Chaque catégorie de notification s'active ou se coupe séparément.",
        "Heures calmes (22 h → 8 h par défaut) : aucune notification."
      ],
      en: [
        "Notifications: daily goal reminder, streak in danger, news from friends.",
        "Each notification category can be turned on or off.",
        "Quiet hours (10 pm → 8 am by default): no notifications."
      ]
    }
  },
  {
    version: "30", date: "2026-11-16",
    points: {
      ko: [
        "친구: 아이디로 친구를 추가하고 연속 기록과 이번 주 복습을 볼 수 있어요.",
        "친구들과 이번 주 순위를 비교해요.",
        "목록이나 폴더를 친구와 공유해요: 복사본 보내기 또는 함께 쓰는 목록.",
        "보여 줄 정보는 설정에서 직접 골라요."
      ],
      fr: [
        "Amis : ajoutez un ami par son identifiant, voyez sa série et ses révisions de la semaine.",
        "Classement de la semaine entre amis.",
        "Partagez une liste ou un dossier : copie envoyée ou liste commune.",
        "Vous choisissez ce que vos amis voient (Réglages)."
      ],
      en: [
        "Friends: add a friend by username, see their streak and weekly reviews.",
        "Weekly ranking between friends.",
        "Share a list or folder: send a copy or use a shared list.",
        "You choose what your friends can see (Settings)."
      ]
    }
  },
  {
    version: "28", date: "2026-11-16",
    points: {
      ko: [
        "연속 기록: 하루 목표를 채우면 불꽃이 커져요.",
        "하루 목표는 설정에서 바꿀 수 있어요 (5~100장).",
        "7일 연속이면 보호권을 받아요. 하루를 놓쳐도 기록을 지켜 줘요.",
        "7, 30, 100, 365일 배지."
      ],
      fr: [
        "Séries : chaque jour où l'objectif est atteint fait grandir la flamme.",
        "Objectif du jour réglable (5 à 100 cartes).",
        "Un gel gagné tous les 7 jours : il sauve la série un jour manqué.",
        "Badges à 7, 30, 100 et 365 jours."
      ],
      en: [
        "Streaks: each day you reach your goal makes the flame grow.",
        "Adjustable daily goal (5 to 100 cards).",
        "Earn a freeze every 7 days: it saves your streak on a missed day.",
        "Badges at 7, 30, 100 and 365 days."
      ]
    }
  },
  {
    version: "22", date: "2026-11-16",
    points: {
      ko: [
        "Claude가 빈칸(번역, 품사, 예문)을 채워 줘요: 복사-붙여넣기, 파일, 또는 '요청 보내기'.",
        "모든 제안은 '검토'에서 먼저 확인한 뒤에 적용돼요.",
        "한 번에 많이 선택하고 수락하거나 거절할 수 있어요.",
        "중간에 멈춰도 이어서 할 수 있어요."
      ],
      fr: [
        "Claude complète les cases vides (traductions, nature, exemples) : copier-coller, fichier ou « Demander à Claude ».",
        "Tout passe d'abord par « À valider » : rien ne change sans votre accord.",
        "Sélection et validation en masse, même sur des milliers de propositions.",
        "Un traitement interrompu reprend là où il s'était arrêté."
      ],
      en: [
        "Claude fills in empty fields (translations, part of speech, examples): copy-paste, file or \"Ask Claude\".",
        "Everything goes through \"To review\" first: nothing changes without your approval.",
        "Select and approve in bulk, even thousands of suggestions.",
        "An interrupted task resumes where it stopped."
      ]
    }
  },
  {
    version: "16", date: "2026-11-15",
    points: {
      ko: [
        "새 카드 종류: 동사 활용, 빈칸 채우기, 틀린 곳 고치기, 문법 규칙.",
        "'표' 모드: 한 동사의 모든 활용을 한 번에 연습해요.",
        "Claude로 문법·활용 카드를 만들 수 있어요."
      ],
      fr: [
        "Nouveaux types de cartes : conjugaison, texte à trous, corriger l'erreur, fiche de règle.",
        "Mode Tableau : toutes les personnes d'un verbe d'un coup.",
        "Générer des cartes de grammaire et de conjugaison avec Claude."
      ],
      en: [
        "New card types: conjugation, fill in the blank, fix the mistake, rule card.",
        "Table mode: practise every person of a verb at once.",
        "Generate grammar and conjugation cards with Claude."
      ]
    }
  },
  {
    version: "12", date: "2026-11-15",
    points: {
      ko: [
        "아이디와 PIN으로 로그인하고, 모든 기기에서 같은 데이터를 써요.",
        "폴더와 목록, 대량 가져오기.",
        "라이트너 상자로 복습: 아는 카드는 점점 덜 나와요.",
        "복습 모드: 카드, 쓰기, 질문자. 발음 듣기도 돼요."
      ],
      fr: [
        "Connexion par identifiant et code PIN, mêmes données sur tous vos appareils.",
        "Dossiers et listes, import en masse.",
        "Révision par boîtes (Leitner) : les cartes sues reviennent de moins en moins souvent.",
        "Modes Cartes, Écrit, Interrogateur et lecture à voix haute."
      ],
      en: [
        "Sign in with a username and PIN, same data on all your devices.",
        "Folders and lists, bulk import.",
        "Box-based review (Leitner): cards you know come back less and less often.",
        "Cards, Written and Quiz-master modes, plus read-aloud."
      ]
    }
  }
];
App.CHANGELOG = CHANGELOG;
