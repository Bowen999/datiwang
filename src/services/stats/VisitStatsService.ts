import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from '../realtime';
import { aggregate, type StatsSummary } from './aggregate';
import type { StatsEvent, StatsEventType } from './types';

const CLIENT_KEY = 'datiwang:stats:client:v1';
const SESSION_KEY = 'datiwang:stats:session:v1';
const LOCAL_EVENTS_KEY = 'datiwang:stats:events:v1';

/** 本地演示模式：事件流环形缓冲上限 */
const LOCAL_CAP = 3000;
/** 上报失败时的缓存队列上限（防止无限堆积） */
const MAX_QUEUE = 500;
/** 批量上报的间隔 */
const FLUSH_INTERVAL_MS = 5000;
/** 读取统计时最多拉取的事件条数 */
const FETCH_LIMIT = 20000;

/** 存储读写封装：隐私模式 / 应用内浏览器下读写可能抛异常，吞掉降级为内存态 */
function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    /* 隐私模式等场景写不进去，忽略即可 */
  }
}

function safeRemove(storage: Storage, key: string) {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 以网络请求（edge）响应头为来源的弱地理位置（拿不到就为空） */
let capturedGeo: { country?: string | null; city?: string | null } = {};

const GEO_HEADERS: Array<[keyof typeof capturedGeo, string]> = [
  ['country', 'x-country'],
  ['city', 'x-city'],
];

/**
 * 访问统计服务：
 * - 配置了 Supabase 时，事件批量写入 visit_events 表（见 scripts/supabase-setup.sql），
 *   统计页读取全站（所有访客）的公开数据；
 * - 未配置时退化为「本地演示模式」，事件存 localStorage，统计页展示本机数据。
 */
export class VisitStatsService {
  readonly mode: 'supabase' | 'local';
  readonly clientId: string;
  readonly sessionId: string;

  private client: SupabaseClient | null = null;
  private queue: StatsEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor() {
    this.mode = isSupabaseConfigured ? 'supabase' : 'local';
    this.clientId = safeGet(localStorage, CLIENT_KEY) ?? generateId();
    safeSet(localStorage, CLIENT_KEY, this.clientId);
    this.sessionId = safeGet(sessionStorage, SESSION_KEY) ?? generateId();
    safeSet(sessionStorage, SESSION_KEY, this.sessionId);

    if (this.mode === 'supabase' && isSupabaseConfigured) {
      const url = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      this.client = createClient(url, anonKey, {
        // 包装 fetch：(1) 从响应头捕获访客地理位置；(2) 打开 keepalive，页面关闭时也能发出
        global: {
          fetch: (input, init) => {
            const resp = fetch(input, { ...init, keepalive: true });
            resp.then((r) => {
              if (r && r.ok) {
                for (const [field, header] of GEO_HEADERS) {
                  const v = r.headers.get(header);
                  if (v && v !== 'unknown' && !capturedGeo[field]) capturedGeo[field] = v;
                }
              }
            });
            return resp;
          },
        },
      });
    }

    // 页面关闭/切后台前尽量把队列里的数据发出去
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        void this.flush();
      });
    }
  }

  /** 上报一个事件（fire-and-forget，不阻塞调用方） */
  track(eventType: StatsEventType, detail: Record<string, unknown> = {}): void {
    const ev: StatsEvent = {
      eventType,
      clientId: this.clientId,
      sessionId: this.sessionId,
      country: capturedGeo.country ?? null,
      city: capturedGeo.city ?? null,
      detail,
      createdAt: new Date().toISOString(),
    };

    if (this.mode === 'local') {
      this.appendLocal(ev);
      return;
    }
    this.queue.push(ev);
    this.scheduleFlush();
  }

  /** 拉取近 30 天事件并聚合出各维度统计 */
  async loadStats(): Promise<StatsSummary> {
    const events = this.mode === 'supabase' ? await this.fetchRemote() : this.readLocal();
    return aggregate(events);
  }

  /** 清空本机数据（仅本地演示模式可用；Supabase 模式请到表数据页删除） */
  clearLocal(): void {
    safeRemove(localStorage, LOCAL_EVENTS_KEY);
  }

  // ---------- 本地演示模式 ----------
  private readLocal(): StatsEvent[] {
    const raw = safeGet(localStorage, LOCAL_EVENTS_KEY);
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as StatsEvent[];
      return list.filter(isValidEvent);
    } catch {
      return [];
    }
  }

  private appendLocal(ev: StatsEvent) {
    const list = this.readLocal();
    list.push(ev);
    if (list.length > LOCAL_CAP) list.splice(0, list.length - LOCAL_CAP);
    try {
      safeSet(localStorage, LOCAL_EVENTS_KEY, JSON.stringify(list));
    } catch {
      /* 写不进去就放弃，统计不阻塞游戏 */
    }
  }

  // ---------- Supabase 模式 ----------
  private async fetchRemote(): Promise<StatsEvent[]> {
    if (!this.client) return [];
    // 先把积压的本地事件上报掉，避免遗漏
    await this.flush();
    const fromISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from('visit_events')
      .select('event_type, client_id, session_id, country, city, detail, created_at')
      .gte('created_at', fromISO)
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT);
    if (error) throw error;
    return ((data ?? []) as unknown as RemoteRow[]).map((r) => ({
      eventType: r.event_type as StatsEventType,
      clientId: r.client_id,
      sessionId: r.session_id ?? '',
      country: r.country,
      city: r.city,
      detail: (r.detail ?? {}) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  }

  private scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.queue.length);
    try {
      if (this.mode === 'supabase' && this.client) {
        const { error } = await this.client.from('visit_events').insert(
          batch.map((ev) => ({
            event_type: ev.eventType,
            client_id: ev.clientId,
            session_id: ev.sessionId,
            country: ev.country ?? null,
            city: ev.city ?? null,
            detail: ev.detail,
          })),
        );
        if (error) throw error;
      } else {
        // 兜底：模式中途变化时按本地处理，避免丢数据
        for (const ev of batch) this.appendLocal(ev);
      }
    } catch {
      // 网络失败等：放回队列头下次重试，最多保留 MAX_QUEUE 条（丢最旧的）
      this.queue = [...batch, ...this.queue].slice(0, MAX_QUEUE);
    } finally {
      this.flushing = false;
    }
  }
}

interface RemoteRow {
  event_type: string;
  client_id: string;
  session_id: string | null;
  country: string | null;
  city: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

function isValidEvent(ev: unknown): ev is StatsEvent {
  if (!ev || typeof ev !== 'object') return false;
  const e = ev as Partial<StatsEvent>;
  return (
    typeof e.eventType === 'string' &&
    typeof e.clientId === 'string' &&
    typeof e.createdAt === 'string'
  );
}

/** 全局单例 */
export const visitStats = new VisitStatsService();