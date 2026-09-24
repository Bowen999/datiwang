import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from './realtime';
import { countShowings } from './sampling';

const LOCAL_EVENTS_KEY = 'datiwang:stats:events:v1';
const CACHE_TTL_MS = 30_000;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// Supabase 默认 Max rows = 1000，单次请求拿不到更多，所以分页并行取最近的行
const FREQ_PAGE_ROWS = 1000;
const FREQ_PAGES = 5;
const SHOW_GAP_MS = 120_000;

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

interface StatsEvent {
  eventType: string;
  detail?: Record<string, unknown>;
  createdAt?: string;
}

/**
 * 全局题目频率服务：
 * - Supabase 模式：从 visit_events 表读取最近的 question_answered 事件
 * - 本地演示模式：从 localStorage 的统计事件缓存里统计
 *
 * 每位玩家各上报一次 question_answered，所以同一题相邻 SHOW_GAP_MS 内的事件合并成一次出镜，
 * 频率 = 去重后的出镜次数，与在线人数无关。QuestionService 抽题时用它降低高频题的权重。
 */
export class QuestionFrequencyService {
  readonly mode: 'supabase' | 'local';
  private client: SupabaseClient | null = null;
  private cache: Map<string, number> | null = null;
  private cachedAt = 0;

  constructor() {
    this.mode = isSupabaseConfigured ? 'supabase' : 'local';
    if (this.mode === 'supabase' && isSupabaseConfigured) {
      const url = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      this.client = createClient(url, anonKey);
    }
  }

  /** 获取每道题的去重出镜次数（带缓存） */
  async getFrequencyMap(): Promise<Map<string, number>> {
    const now = Date.now();
    if (this.cache && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cache;
    }

    const map = this.mode === 'supabase' ? await this.fetchRemote() : this.readLocal();
    this.cache = map;
    this.cachedAt = now;
    return map;
  }

  /** 清空本地缓存，下次重新拉取 */
  clearCache(): void {
    this.cache = null;
    this.cachedAt = 0;
  }

  private async fetchRemote(): Promise<Map<string, number>> {
    const client = this.client;
    if (!client) return new Map();

    const fromISO = new Date(Date.now() - WINDOW_MS).toISOString();
    // 按时间倒序分页并行拉取，某页失败就跳过，最坏退化成空表（均匀抽样）
    const pages = await Promise.all(
      Array.from({ length: FREQ_PAGES }, async (_, i) => {
        try {
          const { data, error } = await client
            .from('visit_events')
            .select('detail, created_at')
            .eq('event_type', 'question_answered')
            .gte('created_at', fromISO)
            .order('created_at', { ascending: false })
            .range(i * FREQ_PAGE_ROWS, (i + 1) * FREQ_PAGE_ROWS - 1);
          if (error) {
            console.warn('拉取题目频率失败', error);
            return [];
          }
          return data ?? [];
        } catch (e) {
          console.warn('拉取题目频率失败', e);
          return [];
        }
      }),
    );

    const events: Array<{ id: string; t: number }> = [];
    for (const row of pages.flat()) {
      const id = (row.detail as Record<string, unknown> | null)?.questionId;
      if (typeof id === 'string' && id) events.push({ id, t: Date.parse(row.created_at as string) });
    }
    return countShowings(events, SHOW_GAP_MS);
  }

  private readLocal(): Map<string, number> {
    const raw = safeGet(LOCAL_EVENTS_KEY);
    if (!raw) return new Map();

    const events: Array<{ id: string; t: number }> = [];
    try {
      const list = JSON.parse(raw) as StatsEvent[];
      for (const ev of list) {
        if (ev.eventType !== 'question_answered') continue;
        const id = ev.detail?.questionId;
        if (typeof id === 'string' && id) events.push({ id, t: Date.parse(ev.createdAt ?? '') });
      }
    } catch {
      /* ignore */
    }
    return countShowings(events, SHOW_GAP_MS);
  }
}

/** 全局单例 */
export const questionFrequencyService = new QuestionFrequencyService();
