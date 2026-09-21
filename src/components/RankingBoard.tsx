import { motion } from 'motion/react';
import { useState } from 'react';

const MEDALS = ['🥇', '🥈', '🥉'];
const MEDAL_BG = ['bg-neo-yellow', 'bg-paper', 'bg-neo-orange'];

export interface RankingReveal {
  /** 标准答案顺序（选项下标数组，第 1 名起） */
  correctOrder: number[];
  /** 玩家提交的顺序；null 表示未作答 */
  myOrder: number[] | null;
}

interface RankingBoardProps {
  options: string[];
  /** 揭晓后禁用作答 */
  disabled: boolean;
  reveal?: RankingReveal;
  /** 排序发生变化时回调（下标数组，第 1 名起） */
  onChange: (order: number[]) => void;
}

/**
 * 排序题作答面板：点选排序（无拖动）。
 * - 选项以固定顺序展示，面板不跳动、不会因实时重排而混乱；
 * - 按名次 1→2→3→4 依次点选选项完成排序，「接下来排第几」始终有提示；
 * - 点选已排好的选项可撤销；全部排完自动提交，之后可随时调整；
 * - 手机上完全不需要精细拖动，点按大目标即可，天然防误触。
 */
export function RankingBoard({ options, disabled, reveal, onChange }: RankingBoardProps) {
  const n = options.length;
  // 作答顺序：下标数组，第 i 项 = 第 i 名的选项下标（全部排完才提交）
  const [order, setOrder] = useState<number[]>([]);

  const canEdit = !disabled && !reveal;

  /** 点选选项：未排位的加入队尾；已排位的撤销 */
  const toggle = (opt: number) => {
    if (!canEdit) return;
    if (order.includes(opt)) {
      setOrder(order.filter((o) => o !== opt));
      return;
    }
    const next = [...order, opt];
    setOrder(next);
    if (next.length === n) onChange(next); // 全部排好 → 即时提交
  };

  const reset = () => {
    if (!canEdit) return;
    setOrder([]);
  };

  // ---------- 揭晓阶段：展示玩家顺序与标准答案对照 ----------
  if (reveal) {
    const displayOrder = reveal.myOrder ?? reveal.correctOrder;
    const okAt = (pos: number) => (reveal.myOrder ? displayOrder[pos] === reveal.correctOrder[pos] : false);
    return (
      <div className="flex flex-col gap-2">
        {displayOrder.map((opt, i) => (
          <div
            key={`${opt}-${i}`}
            className={`flex items-center gap-2 rounded-neo border-[3px] border-ink px-3 py-2.5 shadow-neo-sm ${
              okAt(i) ? 'border-neo-green bg-neo-green/10' : 'bg-white'
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-neo border-[2.5px] border-ink text-base font-black ${
                i < 3 ? MEDAL_BG[i] : 'bg-paper'
              }`}
            >
              {i < 3 ? MEDALS[i] : `#${i + 1}`}
            </span>
            <span className="min-w-0 flex-1 break-words text-sm font-bold sm:text-base">{options[opt]}</span>
            <span className="text-xl">{okAt(i) ? '✅' : '❌'}</span>
          </div>
        ))}
        <div className="mt-2 rounded-neo border-[3px] border-ink bg-white p-3 shadow-neo-sm">
          <div className="mb-1.5 text-sm font-black">🏁 正确顺序</div>
          <div className="flex flex-wrap gap-1.5">
            {reveal.correctOrder.map((opt, i) => (
              <span key={i} className="rounded-neo border-2 border-ink bg-neo-green px-2 py-0.5 text-xs font-black">
                {i + 1}. {options[opt]}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- 作答阶段：按名次依次点选 ----------
  const nextRank = order.length + 1;
  const full = order.length === n;

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-neo border-[3px] border-ink bg-white px-3 py-2 text-center shadow-neo-sm">
        {full ? (
          <span className="text-sm font-black">✅ 已排好名次，可点选任意一项重新调整</span>
        ) : (
          <span className="text-sm font-black">
            🏆 依次点选排出名次：接下来排<span className="text-neo-orange"> 第 {nextRank} 名</span>
          </span>
        )}
      </div>

      {options.map((opt, idx) => {
        const rank = order.indexOf(idx); // -1 = 未排位
        const isRanked = rank >= 0;
        return (
          <motion.button
            key={idx}
            type="button"
            whileTap={canEdit ? { scale: 0.97 } : undefined}
            onClick={() => toggle(idx)}
            disabled={!canEdit}
            aria-label={isRanked ? `选项：${opt}（已排第 ${rank + 1} 名，点按取消）` : `选项：${opt}（点按排第 ${nextRank} 名）`}
            className={`flex min-h-[52px] w-full items-center gap-3 rounded-neo border-[3px] border-ink px-3 py-2 text-left shadow-neo-sm transition-all ${
              isRanked ? 'border-neo-blue bg-neo-blue/10' : 'bg-white'
            } ${canEdit ? 'active:translate-y-0.5 active:shadow-neo-none' : 'cursor-default opacity-70'}`}
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-neo border-[2.5px] border-ink text-base font-black ${
                isRanked ? (rank < 3 ? MEDAL_BG[rank] : 'bg-neo-blue text-white') : 'bg-paper text-ink/40'
              }`}
            >
              {isRanked ? (rank < 3 ? MEDALS[rank] : `#${rank + 1}`) : '＋'}
            </span>
            <span className="min-w-0 flex-1 break-words text-sm font-bold sm:text-base">{opt}</span>
            {isRanked ? (
              <span className="shrink-0 rounded-neo border-2 border-ink bg-neo-yellow px-2 py-0.5 text-xs font-black shadow-neo-sm">
                第 {rank + 1} 名
              </span>
            ) : (
              nextRank <= n && (
                <span className="shrink-0 text-xs font-black text-ink/40">→ 排第 {nextRank} 名</span>
              )
            )}
          </motion.button>
        );
      })}

      {order.length > 0 && canEdit && (
        <button
          type="button"
          onClick={reset}
          className="mx-auto mt-1 rounded-neo border-[3px] border-ink bg-white px-4 py-1.5 text-xs font-black shadow-neo-sm active:translate-y-0.5 active:shadow-neo-none"
        >
          ↺ 清空重排
        </button>
      )}
    </div>
  );
}