/* 采样器模拟：legacy（旧算法原样保留）vs 新算法（真实 QuestionService），固定种子断言各项性质，失败退出码 1。npm run sim:sampler；环境变量 GAMES / SEED */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mulberry32, shuffle } from '../src/utils/random';
import { QuestionService, type GetQuestionsOptions } from '../src/services/QuestionService';
import { questionFrequencyService } from '../src/services/QuestionFrequencyService';
import { CHART_SHARE, SAMPLER_ALPHA, categoryWeights } from '../src/services/sampling';
import { shuffleQuestionOptions } from '../src/game/gameLogic';
import { buildChartQuestion, chartQuestionId, parseChartQuestionId } from '../src/game/charts';
import type { CategoryMeta, QuizQuestion, RankChart } from '../src/types/game';

const SEED = Number(process.env.SEED ?? 20260924);
const GAMES = Number(process.env.GAMES ?? 4000);
const COUNT = 25;

// ---------------- 工具 ----------------
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const f = (x: number, d = 2) => x.toFixed(d);
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const seed = (k: number) => (Math.random = mulberry32(SEED + k));

let failures = 0;
function check(id: string, name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${id} ${name}（${detail}）`);
}
const summary: Array<[string, string, string]> = [];
const row = (label: string, legacy: string, next: string) => summary.push([label, legacy, next]);

// ---------------- 数据与数据源 ----------------
const QDIR = process.env.QDIR ?? join(process.cwd(), 'public/questions');
const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(QDIR, file), 'utf8')) as T;
const normalize = (q: QuizQuestion): QuizQuestion => (q.kind === 'ranking' ? q : ({ ...q, kind: 'choice' } as QuizQuestion));
const categories = readJson<{ categories: CategoryMeta[] }>('index.json').categories;
const charts = readJson<RankChart[]>('rankcharts.json');
const bank = new Map(categories.map((c) => [c.id, readJson<QuizQuestion[]>(`${c.id}.json`).map(normalize)]));

class MemSource {
  hidden = new Set<string>();
  async listCategories() {
    return categories;
  }
  async fetchCategoryQuestions(id: string) {
    const list = bank.get(id);
    if (!list) throw new Error(`no category ${id}`);
    return this.hidden.size ? list.filter((q) => !this.hidden.has(q.id)) : list;
  }
  async fetchRankCharts() {
    return charts;
  }
}

let currentFreq: ReadonlyMap<string, number> = new Map();
(questionFrequencyService as unknown as { getFrequencyMap: () => Promise<ReadonlyMap<string, number>> }).getFrequencyMap =
  async () => currentFreq;

// ---------------- legacy：重构前的 getQuestions + pickWeighted，仅频率表改为注入 ----------------
class LegacyQuestionService {
  private cache = new Map<string, QuizQuestion[]>();
  private chartCache?: RankChart[];
  constructor(private source: MemSource) {}

  private async getCategoryQuestions(id: string) {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const qs = await this.source.fetchCategoryQuestions(id);
    this.cache.set(id, qs);
    return qs;
  }

  private async getCharts() {
    if (this.chartCache) return this.chartCache;
    try {
      this.chartCache = await this.source.fetchRankCharts();
    } catch {
      this.chartCache = [];
    }
    return this.chartCache;
  }

  async getQuestions(opts: GetQuestionsOptions): Promise<QuizQuestion[]> {
    const { categories: cs, difficulty = 'mixed', questionTypes = [], count, excludeIds = [] } = opts;
    const allCats = (await this.source.listCategories()).map((c) => c.id);
    const cats = cs?.length ? cs : allCats.filter((c) => c !== 'examscope');
    const pools = await Promise.all(cats.map((c) => this.getCategoryQuestions(c)));
    let all = pools.flat();
    if (difficulty !== 'mixed') all = all.filter((q) => q.difficulty === difficulty);
    if (questionTypes.length > 0) all = all.filter((q) => questionTypes.includes(q.kind));
    const excluded = new Set(excludeIds);
    const fresh = all.filter((q) => !excluded.has(q.id));
    const pool = fresh.length >= count ? fresh : all;

    const rankingWanted = questionTypes.length === 0 || questionTypes.includes('ranking');
    const rankingCat = cats.includes('ranking');
    const rankingOnly = questionTypes.length === 1 && questionTypes[0] === 'ranking';
    const dynamic: QuizQuestion[] = [];

    if (rankingWanted && rankingCat && count > 0) {
      const cts = (await this.getCharts()).filter((c) => difficulty === 'mixed' || c.difficulty === difficulty);
      const nChart = Math.min(cts.length, Math.max(1, Math.round(count / 2)));
      for (const chart of shuffle(cts).slice(0, nChart)) {
        let sampleId = 100000 + Math.floor(Math.random() * 900000);
        let id = chartQuestionId(chart.id, sampleId);
        for (let tries = 0; tries < 40 && excluded.has(id); tries++) {
          sampleId = 100000 + Math.floor(Math.random() * 900000);
          id = chartQuestionId(chart.id, sampleId);
        }
        excluded.add(id);
        dynamic.push(buildChartQuestion(chart, sampleId));
      }
    }

    if (dynamic.length === 0) return this.pickWeighted(pool, count);
    if (rankingOnly) {
      const needStatic = Math.max(0, count - dynamic.length);
      const staticRank = this.pickWeighted(pool.filter((q) => q.kind === 'ranking'), needStatic);
      return shuffle([...staticRank, ...dynamic]).slice(0, count);
    }
    const staticPool = this.pickWeighted(pool, Math.max(0, count - dynamic.length));
    return shuffle([...staticPool, ...dynamic]).slice(0, count);
  }

  private pickWeighted(pool: QuizQuestion[], count: number): QuizQuestion[] {
    if (pool.length <= count) return shuffle(pool);
    const freq = currentFreq;
    const scored = pool.map((q) => ({ q, score: freq.get(q.id) ?? 0, rand: Math.random() }));
    scored.sort((a, b) => a.score - b.score || a.rand - b.rand);
    const oversample = Math.min(pool.length, Math.max(count * 3, count + 10));
    const candidates = scored.slice(0, oversample).map((s) => s.q);
    return shuffle(candidates).slice(0, count);
  }
}

// ---------------- 算法封装 ----------------
interface Algo {
  name: string;
  src: MemSource;
  get: (o: GetQuestionsOptions) => Promise<QuizQuestion[]>;
  reset: () => void;
}
function makeAlgo(name: string, build: (src: MemSource) => (o: GetQuestionsOptions) => Promise<QuizQuestion[]>): Algo {
  const src = new MemSource();
  const algo: Algo = { name, src, get: build(src), reset: () => (algo.get = build(src)) };
  return algo;
}
const makeLegacy = () => makeAlgo('legacy', (src) => {
  const svc = new LegacyQuestionService(src);
  return (o) => svc.getQuestions(o);
});
const makeNew = () => makeAlgo('new', (src) => {
  const svc = new QuestionService(src as never);
  return (o) => svc.getQuestions(o);
});
// 均匀基线：房间内没出过的题里纯随机抽，不看分类、topic 和频率
const makeUniform = () => makeAlgo('uniform', (src) => async (o) => {
  const pool = (await Promise.all([...bank.keys()].filter((c) => c !== 'examscope').map((c) => src.fetchCategoryQuestions(c)))).flat();
  const used = new Set(o.excludeIds ?? []);
  const fresh = pool.filter((q) => !used.has(q.id));
  return shuffle(fresh.length >= o.count ? fresh : pool).slice(0, o.count);
});

// ---------------- 题库解析期望（独立于 sampling.ts 的实现） ----------------
const stratumKey = (q: QuizQuestion) => `${q.category}/${q.topic ?? ''}`;

function universeFor(o: GetQuestionsOptions): QuizQuestion[] {
  const cats = o.categories?.length ? o.categories : [...bank.keys()].filter((c) => c !== 'examscope');
  let u = cats.flatMap((c) => bank.get(c) ?? []);
  if (o.difficulty && o.difficulty !== 'mixed') u = u.filter((q) => q.difficulty === o.difficulty);
  if (o.questionTypes?.length) u = u.filter((q) => o.questionTypes!.includes(q.kind));
  return u;
}

/** 分类期望 = count·w_c/Σw（w = n_c^α，保底占比分类上调），分类内按 topic 层题量比例分摊；返回每类/每层的期望题数 */
function expectedExposure(universe: QuizQuestion[], count: number) {
  const nCat = new Map<string, number>();
  const nStr = new Map<string, { cat: string; n: number }>();
  for (const q of universe) {
    nCat.set(q.category, (nCat.get(q.category) ?? 0) + 1);
    const k = stratumKey(q);
    const s = nStr.get(k) ?? { cat: q.category, n: 0 };
    s.n++;
    nStr.set(k, s);
  }
  const w = categoryWeights(nCat, SAMPLER_ALPHA);
  const z = [...w.values()].reduce((s, x) => s + x, 0);
  const cat = new Map([...w].map(([c, x]) => [c, (count * x) / z]));
  const stratum = new Map([...nStr].map(([k, s]) => [k, { n: s.n, e: cat.get(s.cat)! * (s.n / nCat.get(s.cat)!) }]));
  const capped = universe.length <= count || [...stratum.values()].some((s) => s.e > s.n);
  const pairOverlap = [...stratum.values()].reduce((t, s) => t + (s.e * s.e) / s.n, 0);
  return { nCat, cat, stratum, capped, pairOverlap };
}

// ---------------- 采集与指标 ----------------
class Collector {
  games = 0;
  slots = 0;
  q = new Map<string, number>();
  chart = new Map<string, number>();
  cat = new Map<string, number>();
  strata = new Map<string, { sum: number; min: number; max: number }>();
  maxCat: number[] = [];
  chartsPerGame: number[] = [];
  sanguo: number[] = [];
  catSeries = new Map<string, number[]>();
  readonly cats: string[];
  constructor(readonly universe: QuizQuestion[]) {
    this.cats = [...new Set(universe.map((q) => q.category))];
    for (const q of universe) this.strata.set(stratumKey(q), { sum: 0, min: Infinity, max: 0 });
  }
  add(qs: QuizQuestion[]) {
    this.games++;
    const perCat = new Map<string, number>();
    const perStratum = new Map<string, number>();
    let nChart = 0;
    let sg = 0;
    for (const q of qs) {
      this.slots++;
      const p = parseChartQuestionId(q.id);
      if (p) {
        nChart++;
        this.chart.set(p.chartId, (this.chart.get(p.chartId) ?? 0) + 1);
        continue;
      }
      this.q.set(q.id, (this.q.get(q.id) ?? 0) + 1);
      this.cat.set(q.category, (this.cat.get(q.category) ?? 0) + 1);
      perCat.set(q.category, (perCat.get(q.category) ?? 0) + 1);
      perStratum.set(stratumKey(q), (perStratum.get(stratumKey(q)) ?? 0) + 1);
      if (q.topic === '三国') sg++;
    }
    for (const [k, s] of this.strata) {
      const v = perStratum.get(k) ?? 0;
      s.sum += v;
      s.min = Math.min(s.min, v);
      s.max = Math.max(s.max, v);
    }
    for (const c of this.cats) {
      const l = this.catSeries.get(c) ?? [];
      l.push(perCat.get(c) ?? 0);
      this.catSeries.set(c, l);
    }
    this.maxCat.push(Math.max(0, ...perCat.values()));
    this.chartsPerGame.push(nChart);
    this.sanguo.push(sg);
  }
  perGame = (cat: string) => (this.cat.get(cat) ?? 0) / this.games;
}

/** 每题被抽中概率的离散度；within/noise = 分类内 CV 均值 / 该分类的二项噪声参考值均值 */
function questionStats(c: Collector) {
  const p = c.universe.map((q) => (c.q.get(q.id) ?? 0) / c.games);
  const byCat = new Map<string, number[]>();
  c.universe.forEach((q, i) => byCat.set(q.category, [...(byCat.get(q.category) ?? []), p[i]]));
  const cats = [...byCat.values()].filter((l) => l.length >= 5);
  return {
    cv: std(p) / (mean(p) || 1),
    within: mean(cats.map((l) => std(l) / (mean(l) || 1))),
    noise: mean(cats.map((l) => Math.sqrt(Math.max(0, 1 - mean(l)) / (c.games * (mean(l) || 1))))),
    zeros: p.filter((x) => x === 0).length,
  };
}

async function runStatic(algo: Algo, o: GetQuestionsOptions, games: number) {
  const c = new Collector(universeFor(o));
  for (let g = 0; g < games; g++) c.add(await algo.get({ ...o, excludeIds: [] }));
  return c;
}

const TOL = Math.max(0.05, 2.5 / Math.sqrt(GAMES)); // 层内题数只在 floor/ceil 间取值，单局方差 ≤ 1/4，均值 5σ = 2.5/√N
const ceilE = (e: number) => Math.ceil(e - 1e-9);
const floorE = (e: number) => Math.floor(e + 1e-9);

const base: GetQuestionsOptions = { categories: [], questionTypes: ['choice'], difficulty: 'mixed', count: COUNT };
const bankSize = [...bank.entries()].filter(([id]) => id !== 'examscope').reduce((n, [, l]) => n + l.length, 0);
const nTagged = [...bank.values()].flat().filter((q) => q.topic).length;
console.log(`题库 ${bankSize} 题（${nTagged} 题带 topic），榜单 ${charts.length} 张；GAMES=${GAMES} SEED=${SEED} ALPHA=${SAMPLER_ALPHA} CHART_SHARE=${CHART_SHARE}`);
if (nTagged === 0) console.log('  注意：题库没有 topic 标签，请先运行 node scripts/tag-topics.mjs');

// ============ 1. 默认局与分类/topic 均衡（A1 A2 A3） ============
async function staticSection() {
  console.log(`\n=== 1. 单局分类/topic 分布（无频率历史，每场景 ${GAMES} 局） ===`);
  const scenarios: Array<[string, GetQuestionsOptions]> = [
    ['S1 全部分类+选择题', base],
    ['S4 全部分类+选择题+hard', { ...base, difficulty: 'hard' }],
  ];
  for (const [i, [name, o]] of scenarios.entries()) {
    currentFreq = new Map();
    seed(10 + i);
    const legacy = await runStatic(makeLegacy(), o, GAMES);
    const next = await runStatic(makeNew(), o, GAMES);
    const ex = expectedExposure(next.universe, COUNT);
    const ls = questionStats(legacy);
    const ns = questionStats(next);
    console.log(`\n${name}`);
    if (ex.capped) {
      console.log('  某层期望超过容量，跳过解析期望断言');
      continue;
    }
    console.log('  分类                  题量   目标/局   legacy   new');
    for (const [cat, e] of [...ex.cat].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${cat.padEnd(20)} ${String(ex.nCat.get(cat)).padStart(5)}  ${f(e).padStart(7)}  ${f(legacy.perGame(cat)).padStart(7)}  ${f(next.perGame(cat)).padStart(6)}`);
    }
    const dev = (c: Collector) => Math.max(...[...ex.cat].map(([cat, e]) => Math.abs(c.perGame(cat) - e)));
    const maxAllowed = ceilE(Math.max(...ex.cat.values()));
    check('A1', `${name}：各分类每局题数与目标偏差 ≤ ${f(TOL, 3)}`, dev(next) <= TOL, `new 最大偏差 ${f(dev(next), 3)}，legacy ${f(dev(legacy), 3)}`);
    const inRange = [...ex.cat].every(([cat, e]) => {
      const l = next.catSeries.get(cat) ?? [];
      return Math.min(...l) >= floorE(e) && Math.max(...l) <= ceilE(e);
    });
    check('A1', `${name}：每个分类每局题数 ∈ [floor, ceil](期望)`, inRange, `${ex.cat.size} 个分类`);
    const pic = ex.cat.get('picture');
    if (pic !== undefined) {
      const l = next.catSeries.get('picture') ?? [];
      check('A8', `${name}：每局图片题 ≥ ${floorE(pic)} 道（期望 ${f(pic)}）`, Math.min(...l) >= floorE(pic) && floorE(pic) >= 1, `new ${Math.min(...l)}~${Math.max(...l)} 道，legacy ${f(legacy.perGame('picture'))}/局，最少 ${Math.min(...(legacy.catSeries.get('picture') ?? [0]))} 道`);
    }
    check('A1', `${name}：同一分类每局最多 ${maxAllowed} 题`, Math.max(...next.maxCat) <= maxAllowed, `new 最多 ${Math.max(...next.maxCat)}，legacy ${Math.max(...legacy.maxCat)}`);
    const expectedZeros = [...ex.stratum.values()].reduce((t, s) => t + s.n * Math.exp((-GAMES * s.e) / s.n), 0);
    if (expectedZeros < 0.01) check('A1', `${name}：没有从未被抽到的题`, ns.zeros === 0, `new ${ns.zeros}，legacy ${ls.zeros}`);
    else console.log(`  （局数太少，期望仍有 ${f(expectedZeros, 1)} 道题抽不到，跳过“从未抽到”断言）`);
    check('A2', `${name}：同分类内每题概率 CV ≤ 1.1 × 二项噪声`, ns.within <= 1.1 * ns.noise, `new ${f(ns.within, 3)}，噪声参考 ${f(ns.noise, 3)}，legacy ${f(ls.within, 3)}；整体 CV new ${f(ns.cv, 2)} legacy ${f(ls.cv, 2)}（α 带来的结构性差异）`);

    // A3：topic 层每局题数落在 floor/ceil(期望) 且均值等于期望
    let worstStratum = 0;
    let rangeOk = true;
    for (const [k, s] of ex.stratum) {
      const agg = next.strata.get(k)!;
      worstStratum = Math.max(worstStratum, Math.abs(agg.sum / next.games - s.e));
      if (agg.min < floorE(s.e) || agg.max > ceilE(s.e)) rangeOk = false;
    }
    check('A3', `${name}：每个 (分类, topic) 层每局题数 ∈ [floor, ceil](期望)`, rangeOk, `${ex.stratum.size} 层`);
    check('A3', `${name}：各层每局均值与期望偏差 ≤ ${f(TOL, 3)}`, worstStratum <= TOL, `最大偏差 ${f(worstStratum, 3)}`);
    if (i === 0) {
      const e = ex.stratum.get('chinese-literature/三国')?.e ?? 0;
      check('A3', 'S1：三国簇每局均值 = 期望', Math.abs(mean(next.sanguo) - e) <= TOL && e > 0, `new ${f(mean(next.sanguo))}，期望 ${f(e)}，legacy ${f(mean(legacy.sanguo))}`);
      check('A3', `S1：三国簇每局最多 ${ceilE(e)} 道`, Math.max(...next.sanguo) <= ceilE(e), `new 最多 ${Math.max(...next.sanguo)}，legacy 最多 ${Math.max(...legacy.sanguo)}`);
      const ge3 = (c: Collector) => c.sanguo.filter((x) => x >= 3).length / c.games;
      row('S1 分类每局题数与目标最大偏差', f(dev(legacy), 2), f(dev(next), 3));
      row('S1 商业财经每局题数（目标 ' + f(ex.cat.get('business') ?? 0) + '）', f(legacy.perGame('business')), f(next.perGame('business')));
      row('S1 中国文学每局题数（目标 ' + f(ex.cat.get('chinese-literature') ?? 0) + '）', f(legacy.perGame('chinese-literature')), f(next.perGame('chinese-literature')));
      row('S1 同一分类每局最多题数', String(Math.max(...legacy.maxCat)), String(Math.max(...next.maxCat)));
      row('S1 每局图片题数量（保底 ≥ ' + floorE(ex.cat.get('picture') ?? 0) + '）', f(legacy.perGame('picture')) + ' / 最少 ' + Math.min(...(legacy.catSeries.get('picture') ?? [0])), f(next.perGame('picture')) + ' / 最少 ' + Math.min(...(next.catSeries.get('picture') ?? [0])));
      row('S1 三国簇每局均值（期望 ' + f(e) + '）', f(mean(legacy.sanguo)), f(mean(next.sanguo)));
      row('S1 三国簇每局 ≥3 道的局占比', pct(ge3(legacy)), pct(ge3(next)));
      row('S1 同分类内每题概率 CV（噪声参考 ' + f(ns.noise, 3) + '）', f(ls.within, 3), f(ns.within, 3));
      row('S1 整体每题概率 CV（α 的结构性差异）', f(ls.cv, 2), f(ns.cv, 2));
    }
  }

  // 只选中国文学：分层不能压低三国单题曝光
  const lit: GetQuestionsOptions = { ...base, categories: ['chinese-literature'] };
  seed(20);
  const legacyLit = await runStatic(makeLegacy(), lit, GAMES);
  const nextLit = await runStatic(makeNew(), lit, GAMES);
  const exLit = expectedExposure(nextLit.universe, COUNT);
  const eLit = exLit.stratum.get('chinese-literature/三国')?.e ?? 0;
  console.log(`\nS2 只选中国文学：三国簇每局 new ${f(mean(nextLit.sanguo))} / legacy ${f(mean(legacyLit.sanguo))} / 期望 ${f(eLit)}`);
  check('A3', 'S2：只选中国文学时三国簇每局均值 = 期望（分层不压单题曝光，legacy 同为该期望）', eLit > 0 && Math.abs(mean(nextLit.sanguo) - eLit) <= TOL, `new ${f(mean(nextLit.sanguo))}，legacy ${f(mean(legacyLit.sanguo))}，期望 ${f(eLit)}`);
  row('S2 只选中国文学：三国簇每局均值（期望 ' + f(eLit) + '）', f(mean(legacyLit.sanguo)), f(mean(nextLit.sanguo)));
}

