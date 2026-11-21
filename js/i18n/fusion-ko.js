"use strict";

// === I18N : FUSION DES APPAREILS (ÉTAPE 78) — 한국어 (ko) ===
// Message après une fusion, liste des cartes modifiées des deux côtés, « Reprendre l'autre version », écran « Fusions récentes »
// (js/fusion.js, clés fu.*) ; al.k.merge (journal) ; save.migratedV9 (conversion 8 → 9). Fichier à part, chargé après garde-ko.js.

Object.assign(I18N.ko, {
  "fu.done": "기기들을 하나로 합쳤어요. 지워진 것은 없어요.",
  "fu.title": "기기 합치기 완료",
  "fu.text1": "카드 1장이 두 기기에서 수정됐어요. 최신 버전을 남겼어요.",
  "fu.text": "카드 {n}장이 두 기기에서 수정됐어요. 최신 버전을 남겼어요.",
  "fu.textL1": "목록 1개가 두 기기에서 수정됐어요. 최신 버전을 남겼어요.",
  "fu.textL": "목록 {n}개가 두 기기에서 수정됐어요. 최신 버전을 남겼어요.",
  "fu.hint": "다른 버전은 이 기기에 보관돼요. 여기서 되돌리거나, 나중에 설정 → 계정과 데이터 → 최근 합치기에서 되돌릴 수 있어요.",
  "fu.more": "… 외 {n}개도 보관돼 있어요.",
  "fu.take": "다른 버전으로 바꾸기",
  "fu.back": "이전 버전으로 돌아가기",
  "fu.taken": "버전을 바꿨어요.",
  "fu.takeErr": "이 버전으로 바꿀 수 없어요.",
  "fu.listBtn": "최근 합치기",
  "fu.listTitle": "이 기기의 최근 합치기",
  "fu.listHint": "같은 카드가 두 기기에서 수정되면, 남기지 않은 버전을 여기에 보관해요 (최근 {n}번).",
  "fu.none": "두 기기에서 수정된 카드가 아직 없어요.",
  "fu.count": "확인할 것 {n}개",
  "fu.why.c.both.local": "이 기기와 다른 기기에서 수정됐어요. 남긴 것: 이 기기의 버전.",
  "fu.why.c.both.remote": "이 기기와 다른 기기에서 수정됐어요. 남긴 것: 다른 기기의 버전.",
  "fu.why.c.delThere.local": "다른 기기에서 삭제된 뒤 여기서 수정됐어요. 카드를 남겼어요.",
  "fu.why.c.delThere.remote": "여기서 수정된 뒤 다른 기기에서 삭제됐어요. 카드를 삭제했어요.",
  "fu.why.c.delHere.remote": "여기서 삭제된 뒤 다른 기기에서 수정됐어요. 카드를 남겼어요.",
  "fu.why.c.delHere.local": "다른 기기에서 수정된 뒤 여기서 삭제됐어요. 카드를 삭제했어요.",
  "fu.why.c.listGone.remote": "이 카드를 추가한 뒤에 목록이 삭제됐어요. 카드를 삭제했어요.",
  "fu.why.c.listGone.local": "카드를 목록과 함께 되돌렸어요.",
  "fu.why.l.both.local": "목록이 이 기기와 다른 기기에서 수정됐어요. 남긴 것: 이 기기의 버전.",
  "fu.why.l.both.remote": "목록이 이 기기와 다른 기기에서 수정됐어요. 남긴 것: 다른 기기의 버전.",
  "fu.why.l.delThere.local": "목록이 다른 기기에서 삭제된 뒤 여기서 수정됐어요. 목록을 남겼어요.",
  "fu.why.l.delThere.remote": "목록이 여기서 수정된 뒤 다른 기기에서 삭제됐어요. 목록을 삭제했어요.",
  "fu.why.l.delHere.remote": "목록이 여기서 삭제된 뒤 다른 기기에서 수정됐어요. 목록을 남겼어요.",
  "fu.why.l.delHere.local": "목록이 다른 기기에서 수정된 뒤 여기서 삭제됐어요. 목록을 삭제했어요.",
  "fu.why.l.revived.local": "한쪽에서 목록을 삭제했지만 그 뒤에 카드가 추가됐어요. 목록을 남겼어요.",
  "al.k.merge": "기기 합치기",
  "save.migratedV9": "데이터를 업데이트했어요 (버전 9: 기기 합치기). 바로 전에 백업을 내보냈어요."
});
