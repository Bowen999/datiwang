import { motion } from 'motion/react';
import type { ReactNode } from 'react';

export function NeoCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`neo-card ${className}`}>{children}</div>;
}

export function NeoBadge({
  children,
  className = 'bg-white',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`neo-chip ${className}`}>{children}</span>;
}

/** 浮动几何装饰：新丑派对氛围背景 */
export function PartyDecorations() {
  const shapes = [
    { type: 'square', color: '#FFC800', size: 56, x: '6%', y: '12%', rotate: 15, dur: 7 },
    { type: 'circle', color: '#FF5D8F', size: 44, x: '88%', y: '18%', rotate: 0, dur: 9 },
    { type: 'triangle', color: '#4D96FF', size: 52, x: '12%', y: '78%', rotate: -12, dur: 8 },
    { type: 'cross', color: '#3ECF8E', size: 46, x: '85%', y: '72%', rotate: 20, dur: 10 },
    { type: 'circle', color: '#9B5DE5', size: 30, x: '70%', y: '8%', rotate: 0, dur: 6 },
    { type: 'square', color: '#FF7A1A', size: 34, x: '30%', y: '88%', rotate: 45, dur: 11 },
    { type: 'triangle', color: '#FFC800', size: 38, x: '55%', y: '90%', rotate: 8, dur: 7.5 },
    { type: 'cross', color: '#FF5D8F', size: 36, x: '40%', y: '5%', rotate: -18, dur: 9.5 },
  ];
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {shapes.map((s, i) => (
        <motion.div
          key={i}
          className="absolute opacity-60"
          style={{ left: s.x, top: s.y, width: s.size, height: s.size }}
          animate={{ y: [0, -18, 0], rotate: [s.rotate, s.rotate + 14, s.rotate] }}
          transition={{ duration: s.dur, repeat: Infinity, ease: 'easeInOut' }}
        >
          {s.type === 'square' && (
            <div className="h-full w-full border-4 border-ink rounded-neo" style={{ background: s.color }} />
          )}
          {s.type === 'circle' && (
            <div className="h-full w-full rounded-full border-4 border-ink" style={{ background: s.color }} />
          )}
          {s.type === 'triangle' && (
            <div
              className="h-0 w-0"
              style={{
                borderLeft: `${s.size / 2}px solid transparent`,
                borderRight: `${s.size / 2}px solid transparent`,
                borderBottom: `${s.size}px solid ${s.color}`,
                filter: 'drop-shadow(2.5px 2.5px 0 #141414)',
              }}
            />
          )}
          {s.type === 'cross' && (
            <svg viewBox="0 0 40 40" className="h-full w-full">
              <path
                d="M14 2h12v12h12v12H26v12H14V26H2V14h12z"
                fill={s.color}
                stroke="#141414"
                strokeWidth="3.5"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </motion.div>
      ))}
    </div>
  );
}