// ============ 2. 榜单动态题（A4） ============
async function chartSection() {
  console.log(`\n=== 2. 榜单动态题（每场景 ${GAMES} 局） ===`);
  const mixed: GetQuestionsOptions = { ...base, questionTypes: ['choice', 'ranking'] };
  currentFreq = new Map();
  seed(30);
  const legacy = await runStatic(makeLegacy(), mixed, GAMES);
  const next = await runStatic(makeNew(), mixed, GAMES);
  const ex = expectedExposure(next.universe, COUNT);
  const eChart = (ex.cat.get('ranking') ?? 0) * CHART_SHARE;
  const tol = 3.5 / Math.sqrt(GAMES); // nChart 单局方差 < 0.5，均值 5σ ≈ 3.5/√N
  const perChart = eChart / charts.length;
  const rates = charts.map((c) => (next.chart.get(c.id) ?? 0) / next.games);
  const rateTol = 5 * Math.sqrt((perChart * (1 - perChart)) / GAMES);
  console.log(`\nS3a 全部分类+选择+排序：榜单题/局 new ${f(mean(next.chartsPerGame))}（期望 ${f(eChart)}）legacy ${f(mean(legacy.chartsPerGame))}；每张榜单出现率 ${f(Math.min(...rates), 3)}~${f(Math.max(...rates), 3)}（期望 ${f(perChart, 3)}）`);
  check('A4', `混合局榜单题每局均值 = 期望 ${f(eChart)}`, Math.abs(mean(next.chartsPerGame) - eChart) <= tol, `new ${f(mean(next.chartsPerGame))}，legacy ${f(mean(legacy.chartsPerGame))}`);
  check('A4', '混合局每张榜单每局出现率 = 期望', rates.every((r) => Math.abs(r - perChart) <= rateTol), `${f(Math.min(...rates), 3)}~${f(Math.max(...rates), 3)}，期望 ${f(perChart, 3)}±${f(rateTol, 3)}`);
  row('S3a 混合局榜单题每局数量（期望 ' + f(eChart) + '）', f(mean(legacy.chartsPerGame)), f(mean(next.chartsPerGame)));
  const lr = charts.map((c) => (legacy.chart.get(c.id) ?? 0) / legacy.games);
  row('S3a 每张榜单每局出现率', `${f(Math.min(...lr), 3)}~${f(Math.max(...lr), 3)}`, `${f(Math.min(...rates), 3)}~${f(Math.max(...rates), 3)}`);

  const only: GetQuestionsOptions = { ...base, questionTypes: ['ranking'] };
  const nChartExpected = Math.min(charts.length, Math.max(1, Math.round(COUNT * CHART_SHARE)));
  const algo = makeNew();
  const onlyRuns = new Collector(universeFor(only));
  let lengthOk = true;
  for (let g = 0; g < 300; g++) {
    const qs = await algo.get({ ...only, excludeIds: [] });
    lengthOk &&= qs.length === COUNT;
    onlyRuns.add(qs);
  }
  const ok = lengthOk && onlyRuns.chartsPerGame.every((n) => n === nChartExpected);
  check('A4', `纯排序局：每局 ${nChartExpected} 张榜单 + ${COUNT - nChartExpected} 道静态排序题`, ok, `榜单题 ${Math.min(...onlyRuns.chartsPerGame)}~${Math.max(...onlyRuns.chartsPerGame)}/局`);
}

