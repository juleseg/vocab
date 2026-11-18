"use strict";

// === NOUVEAUTÉS (CHANGELOG, étape 39) ===
// Une entrée par version visible pour les utilisateurs, la plus récente EN PREMIER.
// { version: "<APP_VERSION>", date: "AAAA-MM-JJ", points: { ko: [...], fr: [...], en: [...] } }
// 2 à 5 points courts par version, simples, sans détail technique, dans les 3 langues de l'interface.
// Règle de travail : chaque étape future ajoute son entrée ici (sauf les étapes sans changement visible).
// Les premières entrées regroupent les grandes fonctions livrées avant l'étape 39.
const CHANGELOG = [
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
        "복습할 때 공부할 언어를 고를 수 있어요."
      ],
      fr: [
        "Une même liste peut s'étudier dans une autre langue (ex. coréen, puis italien).",
        "La progression est gardée séparément pour chaque langue.",
        "Au moment de réviser, on choisit la ou les langues."
      ],
      en: [
        "The same list can be studied in another language (e.g. Korean, then Italian).",
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
        "배우는 언어마다 도움 언어를 하나 고를 수 있어요 (선택).",
        "예문은 배우는 언어로, 번역과 함께 보여요."
      ],
      fr: [
        "Apprenez plusieurs langues à la fois (9 langues : coréen, français, anglais, italien, espagnol, allemand, portugais, japonais, chinois).",
        "Pour chaque langue apprise, une langue d'appui au choix (facultative).",
        "Les phrases d'exemple sont dans la langue apprise, avec leur traduction."
      ],
      en: [
        "Learn several languages at once (9 languages: Korean, French, English, Italian, Spanish, German, Portuguese, Japanese, Chinese).",
        "For each language you learn, an optional helper language.",
        "Example sentences are in the language you learn, with their translation."
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
