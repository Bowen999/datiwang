import type { CategoryMeta, Difficulty, QuestionKind, QuizQuestion, RankChart } from '../types/game';
import { shuffle } from '../utils/random';
import { buildChartQuestion, chartQuestionId, parseChartQuestionId } from '../game/charts';
import { questionFrequencyService } from './QuestionFrequencyService';
import { CHART_SHARE, chartFrequency, chartHistory, chartKey, sampleBalanced } from './sampling';

/**
 * 题目数据源接口。
 * 任何实现了该接口的来源（本地 JSON、REST API、数据库……）
 * 都可以直接替换，UI 与游戏逻辑无需改动。
 */
export interface QuestionSource {
  listCategories(): Promise<CategoryMeta[]>;
  fetchCategoryQuestions(categoryId: string): Promise<QuizQuestion[]>;
}

/** 旧题库可能未声明 kind，统一补默认值「选择题」，避免全量改数据文件 */
function normalizeQuestion(q: QuizQuestion): QuizQuestion {
  return q.kind === 'ranking' ? q : { ...q, kind: 'choice' };
}

/** 默认数据源：静态 JSON 文件，目录结构 /questions/{category}.json */
export class JsonQuestionSource implements QuestionSource {
  constructor(private baseUrl = '/questions') {}

  async listCategories(): Promise<CategoryMeta[]> {
    const res = await fetch(`${this.baseUrl}/index.json`);
    if (!res.ok) throw new Error('题库索引加载失败');
    const data = (await res.json()) as { categories: CategoryMeta[] };
    return data.categories;
  }

  async fetchCategoryQuestions(categoryId: string): Promise<QuizQuestion[]> {
    const res = await fetch(`${this.baseUrl}/${categoryId}.json`);
    if (!res.ok) throw new Error(`题库加载失败: ${categoryId}`);
    const raw = (await res.json()) as QuizQuestion[];
    return raw.map(normalizeQuestion);
  }

  /** 排行榜数据源（rankcharts.json 或由外部提供） */
  async fetchRankCharts(): Promise<RankChart[]> {
    const res = await fetch(`${this.baseUrl}/rankcharts.json`);
    if (!res.ok) throw new Error('排行榜加载失败');
    return (await res.json()) as RankChart[];
  }
}

export interface GetQuestionsOptions {
  /** 选中的分类；为空表示全部 */
  categories?: string[];
  /** 难度筛选；mixed 表示不限 */
  difficulty?: Difficulty | 'mixed';
  /** 勾选的题目类型；为空表示全部 */
  questionTypes?: QuestionKind[];
  /** 需要的题目数量 */
  count: number;
  /** 需要排除的题目 id（例如上一局已用过） */
  excludeIds?: string[];
}

/** 题目服务：带缓存、随机抽题，数据来源可整体替换 */
export class QuestionService {
  private cache = new Map<string, QuizQuestion[]>();
  private chartCache?: RankChart[];

  constructor(private source: JsonQuestionSource) {}

  listCategories(): Promise<CategoryMeta[]> {
    return this.source.listCategories();
  }

  async getCategoryQuestions(categoryId: string): Promise<QuizQuestion[]> {
    const cached = this.cache.get(categoryId);
    if (cached) return cached;
    const questions = await this.source.fetchCategoryQuestions(categoryId);
    this.cache.set(categoryId, questions);
    return questions;
  }

  /** 读取全部排行榜（带缓存）。失败返回空数组，让抽题回退到纯静态题库。 */
  async getCharts(): Promise<RankChart[]> {
    if (this.chartCache) return this.chartCache;
    try {
      this.chartCache = await this.source.fetchRankCharts();
    } catch {
      this.chartCache = [];
    }
    return this.chartCache;
  }

