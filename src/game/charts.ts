import type { QuizQuestion, RankChart } from '../types/game';
import { hashSeed, mulberry32, seededShuffle } from '../utils/random';

/** 排行榜动态题 id：chart-{chartId}-s{sampleId}，同 id 必同题（迁移可据 id 重建） */
export const chartQuestionId = (chartId: string, sampleId: number) => `chart-${chartId}-s${sampleId}`;

const CHART_ID_RE = /^chart-(.+)-s(\d+)$/;

/** 解析排行榜动态题 id；不是排行榜题返回 null */
export function parseChartQuestionId(id: string): { chartId: string; sampleId: number } | null {
  const m = CHART_ID_RE.exec(id);
  if (!m || Number.isNaN(Number(m[2]))) return null;
  return { chartId: m[1], sampleId: Number(m[2]) };
}

/**
 * 从排行榜确定性抽取 4 项生成一道排序题。
 * 同 (chartId, sampleId) 必生成完全相同的题目，因此：
 *  - 每次开局可随机取 sampleId，实现「从排行榜随机抽 4 项」的随机化；
 *  - 房主迁移时可仅凭 id 重建出与开局完全一致的选项与答案。
 */
export function buildChartQuestion(chart: RankChart, sampleId: number): QuizQuestion {
  const n = chart.entries.length;
  const use = Math.min(4, n);
  const rng = mulberry32(hashSeed(`${chart.id}\u0000${sampleId}`));

  // 随机抽 use 个互异条目（种子相同 → 抽取结果相同）
  const picked = new Set<number>();
  while (picked.size < use) picked.add(Math.floor(rng() * n));
  // 按榜单顺序（第 1 名在前）排列抽取项
  const rankedIdx = [...picked].sort((a, b) => a - b);
  const names = rankedIdx.map((i) => chart.entries[i].name);

  // 选项起手顺序也由同一种子决定
  const order = seededShuffle(names.map((_, i) => i), rng);
  const options = order.map((i) => names[i]);
  // correctOrder[k] = 第 k 名的选项下标（options[correctOrder[k]] === names[k]）
  const correctOrder = names.map((_, k) => order.indexOf(k));

  const rankText = rankedIdx
    .map((i, k) => {
      const e = chart.entries[i];
      return `${e.name}第${k + 1}名${e.value ? `（${e.value}）` : ''}`;
    })
    .join('，');

  return {
    id: chartQuestionId(chart.id, sampleId),
    category: 'ranking',
    difficulty: chart.difficulty,
    kind: 'ranking',
    question: `对下列「${chart.name}」中的上榜项，按照榜单位次从高到低排序`,
    options,
    correctOrder,
    explanation: `本题依据《${chart.name}》随机抽取 4 个上榜项出题：${rankText}。`,
  };
}