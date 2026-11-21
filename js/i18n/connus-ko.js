"use strict";

// === I18N : GÉNÉRER SANS DOUBLONS (ÉTAPE 76) — CORÉEN (ko) ===
// Champ « Mots » de « Générer des cartes », bilan des mots déjà connus (js/generer-connus.js, clés gnd.*).
// Fichier à part, chargé après simplif-ko.js.

Object.assign(I18N.ko, {
  "gnd.words": "단어 (선택)",
  "gnd.wordsPh": "한 줄에 단어 하나 (또는 쉼표로 구분)",
  "gnd.wordsHint": "이미 가진 단어(내 목록이나 공용 사전)는 바로 복사돼요. 나머지만 Claude에게 보내요. 단어 목록이 있으면 카드 수는 쓰지 않아요.",
  "gnd.tooMany": "한 번에 단어는 최대 {n}개예요.",
  "gnd.searching": "이미 가진 단어를 찾는 중…",
  "gnd.title": "이미 아는 단어",
  "gnd.known": "이미 아는 단어 {n}개 (복사됨)",
  "gnd.known1": "이미 아는 단어 1개 (복사됨)",
  "gnd.send": "Claude에게 {n}개 보냄",
  "gnd.send1": "Claude에게 1개 보냄",
  "gnd.send0": "Claude에게 보낼 단어 없음",
  "gnd.inList": "이 목록에 이미 있는 단어 {n}개",
  "gnd.inList1": "이 목록에 이미 있는 단어 1개",
  "gnd.fromList": "'{l}'에서 복사",
  "gnd.fromDict": "공용 사전에서 복사",
  "gnd.toClaude": "Claude에게 보내는 단어:",
  "gnd.noDict": "오프라인이라 공용 사전은 찾아보지 않았어요.",
  "gnd.goBoth": "복사하고 보내기",
  "gnd.goSend": "보내기",
  "gnd.goCopy": "복사",
  "gnd.done": "카드 {n}장을 '{l}'에 복사했어요.",
  "gnd.done1": "카드 1장을 '{l}'에 복사했어요.",
  "gnd.nothing": "이 단어들은 모두 이 목록에 이미 있어요. 할 일이 없어요.",
  "gnd.seeList": "목록 보기"
});
