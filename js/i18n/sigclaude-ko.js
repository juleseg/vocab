"use strict";

// === I18N : CLAUDE PROPOSE UNE CORRECTION POUR CHAQUE SIGNALEMENT (ÉTAPE 85) — 한국어 (ko) ===
// Clés sgc.* (propriétaire d'une carte personnelle, js/signalements-claude.js ; sgc.meta et queue.kind.report : type de
// demande « report » de la file d'attente), asg.ai.* (propositions et « Appliquer » de l'écran Signalements, interrupteur
// de Administration → Demandes à Claude : js/screens/admin-signalements.js). Fichier à part, chargé après signal-ko.js.
Object.assign(I18N.ko, {
  "sgc.reason": "신고 후 Claude가 제안한 수정",
  "sgc.got1": "신고한 카드에 Claude가 수정을 제안했어요",
  "sgc.gotN": "신고한 카드에 Claude가 수정 {n}개를 제안했어요",
  "sgc.meta": "신고 {n}건",
  "queue.kind.report": "신고",
  "asg.ai.fix": "Claude의 제안",
  "asg.ai.applied": "Claude의 수정이 적용됨",
  "asg.ai.refused": "Claude의 제안이 거절됨",
  "asg.ai.none": "Claude: 고칠 것이 없어요",
  "asg.ai.wait": "Claude가 다음에 올 때 수정을 제안해요",
  "asg.ai.apply": "적용",
  "asg.ai.refuse": "거절",
  "asg.ai.confirmDict": "공용 사전의 카드가 모든 사용자에게 수정돼요. 이전 버전은 사전 기록에 남아 있어요(되돌릴 수 있어요).",
  "asg.ai.confirmShared": "공유 목록의 카드가 모든 구성원에게 수정돼요.",
  "asg.ai.done": "수정 적용됨: 신고 {n}건 처리. 신고한 사람은 「고마워요, 고쳤어요」를 보게 돼요.",
  "asg.ai.err.stale": "제안 이후 카드가 바뀌었어요. 아무것도 수정하지 않았어요.",
  "asg.ai.err.nofix": "적용할 수정이 더 이상 없어요.",
  "asg.ai.err.bad": "이 수정은 적용할 수 없어요.",
  "asg.ai.off": "Claude의 제안이 꺼져 있어요(관리 → Claude 요청).",
  "asg.ai.h": "신고",
  "asg.ai.help": "Claude는 올 때마다 신고된 카드(최대 20개)를 읽고 수정 하나를 제안하거나 「고칠 것 없음」이라고 답해요. 공용 사전과 공유 목록: 제안이 신고 화면에 「적용」, 「거절」과 함께 나와요. 개인 카드: 카드 주인의 「검토」로 가요.",
  "asg.ai.on": "Claude가 신고된 카드의 수정을 제안",
  "asg.ai.prevOn": "켜짐: 대기 중인 신고가 Claude의 다음 방문 때 전달돼요.",
  "asg.ai.prevOff": "꺼짐: Claude에게 아무것도 보내지 않아요. 신고는 직접 처리해야 해요.",
  "asg.ai.saved": "설정을 저장했어요.",
  "asg.ai.missing": "85단계 SQL 스크립트(supabase-etape85.sql)를 실행하세요."
});
