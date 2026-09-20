import { motion } from 'motion/react';
import { Avatar } from '../components/Avatar';
import { Confetti } from '../components/Confetti';
import { NeoButton } from '../components/ui/NeoButton';
import { NeoCard } from '../components/ui/NeoCard';
import { rankPlayers } from '../game/scoring';
import type { RoomState } from '../types/game';

interface FinalScreenProps {
  room: RoomState;
  selfId: string;
  isHost: boolean;
  onPlayAgain: () => void;
  onLeave: () => void;
}

/** 结算页：冠军领奖台 + 完整排名 + 彩带 */
export function FinalScreen({ room, selfId, isHost, onPlayAgain, onLeave }: FinalScreenProps) {
  const ranked = rankPlayers(room.players);
  const podium = ranked.slice(0, 3);
  const me = ranked.find((p) => p.id === selfId);
  const champion = ranked[0];
  const isChampion = champion?.id === selfId;

  // 领奖台顺序：亚军、冠军、季军
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean);
  const podiumHeights = ['h-24', 'h-36', 'h-16'];
  const podiumColors = ['#DDE3EA', '#FFC800', '#FF7A1A'];

  return (
    <div className="relative z-10 mx-auto flex app-screen w-full max-w-md flex-col items-center gap-5 px-5 py-8 landscape:py-4 md:max-w-4xl lg:max-w-5xl">
      <Confetti />

      <motion.div
        initial={{ y: -50, scale: 0.6, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 250, damping: 16 }}
        className="rounded-neo border-[5px] border-ink bg-neo-pink px-8 py-3 text-3xl font-black text-white shadow-neo-lg"
      >
        {isChampion ? '🏆 你是小智障！' : '🎊 游戏结束！'}
      </motion.div>

      {me && !isChampion && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          <NeoCard className="bg-neo-yellow px-5 py-2 text-center font-black">
            你的名次：第 {me.rank} 名 · {me.score} 分
          </NeoCard>
        </motion.div>
      )}

      {/* 领奖台 + 完整排名：桌面端左右分栏 */}
      <div className="grid w-full grid-cols-1 items-end gap-5 md:grid-cols-2 md:items-center">
        <div className="flex items-end justify-center gap-3 pt-4 md:gap-4">
        {podiumOrder.map((p, i) => {
          if (!p) return null;
          const rankLabel = p.rank === 1 ? '👑' : p.rank === 2 ? '🥈' : '🥉';
          return (
            <motion.div
              key={p.id}
              className="flex w-28 flex-col items-center gap-2"
              initial={{ y: 120, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.15, type: 'spring', stiffness: 220, damping: 18 }}
            >
              <motion.div
                animate={p.rank === 1 ? { rotate: [0, -4, 4, 0], scale: [1, 1.06, 1] } : undefined}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="flex flex-col items-center gap-1"
              >
                <span className="text-2xl">{rankLabel}</span>
                <Avatar seed={p.avatar} color={p.color} size="lg" />
                <span className="max-w-full truncate text-sm font-black">{p.name}</span>
                <span className="rounded-neo border-2 border-ink bg-white px-2 text-xs font-black shadow-neo-sm">
                  {p.score} 分
                </span>
              </motion.div>
              <div
                className={`w-full rounded-t-neo border-4 border-b-0 border-ink ${podiumHeights[i]}`}
                style={{ background: podiumColors[i] }}
              />
            </motion.div>
          );
        })}
        </div>

      {/* 完整排名 */}
      <NeoCard className="w-full p-4">
        <h2 className="mb-3 text-lg font-black">📋 最终排名</h2>
        <div className="flex flex-col gap-2">
          {ranked.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.5 + i * 0.08 }}
              className={`flex items-center gap-3 rounded-neo border-[3px] border-ink px-3 py-2 shadow-neo-sm ${
                p.id === selfId ? 'bg-neo-purple text-white' : 'bg-paper'
              }`}
            >
              <span className="w-8 text-center text-lg font-black">#{p.rank}</span>
              <Avatar seed={p.avatar} color={p.color} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black">{p.name}</div>
                <div className="text-xs font-bold opacity-60">
                  答对 {p.correctCount}/{room.totalRounds} 题
                </div>
              </div>
              <span className="text-lg font-black tabular-nums">{p.score}</span>
            </motion.div>
          ))}
        </div>
      </NeoCard>
      </div>

      {/* 操作 */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="flex w-full flex-col gap-3 md:mx-auto md:w-96"
      >
        {isHost ? (
          <NeoButton color="green" size="xl" onClick={onPlayAgain}>
            🔁 再来一局
          </NeoButton>
        ) : (
          <NeoCard className="bg-neo-yellow p-3 text-center font-black">
            ⏳ 等待房主选择「再来一局」…
          </NeoCard>
        )}
        <NeoButton color="white" size="lg" onClick={onLeave}>
          🚪 退出房间
        </NeoButton>
      </motion.div>
    </div>
  );
}
