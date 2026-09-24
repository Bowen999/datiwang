import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { AnswerButton, type AnswerState } from '../components/AnswerButton';
import { CountdownOverlay } from '../components/CountdownOverlay';
import { QuestionImage } from '../components/QuestionImage';
import { RankingBoard } from '../components/RankingBoard';
import { RankingList } from '../components/RankingList';
import { CountdownNumber, TimerBar } from '../components/TimerBar';
import { NeoButton } from '../components/ui/NeoButton';
import { NeoBadge, NeoCard } from '../components/ui/NeoCard';
import { questionTimeMs, RANKING_EXTRA_SECONDS } from '../game/gameLogic';
import type { CategoryMeta, RoomState } from '../types/game';

const DIFF_LABEL = { easy: '简单', medium: '中等', hard: '困难' } as const;
const DIFF_COLOR = { easy: 'bg-neo-green', medium: 'bg-neo-yellow', hard: 'bg-neo-red text-white' } as const;

interface MyAnswerView {
  questionId: string;
  optionIndex?: number;
  order?: number[];
}

interface QuizScreenProps {
  room: RoomState;
  selfId: string;
  isHost: boolean;
  categories: CategoryMeta[];
  myAnswer: MyAnswerView | null;
  now: () => number;
  onAnswer: (payload: { optionIndex?: number; order?: number[] }) => void;
  onNext: () => void;
}

