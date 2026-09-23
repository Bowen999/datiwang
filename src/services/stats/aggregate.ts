import type { StatsEvent } from './types';

/** 统计覆盖的时间窗口（天），读取时只拉近 30 天的数据 */
export const STATS_RANGE_DAYS = 30;

export interface DailyPoint {
  date: string; // YYYY-MM-DD（本地时区）
  label: string; // 展示用，如「9/1」
  visits: number;
}

export interface GeoSlice {
  name: string;
  count: number;
}

export interface CategorySlice {
  name: string;
  count: number;
}

export interface StatsSummary {
  /** 聚合计算完成的时刻 */
  refreshedAt: number;
  rangeDays: number;
  /** 窗口内事件总数 */
  totalEvents: number;
  overview: {
    totalVisits: number;
    uniqueVisitors: number;
    todayVisits: number;
    yesterdayVisits: number;
    weekVisits: number;
  };
  /** 近 30 天每日访问量（有数据的天） */
  dailyTrend: DailyPoint[];
  /** 24 小时访问分布（本地时区，index = 小时） */
  hourly: number[];
  /** 星期分布（本地时区，index 0 = 周一） */
  weekday: number[];
  /** 访问来源渠道 */
  sources: { direct: number; room: number };
  /** 地区分布（Supabase 边缘推断，可能为空） */
  geo: { countries: GeoSlice[]; cities: GeoSlice[] };
  gameplay: {
    roomsCreated: number;
    roomsJoined: number;
    gamesStarted: number;
    gamesEnded: number;
    questionsAnswered: number;
    correctAnswers: number;
    /** 正确率 0-100 */
    accuracy: number;
    /** 平均每局人数 */
    avgPlayers: number;
    /** 参与过对局（创建或加入过房间）的独立设备数 */
    uniquePlayers: number;
  };
  /** 答题最多的题目分类 Top 6 */
  topCategories: CategorySlice[];
  /** 最近 10 条事件（按时间倒序） */
  recent: StatsEvent[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 本地时区日期字符串 YYYY-MM-DD */
function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 本地时区「当天零点」时间戳（UTC 对齐用） */
function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** index 0 = 周一 … 6 = 周日 */
function weekdayIndex(ts: number): number {
  return (new Date(ts).getDay() + 6) % 7;
}

/** 对事件窗口做各维度聚合 */
export function aggregate(events: StatsEvent[]): StatsSummary {
  const now = Date.now();
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const weekStart = todayStart - 6 * DAY_MS;

  const byDay = new Map<string, number>();
  const hourly = new Array<number>(24).fill(0);
  const weekday = new Array<number>(7).fill(0);
  const pageSrc = { direct: 0, room: 0 };
  const countries = new Map<string, number>();
  const cities = new Map<string, number>();
  const categories = new Map<string, number>();

  let pageVisitors = new Set<string>();
  let gameplayVisitors = new Set<string>();
  let roomsCreated = 0;
  let roomsJoined = 0;
  let gamesStarted = 0;
  let gamesEnded = 0;
  let questionsAnswered = 0;
  let correctAnswers = 0;
  let playerSum = 0;
  let playerCount = 0;

  for (const ev of events) {
    const ts = new Date(ev.createdAt).getTime();
    if (Number.isNaN(ts)) continue;

    if (ev.eventType === 'page_view') {
      const key = dayKey(ts);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
      hourly[new Date(ts).getHours()]++;
      weekday[weekdayIndex(ts)]++;
      pageVisitors.add(ev.clientId);
      const src = ev.detail?.source === 'room' ? 'room' : 'direct';
      if (src === 'room') pageSrc.room++;
      else pageSrc.direct++;
    } else if (ev.eventType === 'create_room') {
      roomsCreated++;
      gameplayVisitors.add(ev.clientId);
    } else if (ev.eventType === 'join_room') {
      roomsJoined++;
      gameplayVisitors.add(ev.clientId);
    } else if (ev.eventType === 'game_start') {
      gamesStarted++;
      const players = Number(ev.detail?.players) || 0;
      if (players > 0) {
        playerSum += players;
        playerCount++;
      }
    } else if (ev.eventType === 'game_end') {
      gamesEnded++;
      const players = Number(ev.detail?.players) || 0;
      if (players > 0) {
        playerSum += players;
        playerCount++;
      }
    } else if (ev.eventType === 'question_answered') {
      questionsAnswered++;
      if (ev.detail?.correct === true) correctAnswers++;
      const cat = String(ev.detail?.category ?? '未知');
      categories.set(cat, (categories.get(cat) ?? 0) + 1);
    }

    if (ev.country) countries.set(ev.country, (countries.get(ev.country) ?? 0) + 1);
    if (ev.city) cities.set(ev.city, (cities.get(ev.city) ?? 0) + 1);
  }

  // 近 30 天每日趋势：补齐中间的零值天
  const dailyTrend: DailyPoint[] = [];
  const start = startOfLocalDay(now) - (STATS_RANGE_DAYS - 1) * DAY_MS;
  for (let off = 0; off < STATS_RANGE_DAYS; off++) {
    const day = start + off * DAY_MS;
    const key = dayKey(day);
    const visits = byDay.get(key) ?? 0;
    // 只有窗口内有事件（或今天还没开始）才纳入，避免展示大片无意义零值
    if (visits > 0 || off === STATS_RANGE_DAYS - 1) {
      const d = new Date(day);
      dailyTrend.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, visits });
    }
  }

  const countVisits = (from: number, to: number) =>
    [...byDay.entries()].reduce((sum, [k, v]) => {
      // byDay 的 key 是本地时区日期，直接解析为本地零点
      const t = new Date(`${k}T00:00:00`).getTime();
      return t >= from && t < to ? sum + v : sum;
    }, 0);

  const top = (map: Map<string, number>, n: number): GeoSlice[] =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, count]) => ({ name, count }));

  const topCategories: CategorySlice[] = top(categories, 6);

  const accuracy = questionsAnswered > 0 ? Math.round((correctAnswers / questionsAnswered) * 100) : 0;

  return {
    refreshedAt: now,
    rangeDays: STATS_RANGE_DAYS,
    totalEvents: events.length,
    overview: {
      totalVisits: pageSrc.direct + pageSrc.room,
      uniqueVisitors: pageVisitors.size,
      todayVisits: countVisits(todayStart, todayStart + DAY_MS),
      yesterdayVisits: countVisits(yesterdayStart, todayStart),
      weekVisits: countVisits(weekStart, todayStart + DAY_MS),
    },
    dailyTrend,
    hourly,
    weekday,
    sources: pageSrc,
    geo: { countries: top(countries, 8), cities: top(cities, 8) },
    gameplay: {
      roomsCreated,
      roomsJoined,
      gamesStarted,
      gamesEnded,
      questionsAnswered,
      correctAnswers,
      accuracy,
      avgPlayers: playerCount > 0 ? Math.round(playerSum / playerCount) : 0,
      uniquePlayers: gameplayVisitors.size,
    },
    topCategories,
    recent: [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
  };
}