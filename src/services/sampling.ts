import { parseChartQuestionId } from '../game/charts';
import { seededShuffle } from '../utils/random';

/** 分类配额指数：分类期望配额 ∝ 可用题量^alpha（1 = 按题量比例，0 = 各类平分） */
export const SAMPLER_ALPHA = 0.5;
/** 频率降权指数：权重 = 1 / (1 + 出镜次数)^beta */
export const SAMPLER_BETA = 1;
/** 混合局里排名题名额换成动态榜单题的概率；纯排序局用它决定榜单题占比 */
export const CHART_SHARE = 0.5;

/** 分类保底占比：该分类被选中时，期望题数至少占整局这个比例（看图题每局 25 题约 2-3 道） */
export const CATEGORY_MIN_SHARE: Readonly<Record<string, number>> = { picture: 0.1 };

export type Rng = () => number;

export interface SampleCandidate {
  id: string;
  category: string;
  topic?: string;
}

export interface SampleOptions {
  count: number;
  /** 本房间出过的题，按时间顺序（越靠前越久） */
  history: readonly string[];
  /** 去重后的出镜次数，缺省视为 0 */
  freq: ReadonlyMap<string, number>;
  rng?: Rng;
  alpha?: number;
  beta?: number;
  minShare?: Readonly<Record<string, number>>;
}

export interface Stratum {
  key: string;
  /** 同一 group（分类）的层在系统抽样中相邻，分类合计也是 floor/ceil(期望) */
  group: string;
  weight: number;
  capacity: number;
}

export function freqWeight(showings: number, beta: number): number {
  return 1 / Math.pow(1 + Math.max(0, showings), beta);
}

/** Efraimidis–Spirakis 键 ln(u)/w：越大越优先，取对数避免小权重下溢 */
export function esKey(weight: number, rng: Rng): number {
  const u = rng() || Number.MIN_VALUE;
  return Math.log(u) / Math.max(weight, 1e-9);
}

const stratumKey = (category: string, topic?: string) => `${category}\u0000${topic ?? ''}`;

/** 分类权重 = 题量^alpha；有保底占比的分类若权重占比低于保底，则上调到恰好等于保底占比 */
export function categoryWeights(
  size: ReadonlyMap<string, number>,
  alpha: number,
  minShare: Readonly<Record<string, number>> = CATEGORY_MIN_SHARE,
): Map<string, number> {
  const w = new Map([...size].map(([c, n]) => [c, Math.pow(n, alpha)] as const));
  for (const [c, share] of Object.entries(minShare)) {
    const own = w.get(c);
    if (own === undefined) continue;
    const others = [...w].reduce((t, [k, v]) => (k === c ? t : t + v), 0);
    if (others > 0 && own / (own + others) < share) w.set(c, (share / (1 - share)) * others);
  }
  return w;
}

/** 层 = (分类, topic)；分类权重见 categoryWeights，分类内按各层题量比例分摊 */
export function buildStrata(
  items: readonly SampleCandidate[],
  alpha: number,
  minShare?: Readonly<Record<string, number>>,
): Stratum[] {
  const catSize = new Map<string, number>();
  const layers = new Map<string, { group: string; n: number }>();
  for (const q of items) {
    catSize.set(q.category, (catSize.get(q.category) ?? 0) + 1);
    const k = stratumKey(q.category, q.topic);
    const s = layers.get(k);
    if (s) s.n++;
    else layers.set(k, { group: q.category, n: 1 });
  }
  const weight = categoryWeights(catSize, alpha, minShare);
  return [...layers].map(([key, { group, n }]) => {
    const nc = catSize.get(group)!;
    return { key, group, capacity: n, weight: weight.get(group)! * (n / nc) };
  });
}

/** 点集 {u, u+1, u+2, ...} 中小于 x 的点数（容差防止整数边界的浮点误差） */
const pointsBelow = (x: number, u: number) => (x <= u ? 0 : Math.ceil(x - u - 1e-9));

/**
 * 系统抽样分配配额：每层、每个分类都恰好得到期望值的 floor 或 ceil，期望精确等于 count·weight/Σweight。
 * 期望超过容量的层先封顶，余量在其余层重新分配。返回值之和 = min(count, Σcapacity)。
 */
