import type { CategoryMeta, Difficulty, QuestionKind, QuizQuestion } from '../types/game';
import { shuffle } from '../utils/random';

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

  constructor(private source: QuestionSource) {}

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

  /** 随机抽取题目 */
  async getQuestions(opts: GetQuestionsOptions): Promise<QuizQuestion[]> {
    const { categories, difficulty = 'mixed', questionTypes = [], count, excludeIds = [] } = opts;
    const cats = categories?.length ? categories : (await this.listCategories()).map((c) => c.id);
    const pools = await Promise.all(cats.map((c) => this.getCategoryQuestions(c)));
    let all = pools.flat();
    if (difficulty !== 'mixed') all = all.filter((q) => q.difficulty === difficulty);
    if (questionTypes.length > 0) all = all.filter((q) => questionTypes.includes(q.kind));
    const excluded = new Set(excludeIds);
    const fresh = all.filter((q) => !excluded.has(q.id));
    const pool = fresh.length >= count ? fresh : all; // 不够时允许重复利用
    return shuffle(pool).slice(0, count);
  }

  /** 按 id 批量取回完整题目（房主迁移时用于重建题目数据） */
  async getByIds(ids: string[], categories: string[]): Promise<Map<string, QuizQuestion>> {
    const cats = categories.length ? categories : (await this.listCategories()).map((c) => c.id);
    const pools = await Promise.all(cats.map((c) => this.getCategoryQuestions(c)));
    const map = new Map<string, QuizQuestion>();
    for (const q of pools.flat()) if (ids.includes(q.id)) map.set(q.id, q);
    return map;
  }
}

/** 全局单例；未来可将 JsonQuestionSource 替换为 ApiQuestionSource */
export const questionService = new QuestionService(new JsonQuestionSource());
