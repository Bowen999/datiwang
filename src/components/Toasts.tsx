import { AnimatePresence, motion } from 'motion/react';
import type { Notice } from '../hooks/useRoom';

/** 顶部通知：玩家加入 / 系统提示 */
export function Toasts({ notices }: { notices: Notice[] }) {
  return (
    <div className="pointer-events-none fixed left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4"
      style={{ top: 'calc(1rem + var(--safe-top))' }}
    >
      <AnimatePresence>
        {notices.map((n) => (
          <motion.div
            key={n.id}
            layout
            initial={{ y: -60, scale: 0.7, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -30, scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            className="flex items-center gap-2 rounded-neo border-[3px] border-ink bg-white px-4 py-2 font-bold shadow-neo-sm"
          >
            {n.icon && <span className="text-lg">{n.icon}</span>}
            <span className="text-sm">{n.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
