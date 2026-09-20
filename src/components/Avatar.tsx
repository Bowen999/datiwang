import { adventurer } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { motion } from 'motion/react';
import { useMemo } from 'react';

/**
 * 卡通头像：DiceBear Adventurer 风格（CC BY 4.0，Lisa Wischofsky）。
 * 本地生成 SVG data URI，不依赖外部 API；同一 seed 恒定生成同一头像。
 */
export function Avatar({
  seed,
  color,
  size = 'md',
}: {
  seed: string;
  color: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const uri = useMemo(
    () =>
      createAvatar(adventurer, {
        seed,
        backgroundColor: [color.replace('#', '')],
      }).toDataUri(),
    [seed, color],
  );
  const cls =
    size === 'sm'
      ? 'h-8 w-8'
      : size === 'lg'
        ? 'h-16 w-16'
        : size === 'xl'
          ? 'h-20 w-20'
          : 'h-11 w-11';
  return (
    <img
      src={uri}
      alt="头像"
      draggable={false}
      className={`rounded-neo border-[3px] border-ink shadow-neo-sm ${cls}`}
      style={{ background: color }}
    />
  );
}

/** 加入房间时的弹跳入场 */
export function PopIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ scale: 0, rotate: -12, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      exit={{ scale: 0, rotate: 12, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22, delay }}
    >
      {children}
    </motion.div>
  );
}
