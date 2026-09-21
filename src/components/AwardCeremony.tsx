import { motion } from 'motion/react';
import { useMemo } from 'react';
import type { RankedPlayer } from '../game/scoring';

interface AwardCeremonyProps {
  /** winner = 第一名「你是大聪明」；loser = 最后一名「你是小智障」 */
  stage: 'winner' | 'loser';
  winners: RankedPlayer[];
  losers: RankedPlayer[];
}

const GOLD = ['#FFC800', '#FFD966', '#FFEC99', '#FFB300', '#FFF3B0'];
const GRAY = ['#B8B8B8', '#9E9E9E', '#8A8A8A', '#CFCFCF', '#7A7A7A'];
const GOOFY = ['😹', '🤡', '💩', '🫠', '🥴', '😆', '😵‍💫', '🤣'];

interface Piece {
  id: number;
  x: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  rotate: number;
  egg?: boolean;
}

/**
 * 结算颁奖典礼（所有玩家本机同步渲染同一内容，无需额外消息）：
 * - winner：金色聚光 + 金色纸屑，「你是大聪明」奖状颁发给第一名
 * - loser：黑暗聚光灯 + 下🍳雨 + 搞怪漂浮 emoji，「你是小智障」奖状颁发给最后一名
 */
export function AwardCeremony({ stage, winners, losers }: AwardCeremonyProps) {
  const isWinner = stage === 'winner';
  const subjects = isWinner ? winners : losers;
  const names = subjects.map((p) => p.name).join('、');

  const pieces = useMemo<Piece[]>(() => {
    if (isWinner) {
      return Array.from({ length: 80 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 1.4,
        duration: 2.4 + Math.random() * 2.2,
        size: 9 + Math.random() * 12,
        color: GOLD[i % GOLD.length],
        rotate: Math.random() * 720 - 360,
      }));
    }
    return Array.from({ length: 46 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 2.8 + Math.random() * 2.4,
      size: 24 + Math.random() * 10,
      color: GRAY[i % GRAY.length],
      rotate: Math.random() * 360 - 180,
      egg: i % 2 === 0,
    }));
  }, [isWinner]);

  const floaters = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        id: i,
        emoji: GOOFY[i % GOOFY.length],
        x: 5 + Math.random() * 88,
        top: 8 + Math.random() * 55,
        delay: Math.random() * 1.5,
        dur: 2.2 + Math.random() * 1.6,
      })),
    [],
  );

  return (
    <motion.div
      key={stage}
      className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {/* 背景：金色聚光 / 黑暗聚光灯 */}
      {isWinner ? (
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 38%, rgba(255,200,0,0.42), rgba(255,200,0,0.12) 45%, rgba(20,20,20,0.88) 80%, rgba(20,20,20,0.96))',
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, rgba(40,40,40,0.85), rgba(20,20,20,0.96) 70%)',
          }}
        >
          <div
            className="absolute left-1/2 top-0 h-[58%] w-72 -translate-x-1/2"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0.02))',
              clipPath: 'polygon(22% 0, 78% 0, 100% 100%, 0 100%)',
            }}
          />
        </div>
      )}

      {/* 掉落物：金色纸屑 / 🍳 灰屑雨 */}
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          className="absolute select-none"
          style={{ left: `${p.x}%`, top: -44 }}
          initial={{ y: -40, rotate: 0, opacity: 1 }}
          animate={{ y: '110vh', rotate: p.rotate, opacity: [1, 1, 0.85, 0.5] }}
          transition={{ duration: p.duration, delay: p.delay, ease: [0.15, 0.6, 0.45, 1] }}
        >
          {p.egg ? (
            <span className="text-3xl leading-none">🍳</span>
          ) : (
            <div
              className="border-2 border-ink"
              style={{
                width: p.size / 1.4,
                height: p.size,
                background: p.color,
                borderRadius: 2,
              }}
            />
          )}
        </motion.div>
      ))}

      {/* 小智障奖：搞怪漂浮 emoji */}
      {!isWinner &&
        floaters.map((f) => (
          <motion.span
            key={f.id}
            className="absolute select-none text-3xl"
            style={{ left: `${f.x}%`, top: `${f.top}%` }}
            animate={{ y: [0, 14, 0], rotate: [0, 12, -12, 0] }}
            transition={{ duration: f.dur, delay: f.delay, repeat: Infinity }}
          >
            {f.emoji}
          </motion.span>
        ))}

      {/* 奖状 */}
      <motion.div
        initial={{ scale: 0.3, opacity: 0, rotate: isWinner ? -6 : 6 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 13 }}
        className="relative z-10 mx-4 max-w-sm text-center"
      >
        <div
          className={`rounded-neo border-[5px] border-ink px-8 py-5 font-display shadow-[10px_10px_0_#141414] ${
            isWinner ? 'bg-neo-yellow' : 'bg-white'
          }`}
        >
          <motion.div
            animate={
              isWinner
                ? { y: [0, -10, 0], rotate: [0, 8, -8, 0] }
                : { rotate: [0, -8, 8, 0], scale: [1, 1.12, 1] }
            }
            transition={{ duration: 1.1, repeat: Infinity }}
            className="mb-1 text-5xl"
          >
            {isWinner ? '👑' : '🤪'}
          </motion.div>
          <motion.div
            animate={
              isWinner
                ? { scale: [1, 1.05, 1] }
                : { rotate: [0, -1.5, 1.5, 0] }
            }
            transition={{ duration: 1.4, repeat: Infinity }}
            className={`text-4xl font-black leading-tight sm:text-5xl ${
              isWinner ? 'text-ink' : 'text-neo-red'
            }`}
          >
            {isWinner ? '你是大聪明！' : '你是小智障！'}
          </motion.div>
          <div className={`mt-3 text-lg font-black ${isWinner ? 'text-ink/70' : 'text-ink/60'}`}>
            {isWinner ? `🏆 第一名 · ${names}` : `🌀 最后一名 · ${names}`}
          </div>
        </div>
        {!isWinner && (
          <div className="mt-3 rounded-neo border-[3px] border-ink bg-white/90 px-4 py-1.5 font-display text-sm font-black shadow-neo-sm">
            😹 全场哄堂大笑
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}