// ============ 3. 同房间连续多局（A5） ============
async function roomSection() {
  console.log('\n=== 3. 同房间连续 4 局（excludeIds 累积，每场景 300 个房间） ===');
  const scenarios: Array<[string, GetQuestionsOptions]> = [
    ['mythology', { ...base, categories: ['mythology'] }],
    ['general', { ...base, categories: ['general'] }],
    ['chinese-history+hard', { ...base, categories: ['chinese-history'], difficulty: 'hard' }],
  ];
  for (const [name, o] of scenarios) {
    if (!o.categories!.every((c) => bank.has(c))) continue;
    const pool = new Set(universeFor(o).map((q) => q.id));
    const P = pool.size;
    const out = new Map<string, { fresh: number[][]; overlap: number[][]; bad: number }>();
    for (const algo of [makeLegacy(), makeNew()]) {
      seed(40);
      const acc = { fresh: [[], [], [], []] as number[][], overlap: [[], [], [], []] as number[][], bad: 0 };
      for (let room = 0; room < 300; room++) {
        const used: string[] = [];
        let prev = new Set<string>();
        for (let g = 0; g < 4; g++) {
          const qs = await algo.get({ ...o, excludeIds: used });
          const seen = new Set(used);
          const ids = qs.map((q) => q.id);
          const fresh = ids.filter((id) => !seen.has(id)).length;
          const overlap = ids.filter((id) => prev.has(id)).length;
          const returned = Math.min(COUNT, P);
          const optimalFresh = Math.min(returned, P - seen.size);
          const forcedOverlap = g === 0 ? 0 : Math.max(0, returned - (P - prev.size));
          if (fresh !== optimalFresh || overlap !== forcedOverlap || ids.length !== returned) acc.bad++;
          acc.fresh[g].push(fresh);
          acc.overlap[g].push(overlap);
          prev = new Set(ids);
          used.push(...ids);
        }
      }
      out.set(algo.name, acc);
    }
    const line = (k: 'fresh' | 'overlap', a: { fresh: number[][]; overlap: number[][] }) => a[k].map((l) => f(mean(l), 1)).join('/');
    const lg = out.get('legacy')!;
    const nw = out.get('new')!;
    console.log(`  ${name}（池子 ${P} 题）每局新题数 legacy ${line('fresh', lg)}  new ${line('fresh', nw)}；与上一局重复 legacy ${line('overlap', lg)}  new ${line('overlap', nw)}`);
    check('A5', `${name}：4 局新题数达到理论最优且与上一局重复数不超过被迫值`, nw.bad === 0, `池子 ${P} 题，违规 ${nw.bad} 局`);
    row(`房间连续 4 局新题数：${name}（池子 ${P}）`, line('fresh', lg), line('fresh', nw));
    row(`房间连续 4 局与上一局重复：${name}`, line('overlap', lg), line('overlap', nw));
  }
}

