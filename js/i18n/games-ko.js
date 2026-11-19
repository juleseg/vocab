"use strict";

// === I18N : JEUX D'ENTRAÎNEMENT (étape 42) — 한국어 ===
// Fichier à part (ko.js approche la limite de taille), chargé après les fichiers de langue principaux.
Object.assign(I18N.ko, {
  "mode.mcq": "객관식", "mode.race": "60초 레이스", "mode.pairs": "짝 맞추기", "mode.order": "순서 맞추기",
  "review.games": "연습 게임",
  "review.gamesHint": "단어 카드만 나와요. 게임에서 맞혀도 카드 상자는 올라가지 않고, 틀리면 ‘애매해요’로 기록돼요.",
  "gm.order.kind": "순서 맞추기 대상", "gm.order.words": "단어", "gm.order.sents": "문장", "gm.order.both": "둘 다",
  "gm.need.title": "카드가 부족해요",
  "gm.need.mcq": "객관식에는 한 목록 안에 답이 서로 다른 단어 카드가 4장 이상 필요해요. 목록에 단어를 추가하거나 더 큰 목록을 고르세요.",
  "gm.need.race": "60초 레이스에는 한 목록 안에 답이 서로 다른 단어 카드가 4장 이상 필요해요. 목록에 단어를 추가하거나 더 큰 목록을 고르세요.",
  "gm.need.pairs": "짝 맞추기에는 단어와 뜻이 서로 다른 단어 카드가 6장 이상 필요해요. 단어를 추가하거나 더 큰 목록을 고르세요.",
  "gm.need.order": "순서를 맞출 것이 없어요. 2글자 이상인 단어나 3~12단어로 된 예문이 필요해요.",
  "gm.q": "문제 {i} / {n}",
  "gm.mcq.pick": "알맞은 답을 고르세요 ({lang})",
  "gm.next": "다음", "gm.quit": "게임 그만하기",
  "gm.right": "정답이에요!", "gm.wrong": "틀렸어요",
  "gm.sec": "{s}초", "gm.minsec": "{m}분 {s}초",
  "gm.race.best": "최고 기록: {n}",
  "gm.timeUp": "시간 끝!",
  "gm.pairs.hint": "단어를 누른 다음 그 뜻을 누르세요.",
  "gm.pairs.found": "{n} / {m}쌍",
  "gm.order.word": "글자 순서를 맞추세요 ({lang})",
  "gm.order.sent": "문장의 단어 순서를 맞추세요 ({lang})",
  "gm.order.with": "이 단어가 들어간 문장: {w}",
  "gm.order.hint": "힌트", "gm.order.check": "확인", "gm.order.answer": "정답:",
  "gm.sum.title": "게임 끝",
  "gm.sum.score": "점수", "gm.sum.pairs": "짝", "gm.sum.time": "시간", "gm.sum.errors": "실수", "gm.sum.record": "최고 기록", "gm.sum.hints": "힌트",
  "gm.sum.newRecord": "새 기록이에요!",
  "gm.sum.noErr": "실수 없이 다 맞혔어요!",
  "gm.sum.replay": "다시 하기",
  "gm.sum.reviewErrors": "틀린 카드 다시 보기 ({n}) · 카드 모드",
  "gm.record.pop": "새 기록: {n}!",
  "gm.sounds": "게임 소리",
  "gm.soundsHint": "게임에서 맞히거나 틀릴 때 짧은 소리가 나요.",
  "al.k.game": "게임",
  "al.s.game": "{game} · 점수 {s} · 카드 {n}장 · 실수 {e} · {min}분"
});
