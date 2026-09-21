/* 排序题逻辑冒烟测试：洗牌重映射 + 结算计分 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeReveal, shuffleQuestionOptions } from '../src/game/gameLogic';
import { rankingRatio, scoreRankingAnswer } from '../src/game/scoring';
import type { QuizQuestion, RoomState } from '../src/types/game';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`, extra ?? '');
  }
}

// ---- 1. 排序题洗牌：重映射必须保持「第 i 名的实体不变」----
const base: QuizQuestion = {
  id: 'r1',
  category: 'ranking',
  difficulty: 'hard',
  kind: 'ranking',
  question: '按 GDP 排序',
  options: ['美国', '德国', '日本', '中国'],
  correctOrder: [0, 3, 1, 2],
};
console.log('1) shuffleQuestionOptions（排序题重映射）');
let shuffleOk = true;
for (let iter = 0; iter < 2000 && shuffleOk; iter++) {
  const s = shuffleQuestionOptions(base);
  for (let i = 0; i < base.correctOrder.length; i++) {
    // 第 i 名实体在洗牌前后必须一致
    const oldRankOpt = base.options[base.correctOrder[i]];
    const newRankOpt = s.options[s.correctOrder[i]];
    if (oldRankOpt !== newRankOpt) shuffleOk = false;
  }
}
check('2000 次洗牌：正确顺序重映射全部一致', shuffleOk);

// 选择题洗牌仍正确
const choiceQ: QuizQuestion = {
  id: 'c1',
  category: 'general',
  difficulty: 'easy',
  kind: 'choice',
  question: 'q',
  options: ['a', 'b', 'c', 'd'],
  correctAnswer: 1,
};
let choiceOk = true;
for (let iter = 0; iter < 500; iter++) {
  const s = shuffleQuestionOptions(choiceQ);
  if (s.options[s.correctAnswer] !== 'b') choiceOk = false;
}
check('选择题洗牌 500 次：correctAnswer 始终指向正确答案', choiceOk);

// ---- 2. rankingRatio ----
console.log('2) rankingRatio');
check('完全正确 = 1', rankingRatio([0, 1, 2, 3], [0, 1, 2, 3]) === 1);
check('全错 = 0', rankingRatio([3, 2, 1, 0], [0, 1, 2, 3]) === 0);
check('对 1 个 = 0.25', rankingRatio([0, 3, 1, 2], [0, 1, 2, 3]) === 0.25);
check('对 2 个 = 0.5', rankingRatio([0, 3, 2, 1], [0, 1, 2, 3]) === 0.5);
check('长度不符 = 0', rankingRatio([0], [0, 1, 2, 3]) === 0);
check('空数组 = 0', rankingRatio([], [0, 1, 2, 3]) === 0);

// ---- 3. scoreRankingAnswer ----
console.log('3) scoreRankingAnswer');
const full = scoreRankingAnswer({ ratio: 1, timeMs: 1000, roundMs: 15000, streakAfter: 1 }).points;
const full2 = scoreRankingAnswer({ ratio: 1, timeMs: 1000, roundMs: 15000, streakAfter: 2 }).points;
const half = scoreRankingAnswer({ ratio: 0.5, timeMs: 1000, roundMs: 15000, streakAfter: 1 }).points;
const zero = scoreRankingAnswer({ ratio: 0, timeMs: 1000, roundMs: 15000, streakAfter: 1 }).points;
check('完全正确有连击加成', full2 > full);
check('部分正确分数介于 0 与满分之间', half > 0 && half < full);
check('部分正确不计为答对', scoreRankingAnswer({ ratio: 0.5, timeMs: 1000, roundMs: 15000, streakAfter: 1 }).correct === false);
check('全错 0 分', zero === 0);

// ---- 4. computeReveal 集成 ----
console.log('4) computeReveal（排序题 + 选择题）');
const hostPlayer = {
  id: 'p1', name: 'A', avatar: 'x', color: '#fff', score: 0, streak: 0, correctCount: 0,
  isHost: true, connected: true, ready: true, joinedAt: 1,
};
const otherPlayer = {
  id: 'p2', name: 'B', avatar: 'x', color: '#000', score: 0, streak: 0, correctCount: 0,
  isHost: false, connected: true, ready: true, joinedAt: 2,
};
const roomPre: RoomState = {
  code: 'TEST', name: 'n', hostId: 'p1', phase: 'question', players: [hostPlayer, otherPlayer],
  settings: { roundSeconds: 15, questionCount: 2, categories: [], difficulty: 'mixed', questionTypes: ['choice', 'ranking'] },
  round: 0, totalRounds: 2, questionIds: ['r1'], usedQuestionIds: [], answeredIds: [],
  activeQuestion: undefined, version: 1,
};

// 排序题：一人全对，一人 50%
const rq: QuizQuestion = { ...base };
const { state } = computeReveal(
  roomPre,
  rq,
  new Map([
    ['p1', { order: [0, 3, 1, 2], timeMs: 5000 }],
    ['p2', { order: [0, 3, 2, 1], timeMs: 5000 }],
  ]),
  1_000_000,
);
const r1 = state.reveal!.results.find((r) => r.playerId === 'p1')!;
const r2 = state.reveal!.results.find((r) => r.playerId === 'p2')!;
check('reveal 带 kind=ranking', state.reveal!.kind === 'ranking');
check('reveal 带 correctOrder', JSON.stringify(state.reveal!.correctOrder) === JSON.stringify([0, 3, 1, 2]));
check('全对者 correct=true 且有分', r1.correct === true && r1.points > 0);
check('50% 者 correct=false 但得分>0', r2.correct === false && r2.points > 0 && r2.points < r1.points);
check('50% 者 order 记录正确', JSON.stringify(r2.order) === JSON.stringify([0, 3, 2, 1]));
check('排序题 optionIndex=-1', r1.optionIndex === -1);
const hostAfter = state.players.find((p) => p.id === 'p1')!;
check('全对者 score 累加 + streak=1', hostAfter.score === r1.points && hostAfter.streak === 1);

// 排序题：超时未作答 → 0 分
const { state: st2 } = computeReveal(roomPre, rq, new Map(), 2_000_000);
const r3 = st2.reveal!.results.find((r) => r.playerId === 'p1')!;
check('未作答：0 分且 correct=false', r3.points === 0 && r3.correct === false && r3.order.length === 0);

// 选择题仍然正常
const cq: QuizQuestion = { ...choiceQ };
const { state: st3 } = computeReveal(
  roomPre,
  cq,
  new Map([
    ['p1', { optionIndex: 1, timeMs: 3000 }],
    ['p2', { optionIndex: 2, timeMs: 3000 }],
  ]),
  3_000_000,
);
const c1 = st3.reveal!.results.find((r) => r.playerId === 'p1')!;
const c2 = st3.reveal!.results.find((r) => r.playerId === 'p2')!;
check('选择题 reveal correctAnswer', st3.reveal!.correctAnswer === 1 && st3.reveal!.kind === 'choice');
check('选择题答对得分', c1.correct === true && c1.points > 0);
check('选择题答错 0 分', c2.correct === false && c2.points === 0);
check('选择题 order 为空数组', c2.order.length === 0);

// ---- 5. 排序题 JSON 数据正确性（correctOrder 自检）----
console.log('5) ranking.json 数据自检');
const rankingJson = JSON.parse(readFileSync(join(process.cwd(), 'public/questions/ranking.json'), 'utf8')) as QuizQuestion[];
check(`ranking.json 共 70 题`, rankingJson.length === 70);
for (const q of rankingJson) {
  const order = (q as { correctOrder?: number[] }).correctOrder ?? [];
  check(
    `${q.id}: kind=ranking & correctOrder 长度匹配`,
    q.kind === 'ranking' && order.length === q.options.length,
  );
  const seen = new Set(order.map(String));
  check(
    `${q.id}: correctOrder 为 0..N-1 的排列`,
    seen.size === q.options.length && order.every((v) => v >= 0 && v < q.options.length),
  );
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);