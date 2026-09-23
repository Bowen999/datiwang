import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NeoBadge, NeoCard } from '../components/ui/NeoCard';
import { NeoButton } from '../components/ui/NeoButton';
import { visitStats } from '../services/stats';
import type { StatsSummary } from '../services/stats';

const BAR_COLORS = ['#FFC800', '#FF5D8F', '#4D96FF', '#3ECF8E', '#9B5DE5', '#FF7A1A'];

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `今天 ${hh}:${mm}`;
  const y = d.getFullYear() !== today.getFullYear() ? `/${d.getFullYear()}` : '';
  return `${d.getMonth() + 1}/${d.getDate()}${y} ${hh}:${mm}`;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <NeoCard className="p-4">
      <h3 className="mb-3 text-sm font-black tracking-wide text-ink/60">{title}</h3>
      {children}
    </NeoCard>
  );
}

function StatChip({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-neo border-[3px] border-ink bg-white p-2.5 shadow-neo-sm">
      <div className={`text-2xl font-black leading-tight ${accent ?? ''}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-bold text-ink/50">{label}</div>
    </div>
  );
}

/** 垂直柱状图（访问趋势 / 24 小时 / 星期分布） */
function VBarChart({
  data,
  color,
  compact = false,
}: {
  data: Array<{ label: string; value: number }>;
  color: string;
  compact?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const height = compact ? 44 : 64;
  return (
    <div className="flex items-end gap-[3px]">
      {data.map((d, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className={`font-black leading-none ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
            {d.value > 0 ? d.value : ''}
          </div>
          <div
            className="w-full rounded-t-[3px] border-2 border-b-0 border-ink transition-all duration-500"
            style={{
              height: `${Math.max(d.value > 0 ? 6 : 2, (d.value / max) * height)}px`,
              background: d.value > 0 ? color : 'transparent',
            }}
            title={`${d.label}：${d.value} 次访问`}
          />
          <div className="w-full truncate text-center text-[9px] font-bold text-ink/50">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

/** 横向条形列表（地区 / 热门分类） */
function HBarList({
  items,
  color,
  unit = '次',
  empty,
}: {
  items: Array<{ name: string; count: number }>;
  color: string;
  unit?: string;
  empty: string;
}) {
  if (items.length === 0) return <p className="py-2 text-sm font-bold text-ink/40">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <div key={it.name} className="flex items-center gap-2">
          <span className="w-16 shrink-0 truncate text-xs font-black text-ink/70">{it.name}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-neo border-2 border-ink bg-paper">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(it.count / max) * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              className="h-full border-r-2 border-ink"
              style={{ background: color }}
            />
          </div>
          <span className="w-14 shrink-0 text-right text-xs font-black">
            {it.count}
            <span className="text-ink/40"> {unit}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function GamplayStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-neo border-2 border-ink bg-paper px-2 py-1.5">
      <span className="text-lg font-black leading-tight">{value}</span>
      <span className="text-[10px] font-bold text-ink/50">{label}</span>
    </div>
  );
}

export function StatsScreen({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    visitStats
      .loadStats()
      .then((s) => setSummary(s))
      .catch((e) => setError(e instanceof Error ? e.message : '统计加载失败，请稍后重试'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const dailyTrend = useMemo(
    () => (summary ? summary.dailyTrend.slice(-14).map((d) => ({ label: d.label, value: d.visits })) : []),
    [summary],
  );

  const hourly = useMemo(() => (summary ? summary.hourly.map((v, i) => ({ label: `${i}`, value: v })) : []), [summary]);
  const weekday = useMemo(
    () => (summary ? summary.weekday.map((v, i) => ({ label: WEEKDAY_NAMES[i], value: v })) : []),
    [summary],
  );

  const peakHour = summary ? summary.hourly.indexOf(Math.max(...summary.hourly)) : -1;
  const busiestDay = summary ? summary.weekday.indexOf(Math.max(...summary.weekday)) : -1;
  const totalGameplayEvents =
    summary === null
      ? 0
      : summary.gameplay.roomsCreated +
        summary.gameplay.roomsJoined +
        summary.gameplay.gamesStarted +
        summary.gameplay.gamesEnded;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 overflow-y-auto bg-paper"
      style={{
        backgroundImage: 'radial-gradient(#14141414 1.5px, transparent 1.5px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div className="relative z-10 mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5 pb-[calc(2rem+var(--safe-bottom))] landscape:py-3 md:max-w-lg">
        {/* 顶栏 */}
        <div className="flex items-center gap-2">
          <motion.div initial={{ rotate: -6 }} animate={{ rotate: -4 }} className="shrink-0">
            <div className="rounded-neo border-4 border-ink bg-neo-blue px-4 py-2 text-xl font-black text-white shadow-neo-sm">
              📊 访问统计
            </div>
          </motion.div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <NeoBadge className={visitStats.mode === 'supabase' ? 'bg-neo-green' : 'bg-neo-yellow'}>
              {visitStats.mode === 'supabase' ? '☁️ 全局在线' : '💻 本地演示'}
            </NeoBadge>
            <NeoButton color="yellow" size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
              {loading ? '加载中…' : '🔄 刷新'}
            </NeoButton>
            <NeoButton color="ink" size="sm" onClick={onClose}>
              🏠 返回首页
            </NeoButton>
          </div>
        </div>

        {loading && (
          <NeoCard className="p-6 text-center">
            <div className="text-2xl">📡</div>
            <p className="mt-2 text-sm font-black text-ink/60">正在汇总各维度统计…</p>
          </NeoCard>
        )}

        {error && (
          <NeoCard className="border-neo-red bg-neo-red p-4 text-center text-white">
            <p className="font-black">⚠️ {error}</p>
            <p className="mt-1 text-xs font-bold text-white/80">
              {visitStats.mode === 'supabase'
                ? '请确认已运行 scripts/supabase-setup.sql 创建 visit_events 表，且 RLS 允许匿名读写'
                : ''}
            </p>
          </NeoCard>
        )}

        {!loading && !error && summary && (
          <>
            {/* 概览 */}
            <div className="grid grid-cols-3 gap-2">
              <StatChip label="总访问量" value={summary.overview.totalVisits.toLocaleString()} accent="text-neo-pink" />
              <StatChip label="独立访客" value={summary.overview.uniqueVisitors.toLocaleString()} accent="text-neo-blue" />
              <StatChip
                label="近 7 天"
                value={summary.overview.weekVisits.toLocaleString()}
                accent="text-neo-green"
              />
              <StatChip label="今日" value={summary.overview.todayVisits.toLocaleString()} accent="text-ink" />
              <StatChip
                label="昨日"
                value={summary.overview.yesterdayVisits.toLocaleString()}
                accent="text-ink"
              />
              <StatChip label="近 30 天" value={summary.totalEvents.toLocaleString()} accent="text-ink" />
            </div>

            {/* 访问趋势 */}
            <SectionCard title="📈 访问趋势（近 14 天）">
              {dailyTrend.length > 0 ? (
                <VBarChart data={dailyTrend} color={BAR_COLORS[0]} />
              ) : (
                <p className="py-2 text-sm font-bold text-ink/40">暂无访问数据</p>
              )}
            </SectionCard>

            {/* 时段 / 星期 */}
            <div className="grid grid-cols-1 gap-4">
              <SectionCard title="🕐 24 小时活跃分布">
                <VBarChart data={hourly} color={BAR_COLORS[1]} compact />
                <p className="mt-2 text-[11px] font-bold text-ink/50">
                  {peakHour >= 0 && Math.max(...summary.hourly) > 0
                    ? `最活跃时段：${peakHour}:00 - ${peakHour + 1}:00`
                    : '暂无访问数据'}
                </p>
              </SectionCard>
              <SectionCard title="📅 星期分布">
                <VBarChart data={weekday} color={BAR_COLORS[2]} compact />
                <p className="mt-2 text-[11px] font-bold text-ink/50">
                  {busiestDay >= 0 && Math.max(...summary.weekday) > 0
                    ? `最热闹的一天：${WEEKDAY_NAMES[busiestDay]}`
                    : '暂无访问数据'}
                </p>
              </SectionCard>
            </div>

            {/* 来源渠道 */}
            <SectionCard title="🧭 来源渠道">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-neo border-4 border-ink bg-neo-yellow p-3 shadow-neo-sm">
                  <div className="text-2xl font-black">{summary.sources.direct.toLocaleString()}</div>
                  <div className="text-xs font-black text-ink/60">🏠 直接访问首页</div>
                </div>
                <div className="rounded-neo border-4 border-ink bg-neo-green p-3 shadow-neo-sm">
                  <div className="text-2xl font-black">{summary.sources.room.toLocaleString()}</div>
                  <div className="text-xs font-black text-ink/60">🔗 房间分享链接</div>
                </div>
              </div>
            </SectionCard>

            {/* 地区分布 */}
            {(summary.geo.countries.length > 0 || summary.geo.cities.length > 0) && (
              <SectionCard title="🌍 地区分布">
                {summary.geo.countries.length > 0 && (
                  <div className="mb-3">
                    <p className="mb-1.5 text-[11px] font-black text-ink/40">国家 / 地区</p>
                    <HBarList items={summary.geo.countries} color={BAR_COLORS[4]} unit="次" empty="" />
                  </div>
                )}
                {summary.geo.cities.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-black text-ink/40">城市</p>
                    <HBarList items={summary.geo.cities} color={BAR_COLORS[3]} unit="次" empty="" />
                  </div>
                )}
              </SectionCard>
            )}

            {/* 玩法数据 */}
            <SectionCard title="🎮 玩法数据">
              <div className="grid grid-cols-4 gap-2">
                <GamplayStat label="创建房间" value={String(summary.gameplay.roomsCreated)} />
                <GamplayStat label="加入房间" value={String(summary.gameplay.roomsJoined)} />
                <GamplayStat label="开局次数" value={String(summary.gameplay.gamesStarted)} />
                <GamplayStat label="完成对局" value={String(summary.gameplay.gamesEnded)} />
                <GamplayStat label="答题总数" value={summary.gameplay.questionsAnswered.toLocaleString()} />
                <GamplayStat label="答对" value={summary.gameplay.correctAnswers.toLocaleString()} />
                <GamplayStat label="正确率" value={`${summary.gameplay.accuracy}%`} />
                <GamplayStat label="平均每局" value={`${summary.gameplay.avgPlayers} 人`} />
              </div>
              {totalGameplayEvents === 0 && (
                <p className="mt-3 text-[11px] font-bold text-ink/40">
                  还没有玩法数据 —— 和朋友开局对战、答题后这里就会自动累计。
                </p>
              )}
              <p className="mt-3 text-[11px] font-bold text-ink/40">
                👥 {summary.gameplay.uniquePlayers.toLocaleString()} 台设备参与过对局
              </p>
            </SectionCard>

            {/* 热门分类 */}
            <SectionCard title="🏆 热门分类（答题次数）">
              <HBarList items={summary.topCategories} color={BAR_COLORS[5]} unit="题" empty="还没有答题记录" />
            </SectionCard>

            {/* 最近动态 */}
            <SectionCard title="🕒 最近动态">
              {summary.recent.length === 0 ? (
                <p className="py-2 text-sm font-bold text-ink/40">暂无动态</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {summary.recent.map((ev, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-neo border-2 border-ink bg-paper px-2.5 py-1.5">
                      <span className="text-xs font-black text-ink/80">{eventLabel(ev)}</span>
                      <span className="shrink-0 text-[10px] font-bold text-ink/40">{fmtTime(ev.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {/* 页脚 */}
            <div className="flex flex-col items-center gap-2 pt-1">
              {visitStats.mode === 'local' && (
                <NeoBadge className="bg-neo-yellow">
                  💡 本地演示模式：只统计本机数据；配置 Supabase 后可在统计页查看全站数据
                </NeoBadge>
              )}
              <NeoBadge className="bg-white">
                🔒 统计事件匿名上报（随机设备 ID，不含昵称/回答内容）
              </NeoBadge>
              <p className="text-[10px] font-bold text-ink/40">
                数据窗口：近 {summary.rangeDays} 天 · 汇总于 {new Date(summary.refreshedAt).toLocaleTimeString('zh-CN')}
              </p>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  page_view: '👀 访问了首页',
  create_room: '🎮 创建了房间',
  join_room: '🚪 加入房间',
  game_start: '🏁 开始一局游戏',
  question_answered: '✏️ 答了一道题',
  game_end: '🎉 完成一局游戏',
};

function eventLabel(ev: { eventType: string; detail?: Record<string, unknown> }): string {
  if (ev.eventType === 'question_answered' && ev.detail) {
    const ok = ev.detail.correct === true;
    return `${ok ? '✅' : '❌'} 答${ok ? '对' : '错'}（${String(ev.detail.category ?? '未知分类')}）`;
  }
  if (ev.eventType === 'game_start' && ev.detail) {
    return `🏁 开局（${String(ev.detail.players ?? '?')} 人）`;
  }
  if (ev.eventType === 'page_view' && ev.detail) {
    return ev.detail.source === 'room' ? '🔗 通过房间链接访问' : '👀 访问了首页';
  }
  return EVENT_LABELS[ev.eventType] ?? `📌 ${ev.eventType}`;
}