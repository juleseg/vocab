"use strict";

// === I18N : 활용 문제 안내를 더 분명하게 (ÉTAPE 83) — 한국어 (ko) ===
// 활용 카드의 안내 문구 (js/conjugaison.js) : {v} = 동사 (굵게), {p} = 인칭 (굵게), {t} = 시제.
// Fichier à part, chargé après versions-ko.js. type.verb / type.sentence : « À valider » 항목 이름.
Object.assign(I18N.ko, {
  "cjq.q": "{v}을(를) {p}에 맞게 활용하세요",
  "cjq.qForm": "{v}을(를) {p}(으)로 활용하세요",
  "cjq.qIrr": "{v}의 ‘{p}’ 형태를 쓰세요",
  "cjq.tense": " — {t}",
  "cjq.table": "{v}을(를) 모든 인칭에 맞게 활용하세요",
  "cjq.tableForm": "{v}을(를) 각 형태로 활용하세요",
  "cjq.label": "활용 문제 안내",
  "type.verb": "동사",
  "type.sentence": "문장"
});
