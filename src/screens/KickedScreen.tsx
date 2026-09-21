import { motion } from 'motion/react';
import { NeoButton } from '../components/ui/NeoButton';
import { NeoCard } from '../components/ui/NeoCard';

/** 被房主移出房间的提示页 */
export function KickedScreen({ by, onBack }: { by: string; onBack: () => void }) {
  return (
    <div className="app-screen mx-auto flex w-full max-w-md flex-col items-center justify-center gap-5 px-5 text-center">
      <motion.div
        initial={{ y: -30, opacity: 0, rotate: -6 }}
        animate={{ y: 0, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        <div className="text-7xl">🚫</div>
      </motion.div>
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 22 }}
        className="w-full"
      >
        <NeoCard className="bg-paper p-6">
          <h1 className="text-2xl font-black">你已被移出房间</h1>
          <p className="mt-2 text-sm font-bold text-ink/60">
            {by === '房主' ? '房主将你移出了房间。' : `房主「${by}」将你移出了房间。`}
          </p>
          <p className="mt-1 text-xs font-bold text-ink/40">房间链接失效，需要主人再次邀请才能加入哦</p>
          <div className="mt-5">
            <NeoButton color="pink" size="xl" onClick={onBack} className="w-full text-lg">
              🏠 返回首页
            </NeoButton>
          </div>
        </NeoCard>
      </motion.div>
    </div>
  );
}