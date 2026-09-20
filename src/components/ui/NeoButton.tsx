import { motion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';

type NeoColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'white' | 'ink' | 'red' | 'orange';

const colorMap: Record<NeoColor, string> = {
  yellow: 'bg-neo-yellow text-ink',
  pink: 'bg-neo-pink text-white',
  blue: 'bg-neo-blue text-white',
  green: 'bg-neo-green text-ink',
  purple: 'bg-neo-purple text-white',
  orange: 'bg-neo-orange text-white',
  white: 'bg-white text-ink',
  ink: 'bg-ink text-white',
  red: 'bg-neo-red text-white',
};

interface NeoButtonProps extends HTMLMotionProps<'button'> {
  color?: NeoColor;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
}

export function NeoButton({ color = 'yellow', size = 'md', className = '', children, ...rest }: NeoButtonProps) {
  const sizeCls =
    size === 'sm'
      ? 'px-3 py-1.5 text-sm'
      : size === 'lg'
        ? 'px-6 py-3 text-lg'
        : size === 'xl'
          ? 'px-8 py-4 text-xl w-full'
          : 'px-5 py-2.5 text-base';
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      className={`neo-btn ${colorMap[color]} ${sizeCls} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function neoColorClass(color: NeoColor): string {
  return colorMap[color];
}
