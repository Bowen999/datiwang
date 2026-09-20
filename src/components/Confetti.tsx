import { motion } from 'motion/react';
import { useMemo } from 'react';

const COLORS = ['#FFC800', '#FF5D8F', '#4D96FF', '#3ECF8E', '#9B5DE5', '#FF7A1A', '#FFFFFF'];

interface Piece {
  id: number;
  x: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  rotate: number;
  shape: 'square' | 'circle' | 'strip';
}

/** 结算彩带：硬边几何纸屑，贴合新丑风格 */
export function Confetti({ count = 90 }: { count?: number }) {
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 1.6,
        duration: 2.6 + Math.random() * 2.4,
        size: 8 + Math.random() * 12,
        color: COLORS[i % COLORS.length],
        rotate: Math.random() * 720 - 360,
        shape: (['square', 'circle', 'strip'] as const)[i % 3],
      })),
    [count],
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          className="absolute border-2 border-ink"
          style={{
            left: `${p.x}%`,
            top: -24,
            width: p.shape === 'strip' ? p.size / 3 : p.size,
            height: p.shape === 'strip' ? p.size * 1.8 : p.size,
            background: p.color,
            borderRadius: p.shape === 'circle' ? '50%' : 2,
          }}
          initial={{ y: -40, rotate: 0, opacity: 1 }}
          animate={{ y: '110vh', rotate: p.rotate, opacity: [1, 1, 0.9, 0.6] }}
          transition={{ duration: p.duration, delay: p.delay, ease: [0.15, 0.6, 0.45, 1] }}
        />
      ))}
    </div>
  );
}
