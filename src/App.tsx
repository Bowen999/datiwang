import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { DebugOverlay } from './components/DebugOverlay';
import { Toasts } from './components/Toasts';
import { PartyDecorations } from './components/ui/NeoCard';
import { useRoom } from './hooks/useRoom';
import { visitStats } from './services/stats';
import { StatsRoute } from './screens/StatsRoute';
import { FinalScreen } from './screens/FinalScreen';
import { HomeScreen } from './screens/HomeScreen';
import { KickedScreen } from './screens/KickedScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { QuizScreen } from './screens/QuizScreen';

// 每次页面加载只上报一次访问（模块级标志：React StrictMode 开发期会双跑 effect，需要去重）
let pageViewTracked = false;

const screenTransition = {
  initial: { opacity: 0, y: 60, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -60, scale: 0.98 },
  transition: { type: 'spring' as const, stiffness: 260, damping: 26 },
};

/** 监听浏览器路径（popstate / 前进后退），供 /stats 隐藏路由使用 */
function usePathname(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function navigateTo(path: string) {
  if (location.pathname === path) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function App() {
  const path = usePathname();

  // 隐藏的统计路由：/stats（或带尾斜杠/查询参数），需要密码（见 StatsRoute）
  if (path === '/stats' || path.startsWith('/stats/')) {
    return <StatsRoute onExit={() => navigateTo('/')} />;
  }

  return <GameApp />;
}

function GameApp() {
  const r = useRoom();

  // 通过 ?room=CODE 链接直接加入
  const initialCode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get('room') ?? '').toUpperCase();
  }, []);

  // 房间状态同步到地址栏，方便直接分享链接
  useEffect(() => {
    const url = new URL(location.href);
    if (r.room) {
      url.searchParams.set('room', r.room.code);
    } else {
      url.searchParams.delete('room');
    }
    history.replaceState(null, '', url);
  }, [r.room?.code]);

  // 访问统计：每次页面加载上报一次 page_view（含来源：直接打开 / 房间分享链接）
  useEffect(() => {
    if (pageViewTracked) return;
    pageViewTracked = true;
    const params = new URLSearchParams(location.search);
    visitStats.track('page_view', {
      source: params.has('room') ? 'room' : 'direct',
      referrer: document.referrer ? document.referrer.slice(0, 200) : null,
    });
  }, []);

  // 被踢优先级最高：房间状态已清空，直接显示被移出页面
  const screen = r.kickedBy
    ? 'kicked'
    : !r.room
      ? 'home'
      : r.room.phase === 'lobby'
        ? 'lobby'
        : r.room.phase === 'final'
          ? 'final'
          : 'quiz';

  return (
    <div className="app-screen overflow-x-hidden pb-[var(--safe-bottom)]">
      <PartyDecorations />
      <Toasts notices={r.notices} />
      <DebugOverlay mode={r.mode} connecting={r.connecting} room={r.room} myAnswer={r.myAnswer} />
      <AnimatePresence mode="wait">
        <motion.div key={screen} {...screenTransition} className="app-screen">
          {screen === 'home' && (
            <HomeScreen
              connecting={r.connecting}
              error={r.error}
              mode={r.mode}
              initialCode={initialCode}
              onCreate={r.createRoom}
              onJoin={r.joinRoom}
            />
          )}
          {screen === 'lobby' && r.room && (
            <LobbyScreen
              room={r.room}
              selfId={r.selfId}
              isHost={r.isHost}
              categories={r.categories}
              onUpdateSettings={r.updateSettings}
              onRename={r.renameRoom}
              onReady={r.setReady}
              onRerollAvatar={r.rerollAvatar}
              onStart={r.startGame}
              onLeave={r.leaveRoom}
              onKick={r.kickPlayer}
              onRespondJoin={r.respondJoinRequest}
            />
          )}
          {screen === 'kicked' && (
            <KickedScreen by={r.kickedBy ?? '房主'} applied={r.joinApplied} onApply={r.applyJoin} onBack={r.backToHome} />
          )}
          {screen === 'quiz' && r.room && (
            <QuizScreen
              room={r.room}
              selfId={r.selfId}
              isHost={r.isHost}
              categories={r.categories}
              myAnswer={
                r.myAnswer && r.myAnswer.questionId === r.room.activeQuestion?.id
                  ? r.myAnswer
                  : null
              }
              now={r.now}
              onAnswer={r.submitAnswer}
              onNext={r.nextRound}
            />
          )}
          {screen === 'final' && r.room && (
            <FinalScreen
              room={r.room}
              selfId={r.selfId}
              isHost={r.isHost}
              onPlayAgain={r.playAgain}
              onLeave={r.leaveRoom}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}