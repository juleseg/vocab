"use strict";

// === I18N: 명사의 성 (단계 60) — 한국어 (ko) ===
// 성별 색상과 기호, "le / la ?" 모드, "성 없음" 배지. 키 gd.*, mode.gender
// 별도 파일, difficiles-ko.js 뒤에 불러옵니다.
Object.assign(I18N.ko, {
  "mode.gender": "le / la ?",
  "gd.m": "남성", "gd.f": "여성", "gd.mf": "둘 다",
  "gd.missing": "성 없음",
  "gd.missingTitle": "이 명사의 성이 입력되지 않았어요. Claude가 채워 줄 수 있어요.",
  "gd.ask": "어떤 관사일까요?",
  "gd.both": "둘 다 가능해요. 이 단어는 채점하지 않아요.",
  "gd.need": "이 선택에는 성(남성 또는 여성)이 입력된 명사가 없어요.",
  "gd.noProgress": "연습 모드예요. 학습 진행 상황은 바뀌지 않고 XP만 받아요.",
  "gd.sum.again": "틀린 것 다시 ({n})",
  "gd.art": "관사", "gd.art.def": "le / la", "gd.art.indef": "un / une", "gd.art.mix": "섞어서",
  "gd.chipHint": "명사의 관사를 고르세요 (연습, 진행 상황에 영향 없음).",
  "gd.menu": "성 채우기 ({n})",
  "gd.ask.title": "성 채우기",
  "gd.ask.text1": "성이 없는 명사가 1개 있어요. Claude에게 채워 달라고 할까요? 제안은 '검토'에 도착해요.",
  "gd.ask.text": "성이 없는 명사가 {n}개 있어요. Claude에게 채워 달라고 할까요? 제안은 '검토'에 도착해요.",
  "gd.ask.noQueue": "대기열을 쓸 수 없어요. Claude에게 복사해서 보낼 요청을 준비할 수 있어요.",
  "gd.ask.prepare": "Claude용으로 준비",
  "gd.set.title": "명사의 성",
  "gd.set.colors": "성별 색상",
  "gd.set.colorsHint": "파랑 = 남성, 빨강 = 여성, 보라 = 둘 다. 프랑스어, 이탈리아어, 스페인어, 포르투갈어에 적용돼요.",
  "gd.set.symbols": "색약 모드 (♂ ♀ ⚥)",
  "gd.set.symbolsHint": "색상을 꺼도 단어 옆에 작은 기호를 붙여요.",
  "gd.set.missing1": "성이 입력되지 않은 명사가 1개 있어요.",
  "gd.set.missing": "성이 입력되지 않은 명사가 {n}개 있어요.",
  "gd.set.ask": "Claude에게 채워 달라고 하기"
});
