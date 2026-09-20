import { AnimatePresence, motion } from 'motion/react';

/** 题目间隙的 3-2-1 倒计时覆盖层 */
export function CountdownOverlay({ endsAt, round, total, now }: { endsAt: number; round: number; total: number; now: () => number }) {
  const remain = Math.max(0, endsAt - now());
  const n = Math.ceil(remain / 1000);
  return (
    <motion.div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-paper/90 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="neo-card mb-6 bg-neo-purple px-6 py-3 text-xl font-black text-white"
      >
        第 {round + 1} / {total} 题
      </motion.div>
      <AnimatePresence mode="popLayout">
        <motion.div
          key={n}
          initial={{ scale: 2.4, opacity: 0, rotate: -10 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0, rotate: 10 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="flex h-40 w-40 items-center justify-center rounded-full border-[6px] border-ink bg-neo-yellow text-8xl font-black shadow-neo-lg"
        >
          {n > 0 ? n : 'GO'}
        </motion.div>
      </AnimatePresence>
      <motion.p
        className="mt-8 text-lg font-bold text-ink/60"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.2, repeat: Infinity }}
      >
        准备抢答…
      </motion.p>
    </motion.div>
  );
}
