import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { NeoButton } from '../components/ui/NeoButton';
import { NeoBadge, NeoCard } from '../components/ui/NeoCard';
import type { GameSettings } from '../types/game';
import { randomNickname } from '../utils/random';

/** 本地存储读写封装：iOS Safari 隐私模式 / 应用内浏览器（微信等）/ ITP 限制下
 *  读写会抛 SecurityError/QuotaExceededError，吞掉后降级为内存态，避免整个应用白屏。 */
function loadName(): string {
  try {
    return localStorage.getItem('datiwang:name') || '';
  } catch {
    return '';
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem('datiwang:name', name);
  } catch {
    /* 隐私模式等场景写不进去，忽略即可 */
  }
}

interface HomeScreenProps {
  connecting: boolean;
  error: string | null;
  mode: 'supabase' | 'local';
  initialCode: string;
  onCreate: (name: string, settings: GameSettings) => void;
  onJoin: (code: string, name: string) => void;
}

export const DEFAULT_SETTINGS: GameSettings = {
  roundSeconds: 15,
  questionCount: 25,
  categories: [],
  difficulty: 'mixed',
  questionTypes: ['choice'],
};

export function HomeScreen({ connecting, error, mode, initialCode, onCreate, onJoin }: HomeScreenProps) {
  const [name, setName] = useState(() => loadName() || randomNickname());
  const [code, setCode] = useState(initialCode);
  const [tab, setTab] = useState<'join' | 'create'>(initialCode ? 'join' : 'create');

  useEffect(() => {
    saveName(name);
  }, [name]);

  const validName = name.trim().length > 0;
  const validCode = code.trim().length >= 4;

  return (
    <div className="relative z-10 mx-auto flex app-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10 landscape:gap-3 landscape:py-4 md:max-w-lg">
      {/* Logo */}
      <motion.div
        initial={{ y: -60, opacity: 0, rotate: -4 }}
        animate={{ y: 0, opacity: 1, rotate: -2 }}
        transition={{ type: 'spring', stiffness: 200, damping: 16 }}
        className="relative"
      >
        <div className="rounded-neo border-[5px] border-ink bg-neo-yellow px-8 py-4 shadow-neo-lg landscape:px-6 landscape:py-2">
          <h1 className="text-4xl font-black tracking-widest landscape:text-4xl sm:text-5xl">谁是小文盲</h1>
        </div>
        <motion.div
          className="absolute -right-5 -top-5 rounded-full border-[3px] border-ink bg-neo-pink px-2 py-1 text-xs font-black text-white shadow-neo-sm"
          animate={{ rotate: [8, 14, 8], scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          PARTY!
        </motion.div>
      </motion.div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-lg font-bold text-ink/70"
      >
        🎉 和朋友实时 PK 的中文派对问答
      </motion.p>

      {/* 主卡片 */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 200, damping: 20 }}
        className="w-full"
      >
        <NeoCard className="p-5">
          <label className="mb-2 block text-sm font-black text-ink/60">你的昵称</label>
          <div className="flex gap-2">
            <input
              className="neo-input flex-1"
              placeholder="起个响亮的名字…"
              maxLength={12}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <motion.button
              whileTap={{ scale: 0.85, rotate: 180 }}
              onClick={() => setName(randomNickname())}
              title="随机昵称"
              className="shrink-0 rounded-neo border-4 border-ink bg-neo-purple px-3 text-2xl shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo active:translate-y-0.5 active:shadow-neo-none"
            >
              🎲
            </motion.button>
          </div>

          {/* 选项卡 */}
          <div className="mt-5 grid grid-cols-2 gap-2">
            {(['create', 'join'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-neo border-[3px] border-ink py-2 font-black transition-all ${
                  tab === t ? 'bg-ink text-white shadow-neo-sm' : 'bg-white hover:bg-paper'
                }`}
              >
                {t === 'create' ? '✨ 创建房间' : '🚪 加入房间'}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === 'create' ? (
              <motion.div key="c" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}>
                <NeoButton
                  color="pink"
                  size="xl"
                  disabled={!validName || connecting}
                  onClick={() => onCreate(name.trim(), DEFAULT_SETTINGS)}
                >
                  {connecting ? '创建中…' : '🎮 创建新房间'}
                </NeoButton>
              </motion.div>
            ) : (
              <motion.div key="j" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-3">
                <input
                  className="neo-input text-center text-2xl font-black uppercase tracking-[0.4em]"
                  placeholder="房间码"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                />
                <NeoButton
                  color="blue"
                  size="xl"
                  disabled={!validName || !validCode || connecting}
                  onClick={() => onJoin(code.trim(), name.trim())}
                >
                  {connecting ? '加入中…' : '🚀 加入房间'}
                </NeoButton>
              </motion.div>
            )}
          </div>

          {error && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mt-4 rounded-neo border-[3px] border-ink bg-neo-red px-3 py-2 text-center text-sm font-bold text-white shadow-neo-sm"
            >
              {error}
            </motion.div>
          )}
        </NeoCard>
      </motion.div>

      <div className="flex flex-col items-center gap-2">
        {mode === 'local' && (
          <NeoBadge className="bg-neo-yellow">
            💡 本地演示模式：多开几个浏览器标签页即可联机
          </NeoBadge>
        )}
        <NeoBadge className="bg-white">⚡ 答得越快，分数越高 · 连对有加成</NeoBadge>
        <p className="text-[10px] font-bold text-ink/40">
          头像素材：DiceBear 开源头像库（Adventurer © Lisa Wischofsky，CC BY 4.0）
        </p>
      </div>
    </div>
  );
}