// ============ 4. 演化：事件流 + 频率滞后 + 并发房间 ============
const DAY = 86400_000;
const GAME_MS = (3.2 + COUNT * 24.5) * 1000;
const LOBBY_MS = 60_000;

function samplePlayers(): number {
  const u = Math.random();
  const cum: Array<[number, number]> = [[0.2, 1], [0.35, 2], [0.5, 3], [0.65, 4], [0.75, 5], [0.85, 6], [0.9, 7], [1, 8]];
  return cum.find(([p]) => u < p)![1];
}

interface Showing { id: string; t: number; k: number }

/** 一次出镜 = k 位玩家各上报一行。维护三种频率表：旧口径 30 天 Σ人数、旧查询实际拿到的最旧 1000 行、新口径最近 5000 行去重 */
class EventLog {
  private pending: Showing[] = [];
  private log: Showing[] = [];
  private head = 0;
  ideal = new Map<string, number>();
  private old = { end: 0, rows: 0, map: new Map<string, number>() };
  private recent = { start: 0, rows: 0, map: new Map<string, number>() };
  private static OLD_ROWS = 1000;
  private static RECENT_ROWS = 5000;

  schedule(s: Showing) {
    const h = this.pending;
    h.push(s);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].t <= h[i].t) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  private pop(): Showing {
    const h = this.pending;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        let m = i;
        if (l < h.length && h[l].t < h[m].t) m = l;
        if (l + 1 < h.length && h[l + 1].t < h[m].t) m = l + 1;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
  private inc(m: Map<string, number>, id: string, d: number) {
    const v = (m.get(id) ?? 0) + d;
    if (v <= 0) m.delete(id);
    else m.set(id, v);
  }
  advance(t: number) {
    while (this.pending.length && this.pending[0].t <= t) {
      const s = this.pop();
      this.log.push(s);
      this.inc(this.ideal, s.id, s.k);
      const r = this.recent;
      this.inc(r.map, s.id, 1);
      r.rows += s.k;
      while (r.rows > EventLog.RECENT_ROWS && r.start < this.log.length) {
        const o = this.log[r.start++];
        this.inc(r.map, o.id, -1);
        r.rows -= o.k;
      }
    }
    while (this.head < this.log.length && this.log[this.head].t < t - 30 * DAY) {
      const s = this.log[this.head];
      this.inc(this.ideal, s.id, -s.k);
      if (this.head < this.old.end) {
        this.inc(this.old.map, s.id, -s.k);
        this.old.rows -= s.k;
      }
      if (this.recent.start === this.head) {
        this.inc(this.recent.map, s.id, -1);
        this.recent.rows -= s.k;
        this.recent.start++;
      }
      this.head++;
    }
    const o = this.old;
    if (o.end < this.head) o.end = this.head;
    while (o.end < this.log.length && o.rows + this.log[o.end].k <= EventLog.OLD_ROWS) {
      const s = this.log[o.end++];
      this.inc(o.map, s.id, s.k);
      o.rows += s.k;
    }
  }
  table(mode: FreqMode): ReadonlyMap<string, number> {
    return mode === 'ideal' ? this.ideal : mode === 'old1000' ? this.old.map : mode === 'recent5000' ? this.recent.map : new Map();
  }
}

