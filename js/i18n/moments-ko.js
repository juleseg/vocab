"use strict";

// === I18N: 복습하기 좋은 때 (단계 61) — 한국어 (ko) ===
// 아침 복습, "2분" 미니 세션, 설정, 알림 규칙 "morning_recall". 키 mom.*
// 별도 파일, genre-ko.js 뒤에 불러옵니다.
Object.assign(I18N.ko, {
  "mom.morning": "아침 복습",
  "mom.morningSub": "어젯밤에 본 카드 {n}장",
  "mom.morningSub1": "어젯밤에 본 카드 1장",
  "mom.micro": "2분",
  "mom.microSub": "복습할 카드 {n}장",
  "mom.microSub1": "복습할 카드 1장",
  "mom.none": "지금은 아침 복습이 없어요. 어젯밤에 본 카드가 없거나 이미 했어요.",
  "mom.off": "아침 복습이 꺼져 있어요 (설정).",
  "mom.microNone": "지금은 복습할 카드가 없어요.",
  "mom.hour": "{h}시",
  "mom.set.title": "아침 복습",
  "mom.set.on": "저녁에 본 카드를 다음 날 아침에 다시 보기",
  "mom.set.onHint": "{h} 이후에 본 카드를 다음 날 아침(정오까지) 홈에서 짧은 세션으로 다시 보여 줘요. 하룻밤 자고 나서 다시 보면 더 잘 기억해요.",
  "mom.set.evening": "저녁 시작 시간",
  "mom.set.notif": "아침 알림",
  "mom.set.hour": "알림 시간",
  "mom.set.notifHint": "다시 볼 카드가 있을 때만, 하루 알림 2개 한도 안에서 보내요. 이 기기에서 알림이 켜져 있어야 해요 (알림 카드, '알림(복습)' 분류).",
  "mom.set.notifLocal": "아침 알림은 온라인 계정이 있어야 해요.",

  // 관리 → 알림 → 자동
  "np.rule.morning_recall": "아침 복습",
  "np.rule.morning_recall.d": "전날 저녁에 카드를 보고 아직 다시 보지 않은 계정에게, 각 계정이 설정에서 고른 시간(기본 8시, 계정이 끄면 보내지 않음)에 정오 전까지 보내요. '알림(복습)' 분류: 하루 알림 2개 한도에 포함돼요. 누르면 아침 복습이 열려요.",
  "np.ru.userTime": "각 계정이 고른 시간 (설정 → 아침 복습).",
  "np.tpl.morning_recall": "아침 복습",
  "np.rule.goal_reminder.d": "정한 시간까지 오늘 아무것도 복습하지 않았을 때. 알림을 누르면 \"2분\" 미니 세션(복습할 카드 5장)이 시작돼요."
});