  /** 随机抽取题目（含排行榜动态排序题）：按分类/topic 分层抽样，层内按全局出镜频率降权 */
  async getQuestions(opts: GetQuestionsOptions): Promise<QuizQuestion[]> {
    const { categories, difficulty = 'mixed', questionTypes = [], count, excludeIds = [] } = opts;
    const allCats = (await this.listCategories()).map((c) => c.id);
    const cats = categories?.length ? categories : allCats.filter((c) => c !== 'examscope');
    const pools = await Promise.all(cats.map((c) => this.getCategoryQuestions(c)));
    let all = pools.flat();
    if (difficulty !== 'mixed') all = all.filter((q) => q.difficulty === difficulty);
    if (questionTypes.length > 0) all = all.filter((q) => questionTypes.includes(q.kind));
    const freq = await questionFrequencyService.getFrequencyMap();

    // 动态榜单题：题型含排序 且 分类含「排名题」（或未限定分类=全部）时才生成，
    // 与静态排序题共用同一个分类开关，行为一致。
    const rankingWanted = questionTypes.length === 0 || questionTypes.includes('ranking');
    const rankingOnly = questionTypes.length === 1 && questionTypes[0] === 'ranking';
    const charts =
      rankingWanted && cats.includes('ranking') && count > 0
        ? (await this.getCharts()).filter((c) => difficulty === 'mixed' || c.difficulty === difficulty)
        : [];

    let picked: QuizQuestion[];
    let nChart = 0;
    if (charts.length > 0 && rankingOnly) {
      // 纯排序局：榜单题占半局，其余从静态排序题补满
      nChart = Math.min(charts.length, Math.max(1, Math.round(count * CHART_SHARE)));
      picked = sampleBalanced(all, { count: count - nChart, history: excludeIds, freq });
    } else {
      picked = sampleBalanced(all, { count, history: excludeIds, freq });
      if (charts.length > 0) {
        // 混合局：抽中的每个排名题名额有 CHART_SHARE 的概率换成榜单题，榜单题量跟着分类配额走
        const slots = picked.filter((q) => q.category === 'ranking');
        nChart = Math.min(charts.length, slots.filter(() => Math.random() < CHART_SHARE).length);
        const dropped = new Set(shuffle(slots).slice(0, nChart));
        picked = picked.filter((q) => !dropped.has(q));
      }
    }

    const dynamic = this.pickChartQuestions(charts, nChart, excludeIds, freq);
    return shuffle([...picked, ...dynamic]).slice(0, count);
  }

  /** 先按榜单级历史/频率选出 n 张榜单，再为每张随机取样（尽量避开本房间出过的样本） */
  private pickChartQuestions(
    charts: RankChart[],
    n: number,
    excludeIds: readonly string[],
    freq: ReadonlyMap<string, number>,
  ): QuizQuestion[] {
    if (n <= 0 || charts.length === 0) return [];
    const candidates = charts.map((chart) => ({ id: chartKey(chart.id), category: 'chart', chart }));
    const chosen = sampleBalanced(candidates, {
      count: n,
      history: chartHistory(excludeIds),
      freq: chartFrequency(freq),
    });
    const excluded = new Set(excludeIds);
    return chosen.map(({ chart }) => {
      let sampleId = randomChartSampleId();
      let id = chartQuestionId(chart.id, sampleId);
      for (let tries = 0; tries < 40 && excluded.has(id); tries++) {
        sampleId = randomChartSampleId();
        id = chartQuestionId(chart.id, sampleId);
      }
      excluded.add(id);
      return buildChartQuestion(chart, sampleId);
    });
  }

  /** 按 id 批量取回完整题目（房主迁移时用于重建题目数据，含排行榜动态题重建） */
  async getByIds(ids: string[], categories: string[]): Promise<Map<string, QuizQuestion>> {
    const cats = categories.length ? categories : (await this.listCategories()).map((c) => c.id);
    const pools = await Promise.all(cats.map((c) => this.getCategoryQuestions(c)));
    const map = new Map<string, QuizQuestion>();
    for (const q of pools.flat()) if (ids.includes(q.id)) map.set(q.id, q);

    // 排行榜动态题不在任何分类 JSON 中，按 id 确定性重建（同 id 必同题）
    const charts = await this.getCharts();
    for (const id of ids) {
      if (map.has(id)) continue;
      const parsed = parseChartQuestionId(id);
      if (!parsed) continue;
      const chart = charts.find((c) => c.id === parsed.chartId);
      if (chart) map.set(id, buildChartQuestion(chart, parsed.sampleId));
    }
    return map;
  }
}

function randomChartSampleId(): number {
  return 100000 + Math.floor(Math.random() * 900000);
}

/** 全局单例；未来可将 JsonQuestionSource 替换为 ApiQuestionSource */
export const questionService = new QuestionService(new JsonQuestionSource());