type FreqMode = 'ideal' | 'old1000' | 'recent5000' | 'none';

interface EvolveCfg { gamesPerDay: number; warmDays: number; measureDays: number; hide?: Set<string>; unhideAtDay?: number }

async function evolve(algo: Algo, mode: FreqMode, cfg: EvolveCfg) {
  const ev = new EventLog();
  const o: GetQuestionsOptions = base;
  const roomRate = cfg.gamesPerDay / 2 / DAY; // 每房平均 2 局
  const end = (cfg.warmDays + cfg.measureDays) * DAY;
  const gamesPerRoom: Array<[number, number]> = [[0.4, 1], [0.7, 2], [0.9, 3], [1, 4]];
  interface Start { t: number; room: { used: string[]; left: number } }
  const queue: Start[] = [];
  for (let t = 0; ; ) {
    t += -Math.log(1 - Math.random()) / roomRate;
    if (t > end) break;
    const u = Math.random();
    queue.push({ t, room: { used: [], left: gamesPerRoom.find(([p]) => u < p)![1] } });
  }
  const c = new Collector(universeFor(o));
  const recent: Array<Set<string>> = [];
  const overlapRecent: number[] = [];
  const batchShare: number[] = [];
  if (cfg.hide) algo.src.hidden = new Set(cfg.hide);
  let lastT = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const s = queue[qi];
    lastT = s.t;
    if (cfg.hide && cfg.unhideAtDay != null && s.t >= cfg.unhideAtDay * DAY && algo.src.hidden.size) {
      algo.src.hidden = new Set();
      algo.reset();
    }
    ev.advance(s.t);
    currentFreq = ev.table(mode);
    const qs = await algo.get({ ...o, excludeIds: s.room.used });
    const k = samplePlayers();
    qs.forEach((q, i) => ev.schedule({ id: q.id, t: s.t + (3.2 + i * 24.5 + 20.3) * 1000, k }));
    const ids = qs.map((q) => q.id);
    if (s.t >= cfg.warmDays * DAY) {
      c.add(qs);
      overlapRecent.push(mean(recent.map((set) => ids.filter((id) => set.has(id)).length)));
      if (cfg.hide) batchShare.push(ids.filter((id) => cfg.hide!.has(id)).length / ids.length);
    }
    recent.push(new Set(ids));
    if (recent.length > 3) recent.shift();
    s.room.used.push(...ids);
    if (--s.room.left > 0) {
      const nt = s.t + GAME_MS + LOBBY_MS;
      let j = qi + 1;
      while (j < queue.length && queue[j].t < nt) j++;
      queue.splice(j, 0, { t: nt, room: s.room });
    }
  }
  ev.advance(lastT + GAME_MS);
  return { c, ev, overlap: mean(overlapRecent), batchShare, stats: questionStats(c) };
}

