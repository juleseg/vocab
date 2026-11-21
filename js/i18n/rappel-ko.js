"use strict";

// === I18N : 알림 켜기 정기 안내 (ÉTAPE 74) — 한국어 (ko) ===
// 홈 화면 배너 (js/rappel-notifs.js)와 관리 → 알림 → '켜기 권유'의 '정기 안내' 카드 (js/screens/admin-rappel.js). 키 nrp.*
// (+ 활동 기록용 np.al.reminder_set). 별도 파일, simple-ko.js 뒤에 불러옵니다. 버튼은 38단계의 ni.enable, ni.later, ni.ok,
// '차단됨' 안내는 ni.denied.ios / android / desktop을 그대로 씁니다.

Object.assign(I18N.ko, {
  "nrp.def": "알림을 켜면 복습 알림을 받고 연속 기록을 지킬 수 있어요.",
  "nrp.denied": "이 기기에서 Vocab 알림이 차단되어 있어요. 다시 켜려면:",
  "nrp.adm.title": "정기 안내",
  "nrp.adm.intro": "알림이 꺼진 기기의 홈 화면에 작은 배너를 보여 줘요 (창도, 푸시 알림도 아니에요). '나중에'를 누르면 정한 주기가 지난 뒤 다시 나오고, '켜기'에 성공하면 그 기기에서는 더 이상 나오지 않아요. 휴대폰에 앱이 설치되지 않았다면 '켜기'를 누를 때 설치 안내가 열려요.",
  "nrp.adm.on": "정기 안내 켜기",
  "nrp.adm.every": "며칠마다? (1~60)",
  "nrp.adm.max": "기기당 최대 안내 횟수 (1~20)",
  "nrp.adm.text": "안내 문구",
  "nrp.adm.textHint": "언어마다 문구 하나. 비워 둔 언어는 다른 언어의 문구를 써요.",
  "nrp.adm.default": "기본 문구로 되돌리기",
  "nrp.adm.preview": "미리 보기",
  "nrp.adm.save": "정기 안내 저장",
  "nrp.adm.saved": "정기 안내를 저장했어요",
  "nrp.adm.ro": "읽기 전용: 이 설정을 바꾸려면 '알림 → 보내기' 권한이 필요해요.",
  "nrp.adm.missing": "정기 안내를 설정하려면 Supabase에서 74단계 SQL 스크립트(supabase-etape74.sql)를 실행하세요. 그전까지 앱은 기본값(켜짐, 7일마다, 최대 5번)을 써요.",
  "nrp.adm.offline": "오프라인: 마지막으로 알려진 값이에요.",
  "nrp.adm.err.bad": "주기는 1~60일, 횟수는 1~20번이에요.",
  "nrp.adm.err.text": "문구가 너무 길어요 (언어당 최대 300자).",
  "nrp.adm.state": "현재: {s}",
  "nrp.adm.stateOn": "켜짐, {d}일마다, 기기당 최대 {m}번",
  "nrp.adm.stateOff": "꺼짐",
  "nrp.adm.stats": "정기 안내 현황",
  "nrp.adm.days": "최근 {n}일",
  "nrp.st.shown": "보여 준 배너",
  "nrp.st.devices": "기기",
  "nrp.st.accounts": "계정",
  "nrp.st.enabled": "켬",
  "nrp.st.later": "나중에",
  "nrp.st.install": "설치 안내",
  "nrp.st.denied": "거부",
  "nrp.st.help": "'차단됨' 안내",
  "nrp.al.src": "정기 안내",
  "np.al.reminder_set": "정기 안내 변경"
});
