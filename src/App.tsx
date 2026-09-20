import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { Toasts } from './components/Toasts';
import { PartyDecorations } from './components/ui/NeoCard';
import { useRoom } from './hooks/useRoom';
import { FinalScreen } from './screens/FinalScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { QuizScreen } from './screens/QuizScreen';

const screenTransition = {
  initial: { opacity: 0, y: 60, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -60, scale: 0.98 },
  transition: { type: 'spring' as const, stiffness: 260, damping: 26 },
};

export default function App() {
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

  const screen = !r.room
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
            />
          )}
          {screen === 'quiz' && r.room && (
            <QuizScreen
              room={r.room}
              selfId={r.selfId}
              isHost={r.isHost}
              categories={r.categories}
              myAnswerIndex={
                r.myAnswer && r.myAnswer.questionId === r.room.activeQuestion?.id
                  ? r.myAnswer.optionIndex
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
