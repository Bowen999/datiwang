import { motion } from 'motion/react';
import { useState } from 'react';
import { NeoButton } from '../components/ui/NeoButton';
import { NeoCard } from '../components/ui/NeoCard';
import { StatsScreen } from './StatsScreen';

/**
 * 隐藏统计路由：/stats 需密码访问。
 *
 * 说明：这是纯前端的「防君子」式密码锁——密码编译进前端包里，懂技术的访客
 * 翻源码即可绕过；它用于隐藏入口、避免路人误入，不适合当作真正的安全边界。
 * 如需严格保护，请把统计数据接到服务端鉴权后再展示。
 */
const STATS_PASSWORD = 'stats';
const AUTH_KEY = 'datiwang:stats:auth';

function isAuthed(): boolean {
  try {
    return sessionStorage.getItem(AUTH_KEY) === '1';
  } catch {
    return false;
  }
}

function markAuthed() {
  try {
    sessionStorage.setItem(AUTH_KEY, '1');
  } catch {
    /* 隐私模式等写不进去：本次会话内靠内存态保持 */
  }
}

/** 密码门禁 + 统计页（同标签页会话内只需输一次密码） */
export function StatsRoute({ onExit }: { onExit: () => void }) {
  const [authed, setAuthed] = useState(isAuthed);

  if (authed) {
    return <StatsScreen onClose={onExit} />;
  }

  return <PasswordGate onSuccess={() => { markAuthed(); setAuthed(true); }} onExit={onExit} />;
}

function PasswordGate({ onSuccess, onExit }: { onSuccess: () => void; onExit: () => void }) {
  const [password, setPassword] = useState('');
  const [wrong, setWrong] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const submit = () => {
    if (password === STATS_PASSWORD) {
      onSuccess();
      return;
    }
    setAttempts((n) => n + 1);
    setWrong(true);
    setPassword('');
    setTimeout(() => setWrong(false), 600);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 overflow-y-auto bg-paper"
      style={{
        backgroundImage: 'radial-gradient(#14141414 1.5px, transparent 1.5px)',
        backgroundSize: '22px 22px',
      }}
    >
      <div className="relative z-10 mx-auto flex app-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-10">
        <motion.div
          initial={{ rotate: -6 }}
          animate={{ rotate: -4 }}
          className="rounded-neo border-[5px] border-ink bg-neo-blue px-6 py-3 shadow-neo-lg"
        >
          <h1 className="text-2xl font-black tracking-widest text-white">🔒 访问统计</h1>
        </motion.div>

        <NeoCard className="w-full p-5">
          <label className="mb-2 block text-sm font-black text-ink/60">请输入访问密码</label>
          <motion.input
            key={attempts}
            animate={wrong ? { x: [0, -10, 10, -8, 8, -3, 0] } : {}}
            transition={{ duration: 0.4 }}
            type="password"
            className="neo-input text-center text-xl font-black tracking-widest"
            placeholder="•••••"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <NeoButton
            color="pink"
            size="xl"
            className="mt-4"
            disabled={password.length === 0}
            onClick={submit}
          >
            进入统计
          </NeoButton>
          {wrong && (
            <motion.p
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="mt-3 rounded-neo border-[3px] border-ink bg-neo-red px-3 py-2 text-center text-sm font-bold text-white shadow-neo-sm"
            >
              ❌ 密码错误，再试一次
            </motion.p>
          )}
        </NeoCard>

        <NeoButton color="white" size="sm" onClick={onExit}>
          🏠 返回首页
        </NeoButton>
      </div>
    </motion.div>
  );
}