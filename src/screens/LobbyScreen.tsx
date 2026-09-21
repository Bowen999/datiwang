import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Avatar, PopIn } from '../components/Avatar';
import { NeoButton } from '../components/ui/NeoButton';
import { NeoBadge, NeoCard } from '../components/ui/NeoCard';
import { NeoModal } from '../components/ui/NeoModal';
import { RANKING_EXTRA_SECONDS } from '../game/gameLogic';
import type { CategoryMeta, Difficulty, GameSettings, QuestionKind, Player, RoomState } from '../types/game';

const DIFFICULTY_OPTIONS: { value: GameSettings['difficulty']; label: string }[] = [
  { value: 'mixed', label: '混合' },
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];
const COUNT_OPTIONS = [10, 25, 50];
const TIME_OPTIONS = [10, 15, 20];
const TYPE_OPTIONS: { value: QuestionKind; label: string }[] = [
  { value: 'choice', label: '选择题' },
  { value: 'ranking', label: '🔀 排序题' },
];

interface LobbyScreenProps {
  room: RoomState;
  selfId: string;
  isHost: boolean;
  categories: CategoryMeta[];
  onUpdateSettings: (patch: Partial<GameSettings>) => void;
  onRename: () => void;
  onReady: (ready: boolean) => void;
  onRerollAvatar: () => void;
  onStart: () => void;
  onLeave: () => void;
  onKick: (playerId: string) => void;
  onRespondJoin: (playerId: string, accept: boolean) => void;
}

