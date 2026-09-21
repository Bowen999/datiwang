import type {
  AnswerRecord,
  GameSettings,
  Player,
  PublicQuestion,
  QuestionKind,
  QuizQuestion,
  RoomState,
} from '../types/game';
import { rankingRatio, scoreAnswer, scoreRankingAnswer } from './scoring';

export const COUNTDOWN_MS = 3200;
export const REVEAL_MS = 6000;

/** 排序题比选择题多出的作答时间（秒） */
export const RANKING_EXTRA_SECONDS = 10;

/** 题型对应的作答窗口（毫秒）：排序题在基础答题时间上 +10s */
export function questionTimeMs(kind: QuestionKind, roundSeconds: number): number {
  return (roundSeconds + (kind === 'ranking' ? RANKING_EXTRA_SECONDS : 0)) * 1000;
}

export function toPublicQuestion(q: QuizQuestion): PublicQuestion {
  if (q.kind === 'ranking') {
    const { correctOrder: _c, explanation: _e, ...rest } = q;
    return rest;
  }
  const { correctAnswer: _c, explanation: _e, ...rest } = q;
  return rest;
}

/** 打乱选项顺序并同步修正答案，让同一题每次出现的选项排列都不同 */
export function shuffleQuestionOptions(q: QuizQuestion): QuizQuestion {
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
  if (q.kind === 'ranking') {
    // 排序题：洗牌后同步重映射正确排名中的选项下标
    const oldToNew: number[] = new Array(order.length);
    order.forEach((oldIdx, newIdx) => {
      oldToNew[oldIdx] = newIdx;
    });
    return {
      ...q,
      options: order.map((i) => q.options[i]),
      correctOrder: q.correctOrder.map((old) => oldToNew[old]),
    };
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correctAnswer: order.indexOf(q.correctAnswer),
  };
}

export function createRoomState(
  code: string,
  name: string,
  host: Player,
  settings: GameSettings,
  now: number,
): RoomState {
  return {
    code,
    name,
    hostId: host.id,
    phase: 'lobby',
    players: [host],
    settings,
    round: 0,
    totalRounds: settings.questionCount,
    questionIds: [],
    usedQuestionIds: [],
    answeredIds: [],
    version: now,
  };
}

/** 房主点击开始：进入开场倒计时 */
export function startCountdown(
  state: RoomState,
  questionIds: string[],
  now: number,
): RoomState {
  return {
    ...state,
    phase: 'countdown',
    round: 0,
    totalRounds: questionIds.length,
    questionIds,
    answeredIds: [],
    reveal: undefined,
    activeQuestion: undefined,
    questionEndsAt: undefined,
    countdownEndsAt: now + COUNTDOWN_MS,
    version: now,
  };
}

/** 倒计时结束：发出当前轮题目 */
export function launchQuestion(state: RoomState, question: QuizQuestion, now: number): RoomState {
  return {
    ...state,
    phase: 'question',
    activeQuestion: toPublicQuestion(question),
    questionEndsAt: now + questionTimeMs(question.kind, state.settings.roundSeconds),
    countdownEndsAt: undefined,
    answeredIds: [],
    reveal: undefined,
    version: now,
  };
}

/** 回合结束：结算本轮所有玩家得分，进入揭晓阶段 */
export function computeReveal(
  state: RoomState,
  question: QuizQuestion,
  answers: ReadonlyMap<string, { optionIndex?: number; order?: number[]; timeMs: number }>,
  now: number,
): { state: RoomState; results: AnswerRecord[] } {
  const roundMs = questionTimeMs(question.kind, state.settings.roundSeconds);
  const players = state.players.map((p) => {
    const raw = answers.get(p.id);
    let optionIndex = -1;
    let order: number[] = [];
    let correct = false;
    let points = 0;
    if (question.kind === 'ranking') {
      // 排序题：按正确率给分，完全正确才有连击
      order = raw?.order && raw.order.length > 0 ? raw.order : [];
      const ratio = rankingRatio(order, question.correctOrder);
      correct = ratio >= 1;
      const streakAfter = correct ? p.streak + 1 : 0;
      points = scoreRankingAnswer({ ratio, timeMs: raw?.timeMs ?? roundMs, roundMs, streakAfter }).points;
    } else {
      optionIndex = raw?.optionIndex ?? -1;
      correct = raw != null && raw.optionIndex === question.correctAnswer;
      const streakAfter = correct ? p.streak + 1 : 0;
      points = scoreAnswer({ correct, timeMs: raw?.timeMs ?? roundMs, roundMs, streakAfter });
    }
    return {
      player: {
        ...p,
        score: p.score + points,
        streak: correct ? p.streak + 1 : 0,
        correctCount: p.correctCount + (correct ? 1 : 0),
      },
      record: {
        playerId: p.id,
        optionIndex,
        order,
        timeMs: raw?.timeMs ?? roundMs,
        correct,
        points,
      } satisfies AnswerRecord,
    };
  });
  const results = players.map((x) => x.record);
  const next: RoomState = {
    ...state,
    phase: 'reveal',
    players: players.map((x) => x.player),
    reveal: {
      kind: question.kind,
      correctAnswer: question.kind === 'choice' ? question.correctAnswer : undefined,
      correctOrder: question.kind === 'ranking' ? question.correctOrder : undefined,
      explanation: question.explanation,
      results,
      endsAt: now + REVEAL_MS,
    },
    version: now,
  };
  return { state: next, results };
}

/** 进入下一题倒计时，或结束游戏 */
export function advanceAfterReveal(state: RoomState, now: number): RoomState {
  const nextRound = state.round + 1;
  if (nextRound >= state.totalRounds) {
    return {
      ...state,
      phase: 'final',
      round: nextRound,
      activeQuestion: undefined,
      questionEndsAt: undefined,
      reveal: undefined,
      answeredIds: [],
      version: now,
    };
  }
  return {
    ...state,
    phase: 'countdown',
    round: nextRound,
    countdownEndsAt: now + COUNTDOWN_MS,
    activeQuestion: undefined,
    questionEndsAt: undefined,
    reveal: undefined,
    answeredIds: [],
    version: now,
  };
}

/** 再来一局：清空成绩回到大厅 */
export function resetToLobby(state: RoomState, now: number): RoomState {
  return {
    ...state,
    phase: 'lobby',
    round: 0,
    players: state.players.map((p) => ({ ...p, score: 0, streak: 0, correctCount: 0, ready: false })),
    questionIds: [],
    activeQuestion: undefined,
    questionEndsAt: undefined,
    countdownEndsAt: undefined,
    reveal: undefined,
    answeredIds: [],
    version: now,
  };
}
