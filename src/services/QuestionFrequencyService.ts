import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from './realtime';

const LOCAL_EVENTS_KEY = 'datiwang:stats:events:v1';
const CACHE_TTL_MS = 30_000;

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
}

/**
 * 全局题目频率服务：
 * - Supabase 模式：从 visit_events 表读取 question_answered 事件，统计每道题被出的次数
 * - 本地演示模式：从 localStorage 的统计事件缓存里统计
 *
 * 频率用于 QuestionService 抽题时降低高频率题目的权重，从而减少全站重复出题。
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

  /** 获取每道题的出镜次数（带缓存） */
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
    const map = new Map<string, number>();
    if (!this.client) return map;

    // 只拉近 30 天的 question_answered 事件，避免数据量过大
    const fromISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from('visit_events')
      .select('detail')
      .eq('event_type', 'question_answered')
      .gte('created_at', fromISO)
      .limit(20000);

    if (error) {
      console.warn('拉取题目频率失败', error);
      return map;
    }

    for (const row of data ?? []) {
      const id = (row.detail as Record<string, unknown> | null)?.questionId;
      if (typeof id === 'string' && id) {
        map.set(id, (map.get(id) ?? 0) + 1);
      }
    }
    return map;
  }

  private readLocal(): Map<string, number> {
    const map = new Map<string, number>();
    const raw = safeGet(LOCAL_EVENTS_KEY);
    if (!raw) return map;

    try {
      const list = JSON.parse(raw) as StatsEvent[];
      for (const ev of list) {
        if (ev.eventType !== 'question_answered') continue;
        const id = ev.detail?.questionId;
        if (typeof id === 'string' && id) {
          map.set(id, (map.get(id) ?? 0) + 1);
        }
      }
    } catch {
      /* ignore */
    }
    return map;
  }
}

/** 全局单例 */
export const questionFrequencyService = new QuestionFrequencyService();