export function LobbyScreen({ room, selfId, isHost, categories, onUpdateSettings, onRename, onReady, onRerollAvatar, onStart, onLeave, onKick, onRespondJoin }: LobbyScreenProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [showMore, setShowMore] = useState(false);
  /** 点击头像展开的玩家菜单（房主可见） */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /** 正在确认踢出的玩家（非空 → 弹确认框） */
  const [kickTarget, setKickTarget] = useState<Player | null>(null);
  const s = room.settings;
  const allSelected = s.categories.length === 0;
  const me = room.players.find((p) => p.id === selfId);
  const needReady = room.players.filter((p) => !p.isHost && p.connected);
  const readyCount = needReady.filter((p) => p.ready).length;
  const allReady = needReady.every((p) => p.ready);

  const copy = async (what: 'code' | 'link') => {
    const text =
      what === 'code' ? room.code : `${location.origin}${location.pathname}?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  const toggleCategory = (id: string) => {
    if (!isHost) return;
    if (allSelected) {
      onUpdateSettings({ categories: categories.filter((c) => c.id !== id).map((c) => c.id) });
      return;
    }
    const next = s.categories.includes(id) ? s.categories.filter((c) => c !== id) : [...s.categories, id];
    onUpdateSettings({ categories: next.length === categories.length ? [] : next });
  };

  const toggleType = (kind: QuestionKind) => {
    if (!isHost) return;
    const has = s.questionTypes.includes(kind);
    if (has && s.questionTypes.length === 1) return; // 至少保留一种题目类型
    const next = has ? s.questionTypes.filter((k) => k !== kind) : [...s.questionTypes, kind];
    onUpdateSettings({ questionTypes: next });
  };

  const confirmKick = () => {
    if (!kickTarget) return;
    setMenuFor(null);
    onKick(kickTarget.id);
    setKickTarget(null);
  };

  return (
    <div className="relative z-10 mx-auto flex app-screen w-full max-w-md flex-col gap-4 px-5 py-6 landscape:py-3 md:max-w-5xl lg:max-w-6xl">
      {/* 顶部：房间名 + 房间码 */}
      <motion.div initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <NeoCard className="bg-neo-purple p-4 text-white md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <AnimatePresence mode="popLayout">
                <motion.h1
                  key={room.name}
                  initial={{ y: 14, opacity: 0, rotate: -2 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  exit={{ y: -14, opacity: 0 }}
                  className="truncate text-2xl font-black md:text-3xl"
                >
                  🎪 {room.name}
                </motion.h1>
              </AnimatePresence>
              {isHost && (
                <motion.button
                  whileTap={{ scale: 0.8, rotate: 180 }}
                  onClick={onRename}
                  title="换个房间名"
                  className="shrink-0 rounded-neo border-[3px] border-ink bg-white px-2 py-0.5 text-lg text-ink shadow-neo-sm transition-all hover:-translate-y-0.5"
                >
                  🎲
                </motion.button>
              )}
            </div>
            <button onClick={onLeave} className="shrink-0 text-sm font-bold underline decoration-2 underline-offset-2 opacity-80 hover:opacity-100">
              离开房间
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-neo border-[3px] border-ink bg-white px-3 py-1.5 text-ink shadow-neo-sm">
              <span className="text-xs font-black text-ink/50">房间号</span>
              <span className="text-2xl font-black tracking-[0.25em]">{room.code}</span>
            </div>
            <NeoButton size="sm" color="white" onClick={() => copy('code')}>
              {copied === 'code' ? '✅ 已复制' : '复制房间号'}
            </NeoButton>
            <NeoButton size="sm" color="yellow" onClick={() => copy('link')}>
              {copied === 'link' ? '✅ 已复制' : '🔗 复制邀请链接'}
            </NeoButton>
          </div>
        </NeoCard>
      </motion.div>

      {/* 主体：桌面端左右分栏 */}
      <div className="grid gap-4 md:grid-cols-5">
        {/* 玩家列表 */}
        <NeoCard className="p-4 md:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-black">👥 玩家 {room.players.length}/12</h2>
            {room.players.length < 2 && (
              <motion.span
                className="text-xs font-bold text-ink/50"
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity }}
              >
                等待好友加入…
              </motion.span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4">
            <AnimatePresence>
              {room.players.map((p, i) => (
                <PopIn key={p.id} delay={i * 0.05}>
                  <div
                    className={`flex flex-col items-center gap-1 rounded-neo border-[3px] border-ink p-2 shadow-neo-sm transition-colors ${
                      p.id === selfId ? 'bg-neo-yellow' : p.ready ? 'bg-neo-green' : 'bg-paper'
                    }`}
                  >
                    <div className="relative">
                      {isHost && p.id !== selfId ? (
                        <>
                          <motion.button
                            whileTap={{ scale: 0.88 }}
                            onClick={() => setMenuFor(menuFor === p.id ? null : p.id)}
                            title={`管理「${p.name}」`}
                            className="block"
                          >
                            <Avatar seed={p.avatar} color={p.color} />
                          </motion.button>
                          {menuFor === p.id && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setMenuFor(null)} aria-hidden />
                              <motion.div
                                initial={{ scale: 0.8, opacity: 0, y: -8, rotate: -2 }}
                                animate={{ scale: 1, opacity: 1, y: 0, rotate: 0 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                                className="absolute left-1/2 top-full z-40 mt-2 w-36 -translate-x-1/2"
                              >
                                <NeoCard className="border-[3px] border-ink bg-white p-1.5 shadow-neo-lg">
                                  <motion.button
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => setKickTarget(p)}
                                    className="flex w-full items-center justify-center gap-1.5 rounded-neo border-2 border-ink bg-white px-3 py-2 text-xs font-black text-ink transition-colors hover:bg-neo-red hover:text-white"
                                  >
                                    🚫 踢出房间
                                  </motion.button>
                                </NeoCard>
                              </motion.div>
                            </>
                          )}
                        </>
                      ) : (
                        <Avatar seed={p.avatar} color={p.color} />
                      )}
                      {p.id === selfId && (
                        <motion.button
                          whileTap={{ scale: 0.75, rotate: 180 }}
                          onClick={onRerollAvatar}
                          title="换个头像"
                          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-white text-xs shadow-neo-sm"
                        >
                          🎲
                        </motion.button>
                      )}
                    </div>
                    <span className="w-full truncate text-center text-xs font-black">
                      {p.name}
                      {p.isHost && ' 👑'}
                    </span>
                    <span className={`text-[10px] font-bold ${p.connected ? (p.isHost || p.ready ? 'text-green-700' : 'text-ink/40') : 'text-ink/40'}`}>
                      {!p.connected ? '○ 离线' : p.isHost ? '👑 房主' : p.ready ? '✅ 已准备' : '⏳ 未准备'}
                    </span>
                  </div>
                </PopIn>
              ))}
            </AnimatePresence>
          </div>

          {/* 被踢玩家重新加入的待审申请（仅房主） */}
          {isHost && room.joinRequests != null && room.joinRequests.length > 0 && (
            <div className="mt-4 rounded-neo border-[3px] border-ink bg-neo-yellow p-3 shadow-neo-sm">
              <div className="mb-2 flex items-center gap-1 text-sm font-black">
                ✋ 加入申请
                <NeoBadge className="bg-white">{room.joinRequests.length}</NeoBadge>
              </div>
              {room.joinRequests.map((rq) => (
                <div
                  key={rq.player.id}
                  className="mb-2 flex items-center gap-2 rounded-neo border-2 border-ink bg-white p-2 last:mb-0"
                >
                  <Avatar seed={rq.player.avatar} color={rq.player.color} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-black">{rq.player.name}</span>
                  <NeoButton size="sm" color="green" onClick={() => onRespondJoin(rq.player.id, true)}>
                    ✔ 同意
                  </NeoButton>
                  <NeoButton size="sm" color="red" onClick={() => onRespondJoin(rq.player.id, false)}>
                    ✘ 拒绝
                  </NeoButton>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 hidden text-center md:block">
            <NeoBadge className="bg-paper">分享房间号或链接，喊朋友进来！</NeoBadge>
          </div>
        </NeoCard>

        {/* 游戏设置 */}
        <NeoCard className="p-4 md:col-span-2">
          <h2 className="mb-3 text-lg font-black">⚙️ 游戏设置 {!isHost && <span className="text-xs font-bold text-ink/40">（房主设置）</span>}</h2>

          <div className="mb-1 text-sm font-black text-ink/60">题目分类</div>
          <div className="mb-4 flex flex-wrap gap-2">
            {categories.map((c) => {
              const selected = allSelected || s.categories.includes(c.id);
              return (
                <motion.button
                  key={c.id}
                  whileTap={isHost ? { scale: 0.92 } : undefined}
                  onClick={() => toggleCategory(c.id)}
                  className={`rounded-neo border-[3px] border-ink px-3 py-1.5 text-sm font-black transition-all ${
                    selected ? 'bg-neo-green shadow-neo-sm' : 'bg-white opacity-45'
                  } ${isHost ? 'hover:-translate-y-0.5' : 'cursor-default'}`}
                >
                  {c.name}
                </motion.button>
              );
            })}
          </div>

          <div className="mb-1 text-sm font-black text-ink/60">题目数量</div>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {COUNT_OPTIONS.map((n) => (
              <OptionCell key={n} active={s.questionCount === n} disabled={!isHost} onClick={() => onUpdateSettings({ questionCount: n })}>
                {n} 题
              </OptionCell>
            ))}
          </div>

          {/* 更多设置：难度 / 每题时间 / 题目类型 */}
          <motion.button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className={`mb-2 flex w-full items-center justify-between rounded-neo border-[3px] border-ink px-3 py-2 text-sm font-black transition-all ${
              isHost ? 'bg-paper hover:-translate-y-0.5' : 'cursor-pointer bg-paper'
            }`}
          >
            <span>⚙️ 更多设置</span>
            <motion.span animate={{ rotate: showMore ? 180 : 0 }}>▾</motion.span>
          </motion.button>

          <AnimatePresence initial={false}>
            {showMore && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mb-1 text-sm font-black text-ink/60">难度</div>
                <div className="mb-4 grid grid-cols-4 gap-2">
                  {DIFFICULTY_OPTIONS.map((d) => (
                    <OptionCell
                      key={d.value}
                      active={s.difficulty === d.value}
                      disabled={!isHost}
                      onClick={() => onUpdateSettings({ difficulty: d.value as Difficulty | 'mixed' })}
                    >
                      {d.label}
                    </OptionCell>
                  ))}
                </div>

                <div className="mb-1 text-sm font-black text-ink/60">每题时间</div>
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {TIME_OPTIONS.map((n) => (
                    <OptionCell key={n} active={s.roundSeconds === n} disabled={!isHost} onClick={() => onUpdateSettings({ roundSeconds: n })}>
                      {n} 秒
                    </OptionCell>
                  ))}
                </div>
                <p className="-mt-2 mb-4 text-xs font-bold text-ink/45">
                  💡 排序题作答时间自动多 {RANKING_EXTRA_SECONDS} 秒
                </p>

                <div className="mb-1 text-sm font-black text-ink/60">题目类型</div>
                <div className="mb-1 grid grid-cols-2 gap-2">
                  {TYPE_OPTIONS.map((t) => {
                    const active = s.questionTypes.includes(t.value);
                    return (
                      <motion.button
                        key={t.value}
                        whileTap={isHost ? { scale: 0.92 } : undefined}
                        onClick={() => toggleType(t.value)}
                        className={`rounded-neo border-[3px] border-ink px-3 py-1.5 text-sm font-black transition-all ${
                          active ? 'bg-neo-green shadow-neo-sm' : 'bg-white opacity-45'
                        } ${isHost ? 'hover:-translate-y-0.5' : 'cursor-default'}`}
                      >
                        {active ? '✅ ' : '⬜ '}
                        {t.label}
                      </motion.button>
                    );
                  })}
                </div>
                <div className="mb-1 text-[10px] font-bold text-ink/40">
                  💬 排序题按名次依次点选作答 · 含排行榜动态随机抽题（城市GDP、QS大学排名等）
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </NeoCard>
      </div>

      {/* 开始/准备按钮 */}
      {isHost ? (
        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className="md:mx-auto md:w-96">
          <NeoButton color="pink" size="xl" onClick={onStart} className="text-2xl" disabled={!allReady}>
            🚀 开始游戏！
          </NeoButton>
          <p className="mt-2 text-center text-xs font-bold text-ink/50">
            {needReady.length === 0
              ? '一个人也能玩，但朋友越多越嗨！'
              : allReady
                ? `全员就绪（${readyCount}/${needReady.length}），开战！`
                : `等待玩家准备 ${readyCount}/${needReady.length}`}
          </p>
        </motion.div>
      ) : (
        <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className="flex flex-col items-center gap-3 md:mx-auto md:w-96">
          <NeoButton
            color={me?.ready ? 'white' : 'green'}
            size="xl"
            onClick={() => onReady(!me?.ready)}
            className="text-2xl"
          >
            {me?.ready ? '✅ 已准备（点击取消）' : '✋ 准备！'}
          </NeoButton>
          <p className="text-center text-xs font-bold text-ink/50">
            {me?.ready ? '等待房主开始游戏…' : '点击「准备」后房主才能开局'}
          </p>
        </motion.div>
      )}

      <div className="pb-2 text-center md:hidden">
        <NeoBadge className="bg-white">分享房间号或链接，喊朋友进来！</NeoBadge>
      </div>

      {/* 踢人确认弹窗（neo 风，替代 window.confirm） */}
      <NeoModal open={kickTarget !== null} onClose={() => setKickTarget(null)}>
        <NeoCard className="bg-white p-6 text-center shadow-neo-lg">
          <div className="text-5xl">🚫</div>
          <h3 className="mt-3 text-xl font-black">把「{kickTarget?.name}」移出房间？</h3>
          <p className="mt-1 text-xs font-bold text-ink/50">
            TA 被移出后仍可申请重新加入，需你同意才会回来
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <NeoButton color="white" onClick={() => setKickTarget(null)}>
              👈 先不踢
            </NeoButton>
            <NeoButton color="red" size="lg" onClick={confirmKick}>
              🚫 确认移出
            </NeoButton>
          </div>
        </NeoCard>
      </NeoModal>
    </div>
  );
}

function OptionCell({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.93 }}
      onClick={disabled ? undefined : onClick}
      className={`rounded-neo border-[3px] border-ink py-1.5 text-sm font-black transition-all ${
        active ? 'bg-ink text-white shadow-neo-sm' : 'bg-white'
      } ${disabled ? 'cursor-default' : 'hover:-translate-y-0.5'}`}
    >
      {children}
    </motion.button>
  );
}
