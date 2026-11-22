"use strict";

// === I18N : CONNEXION HORS LIGNE FIABLE (ÉTAPE 86) — CORÉEN (ko) ===
// Clés cxl.* (js/connexion-locale.js) : phrase de l'écran de connexion hors ligne, messages du PIN vérifié sur l'appareil
// (compte inconnu ici, PIN faux, attente), retour d'Internet, session refusée par le serveur, fenêtre « PIN changé ».
// Fichier à part, chargé après sigclaude-ko.js.
Object.assign(I18N.ko, {
  "cxl.offHint": "오프라인이에요. 이 기기에서 로그인한 적이 있는 계정은 PIN으로 열 수 있어요.",
  "cxl.err.unknown": "오프라인이에요. '{id}' 계정은 이 기기에서 인터넷 없이 열 수 없어요. 먼저 온라인에서 PIN으로 한 번 로그인해 주세요.",
  "cxl.err.wrong": "PIN이 틀렸어요. 기다리기 전까지 남은 횟수: {n}번.",
  "cxl.err.wait": "오프라인에서 PIN을 너무 많이 틀렸어요. {min}분 뒤에 다시 시도하거나 인터넷에 연결해 주세요.",
  "cxl.opened": "오프라인으로 열었어요. 인터넷이 돌아오면 동기화가 다시 시작돼요.",
  "cxl.back": "연결이 돌아왔어요. 계정이 다시 연결됐어요.",
  "cxl.refused": "서버에서 세션이 종료됐어요(PIN 변경 또는 계정 변경). PIN으로 다시 로그인해 주세요. 데이터는 이 기기에 남아 있어요.",
  "cxl.pin.title": "PIN이 바뀌었어요",
  "cxl.pin.text": "'{id}'의 PIN이 다른 곳에서 바뀌었어요. 동기화를 다시 시작하려면 새 PIN을 입력해 주세요. 오프라인에서 한 내용은 이 기기에 남아 있어요.",
  "cxl.pin.label": "새 PIN",
  "cxl.pin.ok": "확인",
  "cxl.pin.wrong": "PIN이 틀렸어요.",
  "cxl.pin.net": "지금은 연결할 수 없어요. 잠시 후 다시 시도해 주세요."
});