async function evolveSection() {
  const measureDays = Math.max(10, Math.round(GAMES / 60));
  const cfg: EvolveCfg = { gamesPerDay: 30, warmDays: 30, measureDays };
  console.log(`\n=== 4. 演化：30 局/天，预热 30 天，观测 ${measureDays} 天（每房 1-4 局，每题平均 3.8 位玩家上报） ===`);
  const variants: Array<[string, Algo, FreqMode]> = [
    ['legacy / 30 天 Σ人数（max-rows 足够大时）', makeLegacy(), 'ideal'],
    ['legacy / 最旧 1000 行（Supabase 默认 max-rows 的实际表现）', makeLegacy(), 'old1000'],
    ['new / 最近 5000 行去重出镜', makeNew(), 'recent5000'],
    ['uniform 均匀基线', makeUniform(), 'none'],
  ];
  const res: Array<Awaited<ReturnType<typeof evolve>>> = [];
  for (const [name, algo, mode] of variants) {
    seed(50);
    const r = await evolve(algo, mode, cfg);
    res.push(r);
    console.log(`  ${name}\n     局 ${r.c.games}，同分类内 CV ${f(r.stats.within, 3)}（噪声参考 ${f(r.stats.noise, 3)}），从未抽到 ${r.stats.zeros}，与前 3 局平均重复 ${f(r.overlap, 3)}，三国簇/局 ${f(mean(r.c.sanguo))}`);
  }
  const [legacyIdeal, legacyOld, next, uniform] = res;
  check('A6', '演化：同分类内 CV 明显低于均匀基线（≤ 0.8 ×）', next.stats.within <= 0.8 * uniform.stats.within, `new ${f(next.stats.within, 3)}，uniform ${f(uniform.stats.within, 3)}，legacy ${f(legacyIdeal.stats.within, 3)}/${f(legacyOld.stats.within, 3)}`);
  check('A6', '演化：与前 3 局平均重复不高于均匀基线（≤ 1.05 ×）', next.overlap <= 1.05 * uniform.overlap, `new ${f(next.overlap, 3)}，uniform ${f(uniform.overlap, 3)}，legacy ${f(legacyIdeal.overlap, 3)}/${f(legacyOld.overlap, 3)}`);
  row('演化 同分类内每题概率 CV（legacy=30天Σ人数 / 最旧1000行）', `${f(legacyIdeal.stats.within, 3)} / ${f(legacyOld.stats.within, 3)}`, `${f(next.stats.within, 3)}（均匀基线 ${f(uniform.stats.within, 3)}）`);
  row('演化 与前 3 局平均重复题数', `${f(legacyIdeal.overlap, 3)} / ${f(legacyOld.overlap, 3)}`, `${f(next.overlap, 3)}（均匀基线 ${f(uniform.overlap, 3)}）`);

  // 羊群：同一张频率表下 10 个房间同时开局
  const trials = Math.max(50, Math.round(GAMES / 40));
  const ex = expectedExposure(next.c.universe, COUNT);
  const uniformPair = (COUNT * COUNT) / next.c.universe.length;
  const herd = new Map<string, number>();
  console.log(`\n  羊群：同一张频率表下 10 个房间同时开局（${trials} 次，两两平均重复题数；均匀随机 ${f(uniformPair, 2)}，α 均衡下独立抽样的期望 ${f(ex.pairOverlap, 2)}）`);
  for (const [name, algo, mode, r] of [
    ['legacy / 30 天 Σ人数', variants[0][1], 'ideal', legacyIdeal],
    ['legacy / 最旧 1000 行', variants[1][1], 'old1000', legacyOld],
    ['new / 最近 5000 行去重', variants[2][1], 'recent5000', next],
  ] as Array<[string, Algo, FreqMode, typeof next]>) {
    seed(60);
    currentFreq = r.ev.table(mode);
    const ov: number[] = [];
    for (let t = 0; t < trials; t++) {
      const sets: Set<string>[] = [];
      for (let i = 0; i < 10; i++) sets.push(new Set((await algo.get({ ...base, excludeIds: [] })).map((q) => q.id)));
      for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) ov.push([...sets[i]].filter((x) => sets[j].has(x)).length);
    }
    herd.set(name, mean(ov));
    console.log(`     ${name.padEnd(24)} ${f(mean(ov), 2)}`);
  }
  const nh = herd.get('new / 最近 5000 行去重')!;
  const herdLimit = 1.5 * ex.pairOverlap;
  check('A6', '并发房间：同一频率表下两两重复 ≤ 1.5 × 独立抽样期望', nh <= herdLimit, `new ${f(nh, 2)} ≤ ${f(herdLimit, 2)}；legacy ${f(herd.get('legacy / 30 天 Σ人数')!, 2)}`);
  row('并发 10 房间同一频率表：两两平均重复题数', `${f(herd.get('legacy / 30 天 Σ人数')!, 2)} / ${f(herd.get('legacy / 最旧 1000 行')!, 2)}`, `${f(nh, 2)}（均匀 ${f(uniformPair, 2)}）`);
  currentFreq = new Map();
}

