import { motion } from 'motion/react';
import { rankPlayers, type RankedPlayer } from '../game/scoring';
import type { Player } from '../types/game';
import { Avatar } from './Avatar';

const RANK_STYLE: Record<number, { badge: string; bg: string; label: string }> = {
  1: { badge: '🥇', bg: 'bg-neo-yellow', label: '冠军' },
  2: { badge: '🥈', bg: 'bg-[#DDE3EA]', label: '亚军' },
  3: { badge: '🥉', bg: 'bg-neo-orange', label: '季军' },
};

/** 实时排行榜：名次变化时自动滑动重排 */
export function RankingList({
  players,
  selfId,
  showScore = true,
}: {
  players: Player[];
  selfId: string;
  showScore?: boolean;
}) {
  const ranked = rankPlayers(players);
  return (
    <div className="flex flex-col gap-2">
      {ranked.map((p) => (
        <RankRow key={p.id} p={p} isSelf={p.id === selfId} showScore={showScore} />
      ))}
    </div>
  );
}

function RankRow({ p, isSelf, showScore }: { p: RankedPlayer; isSelf: boolean; showScore: boolean }) {
  const style = RANK_STYLE[p.rank];
  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className={`flex items-center gap-3 rounded-neo border-[3px] border-ink px-3 py-2 shadow-neo-sm ${
        isSelf ? 'bg-neo-purple text-white' : 'bg-white'
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-neo border-2 border-ink text-sm font-black ${
          style ? style.bg : 'bg-white'
        }`}
      >
        {style ? style.badge : p.rank}
      </span>
      <Avatar seed={p.avatar} color={p.color} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black">
          {p.name}
          {p.isHost && <span className="ml-1">👑</span>}
          {isSelf && <span className="ml-1 text-xs opacity-70">(你)</span>}
        </div>
        {p.streak >= 2 && <div className="text-xs font-bold text-neo-orange">🔥 {p.streak} 连击</div>}
      </div>
      {showScore && (
        <motion.span
          key={p.score}
          initial={{ scale: 1.4, color: '#FF7A1A' }}
          animate={{ scale: 1, color: isSelf ? '#fff' : '#141414' }}
          className="text-lg font-black tabular-nums"
        >
          {p.score}
        </motion.span>
      )}
    </motion.div>
  );
}