export function QuizScreen({ room, selfId, isHost, categories, myAnswer, now, onAnswer, onNext }: QuizScreenProps) {
  // 本地时钟驱动倒计时数字重渲染（每秒一次即可；
  // 进度条本身用 CSS transition 平滑收缩，无需高频重渲染）
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const me = room.players.find((p) => p.id === selfId);
  const q = room.activeQuestion;
  const categoryName = q ? categories.find((c) => c.id === q.category)?.name ?? q.category : '';

  if (room.phase === 'countdown' && room.countdownEndsAt) {
    return <CountdownOverlay endsAt={room.countdownEndsAt} round={room.round} total={room.totalRounds} now={now} />;
  }
  if (!q) return null;

  const isRanking = q.kind === 'ranking';
  const roundMs = questionTimeMs(q.kind, room.settings.roundSeconds);
  const remainMs = Math.max(0, (room.questionEndsAt ?? 0) - now());
  const secondsLeft = Math.ceil(remainMs / 1000);
  const isReveal = room.phase === 'reveal';
  const myResult = room.reveal?.results.find((r) => r.playerId === selfId);
  // 揭晓阶段以房主广播的 reveal.results 为准（本地 myAnswer 在进入揭晓时会被重置）
  const myAnswerIndex = isRanking
    ? null
    : isReveal
      ? myResult && myResult.optionIndex >= 0
        ? myResult.optionIndex
        : null
      : myAnswer?.optionIndex ?? null;
  const myOrder = isRanking
    ? isReveal
      ? myResult && myResult.order && myResult.order.length > 0
        ? myResult.order
        : null
      : myAnswer?.order ?? null
    : null;
  const answered = isRanking
    ? myOrder != null && myOrder.length === q.options.length
    : myAnswerIndex != null;

  const optionState = (i: number): AnswerState => {
    if (isReveal && room.reveal) {
      if (i === room.reveal.correctAnswer) return 'correct';
      if (answered && i === myAnswerIndex) return 'wrong';
      return 'missed';
    }
    // 非抢答：选中项高亮，其余保持可点（可改答案）
    if (answered && i === myAnswerIndex) return 'selected';
    return 'idle';
  };

  const revealRemain = room.reveal ? Math.max(0, room.reveal.endsAt - now()) : 0;
  const connectedCount = room.players.filter((p) => p.connected).length;
  /** 单人模式：房间只有自己一人，作答完成立即揭晓（不等倒计时） */
  const isSolo = room.players.length <= 1;

  return (
    <div className="relative z-10 mx-auto flex app-screen w-full max-w-md flex-col gap-3 px-5 py-5 landscape:py-3 md:max-w-3xl lg:max-w-4xl">
      {/* 顶栏：进度 + 分数 */}
      <div className="flex items-center justify-between gap-3">
        <NeoBadge className="bg-white">
          第 {room.round + 1}/{room.totalRounds} 题
        </NeoBadge>
        <motion.div
          key={me?.score ?? 0}
          initial={{ scale: 1.35 }}
          animate={{ scale: 1 }}
          className="rounded-neo border-[3px] border-ink bg-neo-yellow px-3 py-1 text-sm font-black shadow-neo-sm"
        >
          ⭐ {me?.score ?? 0}
        </motion.div>
      </div>

      {/* 计时 */}
      {!isReveal ? (
        <div className="flex items-center gap-3">
          <div className="text-3xl">
            <CountdownNumber seconds={secondsLeft} />
          </div>
          <div className="flex-1">
            <TimerBar progress={remainMs / roundMs} urgent={secondsLeft <= 5} />
          </div>
        </div>
      ) : (
        <RevealBanner
          correct={myResult?.correct}
          partial={myResult != null && !myResult.correct && (myResult.points ?? 0) > 0}
          points={myResult?.points ?? 0}
          answered={myResult != null && (myResult.optionIndex >= 0 || (myResult.order?.length ?? 0) > 0)}
        />
      )}

      {/* 题目卡片 */}
      <motion.div
        key={q.id}
        initial={{ y: 40, opacity: 0, rotate: 1.5 }}
        animate={{ y: 0, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <NeoCard className="p-5">
          <div className="mb-3 flex gap-2">
            <NeoBadge className="bg-neo-blue text-white">{categoryName}</NeoBadge>
            <NeoBadge className={DIFF_COLOR[q.difficulty]}>{DIFF_LABEL[q.difficulty]}</NeoBadge>
            {isRanking && <NeoBadge className="bg-neo-purple text-white">🔀 排序题</NeoBadge>}
            {isRanking && <NeoBadge className="bg-neo-orange text-white">⏱️ 多 {RANKING_EXTRA_SECONDS} 秒</NeoBadge>}
          </div>
          <h2 className="break-words text-xl font-black leading-relaxed sm:text-2xl md:text-3xl">{q.question}</h2>
          {q.image && <QuestionImage key={q.image} src={q.image} credit={q.imageCredit} showCredit={isReveal} />}
        </NeoCard>
      </motion.div>

      {/* 作答区：选择题网格 / 排序题拖拽面板 */}
      {isRanking ? (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        >
          <RankingBoard
            key={q.id}
            options={q.options}
            disabled={isReveal}
            reveal={
              isReveal && room.reveal
                ? {
                    correctOrder: room.reveal.correctOrder ?? [],
                    myOrder: answered ? myOrder : null,
                  }
                : undefined
            }
            onChange={(order) => onAnswer({ order })}
          />
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 gap-3 landscape:grid-cols-2 md:grid-cols-2">
          {q.options.map((opt, i) => (
            <motion.div
              key={`${q.id}-${i}`}
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.08 * i, type: 'spring', stiffness: 300, damping: 24 }}
            >
              <AnswerButton
                index={i}
                text={opt}
                state={optionState(i)}
                disabled={isReveal}
                onClick={() => onAnswer({ optionIndex: i })}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* 底部状态区 */}
      <AnimatePresence mode="wait">
        {!isReveal ? (
          <motion.div
            key="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-1 text-center text-sm font-bold text-ink/60"
          >
            {answered ? (
              <motion.span
                key={myAnswerIndex ?? (myOrder?.join(',') ?? '')}
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="inline-block rounded-neo border-[3px] border-ink bg-white px-4 py-1.5 shadow-neo-sm"
              >
                {isSolo
                  ? isRanking
                    ? '🎯 已提交排序，马上揭晓！'
                    : '✅ 已提交，马上揭晓！'
                  : isRanking
                    ? `🎯 已提交排序，可继续点选调整 · 已答 ${room.answeredIds.length}/${connectedCount}`
                    : `✅ 已选「${'ABCD'[myAnswerIndex ?? 0]}」，可点击其他选项修改 · 已答 ${room.answeredIds.length}/${connectedCount}`}
              </motion.span>
            ) : (
              <span>
                {isSolo
                  ? isRanking
                    ? '💡 排完名次后立即揭晓（无需等倒计时）'
                    : '💡 选择答案后立即揭晓（无需等倒计时）'
                  : isRanking
                    ? `💡 按名次依次点选选项 · 已答 ${room.answeredIds.length}/${connectedCount}`
                    : `⏱️ 时间结束后统一揭晓，答案可随时修改 · 已答 ${room.answeredIds.length}/${connectedCount}`}
              </span>
            )}
          </motion.div>
        ) : (
          <motion.div key="reveal" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
            {room.reveal?.explanation && (
              <NeoCard className="bg-paper p-3 text-sm font-bold md:text-base">
                💡 {room.reveal.explanation}
              </NeoCard>
            )}
            <NeoCard className="p-3">
              <div className="mb-2 text-sm font-black text-ink/60">📊 实时排名</div>
              <RankingList players={room.players} selfId={selfId} />
            </NeoCard>
            <div className="flex flex-col items-center gap-2 md:col-span-2">
              {isHost ? (
                <NeoButton color="pink" size="lg" onClick={onNext}>
                  {room.round + 1 >= room.totalRounds ? '🏆 查看最终结果' : '⏭️ 下一题'}
                </NeoButton>
              ) : (
                <div className="text-sm font-bold text-ink/60">自动进入下一题…</div>
              )}
              <div className="h-2.5 w-40 overflow-hidden rounded-full border-2 border-ink bg-white">
                <div
                  className="h-full bg-neo-purple"
                  style={{ width: `${(revealRemain / 6000) * 100}%`, transition: 'width 1s linear' }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 揭晓反馈横幅：答对/部分对/答错/超时 */
function RevealBanner({
  correct,
  partial,
  points,
  answered,
}: {
  correct?: boolean;
  partial: boolean;
  points: number;
  answered: boolean;
}) {
  const cfg = correct
    ? { bg: 'bg-neo-green', text: `🎉 回答正确！+${points}`, sub: points >= 900 ? '闪电手速！' : '漂亮！' }
    : partial
      ? { bg: 'bg-neo-orange', text: `🧩 部分正确 +${points}`, sub: '排序差一点点，下题加油！' }
      : answered
        ? { bg: 'bg-neo-red', text: '❌ 答错了', sub: '别灰心，下一题扳回来！' }
        : { bg: 'bg-neo-orange', text: '⌛ 超时未作答', sub: '手速要快哦！' };
  return (
    <motion.div
      initial={{ scale: 0.5, rotate: -3, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 350, damping: 18 }}
      className={`rounded-neo border-4 border-ink px-4 py-2.5 text-center shadow-neo ${cfg.bg} ${
        correct ? 'text-ink' : 'text-white'
      }`}
    >
      <div className="text-xl font-black">{cfg.text}</div>
      <div className="text-xs font-bold opacity-80">{cfg.sub}</div>
    </motion.div>
  );
}