// ============ 5. 新题批次上线 ============
async function batchSection() {
  const lit = bank.get('chinese-literature')!;
  const idNo = (q: QuizQuestion) => Number(q.id.split('-').pop());
  const hide = new Set([...lit].sort((a, b) => idNo(a) - idNo(b)).slice(Math.floor(lit.length / 2)).map((q) => q.id));
  const ex = expectedExposure(universeFor(base), COUNT);
  const litShare = (ex.cat.get('chinese-literature') ?? 0) / COUNT;
  const limit = 0.8 * litShare; // 新批次最多占中国文学名额，再留 20% 余量；legacy 会吃到 70%
  const reps = 5;
  console.log(`\n=== 5. 新题批次上线：中国文学后半（${hide.size} 题）晚 30 天上线，5 局/天，上线后前 10 局，${reps} 次重复 ===`);
  const shares = new Map<string, number[]>();
  for (const [name, mk, mode] of [
    ['legacy / 30 天 Σ人数', makeLegacy, 'ideal'],
    ['legacy / 最旧 1000 行', makeLegacy, 'old1000'],
    ['new / 最近 5000 行去重', makeNew, 'recent5000'],
  ] as Array<[string, () => Algo, FreqMode]>) {
    const first10: number[] = [];
    for (let rep = 0; rep < reps; rep++) {
      seed(70 + rep);
      const r = await evolve(mk(), mode, { gamesPerDay: 5, warmDays: 30, measureDays: 5, hide, unhideAtDay: 30 });
      first10.push(mean(r.batchShare.slice(0, 10)));
    }
    shares.set(name, first10);
    console.log(`  ${name.padEnd(24)} 新批次占前 10 局的比例 ${pct(mean(first10))}（题量占比 ${pct(hide.size / bankSize)}，中国文学名额上限 ${pct(litShare)}）`);
  }
  const nb = mean(shares.get('new / 最近 5000 行去重')!);
  check('A6', `新批次上线后前 10 局占比 ≤ ${pct(limit)}`, nb <= limit, `new ${pct(nb)}，legacy ${pct(mean(shares.get('legacy / 30 天 Σ人数')!))} / ${pct(mean(shares.get('legacy / 最旧 1000 行')!))}`);
  row('新批次上线后前 10 局占比', `${pct(mean(shares.get('legacy / 30 天 Σ人数')!))} / ${pct(mean(shares.get('legacy / 最旧 1000 行')!))}`, `${pct(nb)}（题量占比 ${pct(hide.size / bankSize)}）`);
}

