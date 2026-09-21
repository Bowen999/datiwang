import type { Player } from '../types/game';
import { clamp } from '../utils/random';

/** 答对基础分 */
export const BASE_POINTS = 600;
/** 速度加分上限：答得越快越高 */
export const MAX_SPEED_BONUS = 400;
/** 连击加成：每级连击额外加分（上限 3 级） */
export const STREAK_BONUS = 100;
export const MAX_STREAK_LEVEL = 3;

export interface ScoreInput {
  correct: boolean;
  /** 作答耗时（毫秒） */
  timeMs: number;
  /** 本回合总时长（毫秒） */
  roundMs: number;
  /** 答完本题后的连击数（1 表示首次答对） */
  streakAfter: number;
}

/**
 * 计分规则（纯函数，可独立测试/替换）：
 * - 答错或未作答：0 分
 * - 答对：基础 600 分 + 速度加分（剩余时间越多越高，最多 400）+ 连击加成
 */
export function scoreAnswer({ correct, timeMs, roundMs, streakAfter }: ScoreInput): number {
  if (!correct) return 0;
  const speedRatio = clamp(1 - timeMs / Math.max(1, roundMs), 0, 1);
  const speedBonus = Math.round(MAX_SPEED_BONUS * speedRatio);
  const streakBonus = clamp(streakAfter - 1, 0, MAX_STREAK_LEVEL) * STREAK_BONUS;
  return BASE_POINTS + speedBonus + streakBonus;
}

/**
 * 排序题正确率：玩家排列与标准排列逐位对比，位置相同得一分。
 * 返回 0~1，1 表示完全正确。
 */
export function rankingRatio(playerOrder: readonly number[], correctOrder: readonly number[]): number {
  if (playerOrder.length === 0 || playerOrder.length !== correctOrder.length) return 0;
  let hits = 0;
  for (let i = 0; i < playerOrder.length; i++) {
    if (playerOrder[i] === correctOrder[i]) hits++;
  }
  return hits / playerOrder.length;
}

export interface RankingScoreInput {
  /** 正确率 0~1 */
  ratio: number;
  /** 作答耗时（毫秒） */
  timeMs: number;
  /** 本回合总时长（毫秒） */
  roundMs: number;
  /** 完全正确后的连击数（1 表示首次完全答对） */
  streakAfter: number;
}

/**
 * 排序题计分：
 * - 完全正确：与选择题一致（基础分 + 速度加分 + 连击）
 * - 部分正确：按正确率打折（不含连击加成）
 * - 全错/未作答：0 分
 */
export function scoreRankingAnswer({ ratio, timeMs, roundMs, streakAfter }: RankingScoreInput): {
  points: number;
  correct: boolean;
} {
  if (ratio <= 0) return { points: 0, correct: false };
  if (ratio >= 1) {
    return { points: scoreAnswer({ correct: true, timeMs, roundMs, streakAfter }), correct: true };
  }
  const full = scoreAnswer({ correct: true, timeMs, roundMs, streakAfter: 1 });
  return { points: Math.round(full * ratio), correct: false };
}

export interface RankedPlayer extends Player {
  rank: number;
  /** 与上一名的分差 */
  gap: number;
}

/** 排名（分数降序，同分按答对数、再加入时间） */
export function rankPlayers(players: readonly Player[]): RankedPlayer[] {
  const sorted = [...players].sort(
    (a, b) => b.score - a.score || b.correctCount - a.correctCount || a.joinedAt - b.joinedAt,
  );
  let lastScore = -1;
  let lastRank = 0;
  return sorted.map((p, i) => {
    const rank = p.score === lastScore ? lastRank : i + 1;
    lastScore = p.score;
    lastRank = rank;
    return { ...p, rank, gap: i === 0 ? 0 : sorted[i - 1].score - p.score };
  });
}
