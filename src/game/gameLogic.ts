import type {
  AnswerRecord,
  GameSettings,
  Player,
  PublicQuestion,
  QuizQuestion,
  RoomState,
} from '../types/game';
import { scoreAnswer } from './scoring';

export const COUNTDOWN_MS = 3200;
export const REVEAL_MS = 6000;

export function toPublicQuestion(q: QuizQuestion): PublicQuestion {
  const { correctAnswer: _c, explanation: _e, ...rest } = q;
  return rest;
}

/** 打乱选项顺序并同步修正正确下标，让同一题每次出现的选项排列都不同 */
export function shuffleQuestionOptions(q: QuizQuestion): QuizQuestion {
  const order = q.options.map((_, i) => i).sort(() => Math.random() - 0.5);
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
    questionEndsAt: now + state.settings.roundSeconds * 1000,
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
  answers: ReadonlyMap<string, { optionIndex: number; timeMs: number }>,
  now: number,
): { state: RoomState; results: AnswerRecord[] } {
  const roundMs = state.settings.roundSeconds * 1000;
  const players = state.players.map((p) => {
    const raw = answers.get(p.id);
    const correct = raw != null && raw.optionIndex === question.correctAnswer;
    const streakAfter = correct ? p.streak + 1 : 0;
    const timeMs = raw?.timeMs ?? roundMs;
    const points = scoreAnswer({ correct, timeMs, roundMs, streakAfter });
    return {
      player: {
        ...p,
        score: p.score + points,
        streak: streakAfter,
        correctCount: p.correctCount + (correct ? 1 : 0),
      },
      record: {
        playerId: p.id,
        optionIndex: raw?.optionIndex ?? -1,
        timeMs,
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
      correctAnswer: question.correctAnswer,
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