// ============ 6. 冻结的频率快照 ============
async function frozenSection() {
  console.log(`\n=== 6. 冻结的频率快照（模拟只拿到最旧 20000 行且长期不变），S1 ${GAMES} 局 ===`);
  seed(80);
  const pool = universeFor(base);
  const legacyTable = new Map<string, number>();
  const nextTable = new Map<string, number>();
  for (let rows = 0; rows < 20000; ) {
    const q = pool[Math.floor(Math.random() * pool.length)];
    const k = samplePlayers();
    legacyTable.set(q.id, (legacyTable.get(q.id) ?? 0) + k);
    nextTable.set(q.id, (nextTable.get(q.id) ?? 0) + 1);
    rows += k;
  }
  currentFreq = legacyTable;
  const legacy = questionStats(await runStatic(makeLegacy(), base, GAMES));
  currentFreq = nextTable;
  const next = questionStats(await runStatic(makeNew(), base, GAMES));
  currentFreq = new Map();
  console.log(`  从未被抽到的题：legacy ${legacy.zeros}/${pool.length}，new ${next.zeros}/${pool.length}`);
  row('冻结频率快照下从未被抽到的题数', `${legacy.zeros}/${pool.length}`, `${next.zeros}/${pool.length}`);
}

// ============ 7. 选项洗牌 ============
function shuffleSection() {
  console.log('\n=== 7. 选项洗牌：原正确下标 → 洗牌后下标（每个原下标 40000 次） ===');
  seed(90);
  const N = 40000;
  const q = (j: number) => ({ id: 'x', category: 'c', difficulty: 'easy', kind: 'choice', question: 'q', options: ['A', 'B', 'C', 'D'], correctAnswer: j }) as QuizQuestion;
  const tol = 4.5 * Math.sqrt((0.25 * 0.75) / N);
  let worst = 0;
  let legacyWorst = 0;
  for (let j = 0; j < 4; j++) {
    const cnt = [0, 0, 0, 0];
    const old = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      cnt[(shuffleQuestionOptions(q(j)) as { correctAnswer: number }).correctAnswer]++;
      old[[0, 1, 2, 3].sort(() => Math.random() - 0.5).indexOf(j)]++;
    }
    worst = Math.max(worst, ...cnt.map((x) => Math.abs(x / N - 0.25)));
    legacyWorst = Math.max(legacyWorst, ...old.map((x) => Math.abs(x / N - 0.25)));
  }
  check('H6', `洗牌后每个位置概率 = 25% ± ${pct(tol, 2)}`, worst <= tol, `new 最大偏差 ${pct(worst, 2)}，旧 sort 洗牌 ${pct(legacyWorst, 2)}`);
  row('选项洗牌：任一位置概率与 25% 的最大偏差', pct(legacyWorst, 1), pct(worst, 1));
}

const started = Date.now();
await staticSection();
await chartSection();
await roomSection();
await evolveSection();
await batchSection();
await frozenSection();
shuffleSection();

console.log('\n=== 前后对比 ===');
const w = Math.max(...summary.map(([l]) => l.length)) + 2;
console.log(`${'指标'.padEnd(w)}${'legacy'.padEnd(24)}new`);
for (const [label, l, n] of summary) console.log(`${label.padEnd(w)}${l.padEnd(24)}${n}`);
console.log(`\n${failures === 0 ? '全部断言通过' : `${failures} 项断言失败`}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`);
process.exit(failures === 0 ? 0 : 1);
