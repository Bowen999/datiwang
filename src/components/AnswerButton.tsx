import { motion } from 'motion/react';

const LETTERS = ['A', 'B', 'C', 'D'];
const LETTER_COLORS = ['#FF5D8F', '#4D96FF', '#FFC800', '#3ECF8E'];

export type AnswerState = 'idle' | 'selected' | 'correct' | 'wrong' | 'missed' | 'dimmed';

interface AnswerButtonProps {
  index: number;
  text: string;
  state: AnswerState;
  disabled: boolean;
  onClick: () => void;
}

/** 选项按钮：选中塌陷、答对变绿弹跳、答错红色抖动 */
export function AnswerButton({ index, text, state, disabled, onClick }: AnswerButtonProps) {
  const base = 'bg-white';
  const styleByState: Record<AnswerState, string> = {
    idle: `${base} hover:-translate-y-0.5 hover:shadow-neo`,
    selected: 'bg-neo-blue text-white translate-x-1 translate-y-1 shadow-neo-none',
    correct: 'bg-neo-green text-ink shadow-neo',
    wrong: 'bg-neo-red text-white translate-x-1 translate-y-1 shadow-neo-none',
    missed: 'bg-white opacity-50',
    dimmed: 'bg-white opacity-40',
  };
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={state === 'idle' ? { scale: 0.97 } : undefined}
      animate={
        state === 'wrong'
          ? { x: [0, -10, 10, -8, 8, -3, 0] }
          : state === 'correct'
            ? { scale: [1, 1.04, 1] }
            : undefined
      }
      transition={{ duration: 0.45 }}
      className={`neo-btn w-full justify-start gap-3 px-4 py-4 text-left text-base font-bold sm:text-lg ${styleByState[state]}`}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-neo border-[3px] border-ink text-base font-black shadow-neo-sm"
        style={{ background: state === 'selected' || state === 'wrong' ? '#fff' : LETTER_COLORS[index % 4], color: '#141414' }}
      >
        {LETTERS[index % 4]}
      </span>
      <span className="flex-1">{text}</span>
      {state === 'correct' && <span className="text-2xl">✅</span>}
      {state === 'wrong' && <span className="text-2xl">❌</span>}
    </motion.button>
  );
}