export function allocateQuotas(strata: readonly Stratum[], count: number, rng: Rng): Map<string, number> {
  const quota = new Map<string, number>();
  const cap = new Map<string, number>();
  for (const s of strata) {
    quota.set(s.key, 0);
    cap.set(s.key, s.capacity);
  }
  let remaining = Math.min(
    count,
    strata.reduce((t, s) => t + s.capacity, 0),
  );
  const groups = seededShuffle([...new Set(strata.map((s) => s.group))], rng);
  let active = groups.flatMap((g) => seededShuffle(strata.filter((s) => s.group === g && s.capacity > 0), rng));
  const room = (s: Stratum) => cap.get(s.key)! - quota.get(s.key)!;

  while (remaining > 0 && active.length > 0) {
    const total = active.reduce((t, s) => t + s.weight, 0);
    const expected = active.map((s) => (remaining * s.weight) / total);
    const over = active.filter((s, i) => expected[i] > room(s));
    if (over.length > 0) {
      for (const s of over) {
        remaining -= room(s);
        quota.set(s.key, cap.get(s.key)!);
      }
      active = active.filter((s) => !over.includes(s));
      continue;
    }
    const u = rng();
    let acc = 0;
    let assigned = 0;
    active.forEach((s, i) => {
      const lo = acc;
      acc += expected[i];
      const k = Math.min(room(s), pointsBelow(acc, u) - pointsBelow(lo, u));
      quota.set(s.key, quota.get(s.key)! + k);
      assigned += k;
    });
    remaining -= assigned;
    active = active.filter((s) => room(s) > 0);
    if (assigned === 0) {
      for (const s of active) {
        if (remaining <= 0) break;
        quota.set(s.key, quota.get(s.key)! + 1);
        remaining--;
      }
    }
  }
  return quota;
}

/**
 * 分层加权无放回抽样，返回顺序无意义（调用方自行洗牌）：
 * 1. 房间里没出过的题够用就只在其中抽；不够则全拿，再按"最久未出现"补齐；
 * 2. 分层配额决定各分类/topic 的题数，层内按 ES 键（权重 = 频率降权）择优。
 */
export function sampleBalanced<T extends SampleCandidate>(pool: readonly T[], opts: SampleOptions): T[] {
  const rng = opts.rng ?? Math.random;
  const alpha = opts.alpha ?? SAMPLER_ALPHA;
  const beta = opts.beta ?? SAMPLER_BETA;
  const count = Math.max(0, Math.floor(opts.count));
  if (count === 0 || pool.length === 0) return [];
  if (pool.length <= count) return seededShuffle(pool, rng);

  const lastUsed = new Map<string, number>();
  opts.history.forEach((id, i) => lastUsed.set(id, i));
  const fresh = pool.filter((q) => !lastUsed.has(q.id));
  if (fresh.length < count) {
    const stale = seededShuffle(
      pool.filter((q) => lastUsed.has(q.id)),
      rng,
    ).sort((a, b) => lastUsed.get(a.id)! - lastUsed.get(b.id)!);
    return [...fresh, ...stale.slice(0, count - fresh.length)];
  }

  const quota = allocateQuotas(buildStrata(fresh, alpha, opts.minShare), count, rng);
  const ranked = fresh
    .map((q) => ({ q, key: esKey(freqWeight(opts.freq.get(q.id) ?? 0, beta), rng) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.q);

  const out: T[] = [];
  const taken = new Set<T>();
  const used = new Map<string, number>();
  for (const q of ranked) {
    if (out.length >= count) break;
    const k = stratumKey(q.category, q.topic);
    if ((used.get(k) ?? 0) < (quota.get(k) ?? 0)) {
      used.set(k, (used.get(k) ?? 0) + 1);
      taken.add(q);
      out.push(q);
    }
  }
  for (const q of ranked) {
    if (out.length >= count) break;
    if (!taken.has(q)) out.push(q);
  }
  return out;
}

/** 动态榜单题的 id 每次都不同，历史和频率要折算到榜单级（chart:<chartId>）才有意义 */
export const chartKey = (chartId: string) => `chart:${chartId}`;

export function chartHistory(history: readonly string[]): string[] {
  return history.map((id) => {
    const p = parseChartQuestionId(id);
    return p ? chartKey(p.chartId) : id;
  });
}

export function chartFrequency(freq: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, n] of freq) {
    const p = parseChartQuestionId(id);
    if (p) out.set(chartKey(p.chartId), (out.get(chartKey(p.chartId)) ?? 0) + n);
  }
  return out;
}

/** 同一题相邻事件间隔不超过 gapMs 视为同一次出镜（每位玩家各报一次 question_answered） */
export function countShowings(events: ReadonlyArray<{ id: string; t: number }>, gapMs: number): Map<string, number> {
  const byId = new Map<string, number[]>();
  for (const e of events) {
    if (!e.id || !Number.isFinite(e.t)) continue;
    const list = byId.get(e.id);
    if (list) list.push(e.t);
    else byId.set(e.id, [e.t]);
  }
  const out = new Map<string, number>();
  for (const [id, ts] of byId) {
    ts.sort((a, b) => a - b);
    let n = 1;
    for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > gapMs) n++;
    out.set(id, n);
  }
  return out;
}
