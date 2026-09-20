import { motion } from 'motion/react';

/** 答题计时条：绿色 → 黄色 → 红色，时间越少越闪 */
export function TimerBar({ progress, urgent }: { progress: number; urgent: boolean }) {
  const pct = Math.max(0, Math.min(1, progress));
  const color = pct > 0.5 ? '#3ECF8E' : pct > 0.25 ? '#FFC800' : '#FF3B3B';
  return (
    <div className="h-5 w-full overflow-hidden rounded-neo border-4 border-ink bg-white shadow-neo-sm">
      <motion.div
        className="h-full"
        style={{ background: color }}
        initial={false}
        animate={{ width: `${pct * 100}%` }}
        transition={{ duration: 0.2, ease: 'linear' }}
      >
        {urgent && (
          <motion.div
            className="h-full w-full bg-white/40"
            animate={{ opacity: [0, 0.7, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          />
        )}
      </motion.div>
    </div>
  );
}

/** 大倒计时数字：每秒弹跳一次 */
export function CountdownNumber({ seconds }: { seconds: number }) {
  return (
    <motion.span
      key={seconds}
      initial={{ scale: 1.8, opacity: 0.4 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      className={`inline-block font-black tabular-nums ${seconds <= 3 ? 'text-neo-red' : 'text-ink'}`}
    >
      {seconds}
    </motion.span>
  );
}
