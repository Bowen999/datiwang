import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '../types/game';
import { APP_VERSION } from '../version';

interface DebugOverlayProps {
  mode: 'supabase' | 'local';
  connecting: boolean;
  room: RoomState | null;
  myAnswer: { questionId: string; optionIndex?: number; order?: number[] } | null;
}

interface EvEntry {
  t: string;
  el: number; // 距页面加载毫秒
  tag: string;
}

/**
 * 真机调试小工具：
 * - 右下角小字显示当前版本标签（复测时先确认是否最新代码）；
 * - 连点版本标签 6 次打开调试面板；
 * - 面板打开期间，在 window 捕获阶段记录 pointer/touch/click 事件，
 *   并展示房间阶段、活动题目、myAnswer 状态 —— 用于定位「点了没反应」断在哪一层。
 */
export function DebugOverlay({ mode, connecting, room, myAnswer }: DebugOverlayProps) {
  const [open, setOpen] = useState(false);
  const [taps, setTaps] = useState(0);
  const [events, setEvents] = useState<EvEntry[]>([]);
  const startRef = useRef(Date.now());
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onBadgeTap = () => {
    const n = taps + 1;
    setTaps(n);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTaps(0), 1600);
    if (n >= 6) {
      setOpen((v) => !v);
      setTaps(0);
    }
  };

  useEffect(() => {
    if (!open) return;
    const types = ['touchstart', 'touchend', 'touchmove', 'pointerdown', 'pointerup', 'pointercancel', 'click'];
    const onEv = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const cx = target?.className;
      const cls = typeof cx === 'string' ? cx.slice(0, 40) : '';
      setEvents((prev) =>
        [...prev, { t: e.type, el: Math.round(Date.now() - startRef.current), tag: `${target?.tagName ?? '?'}:${cls}` }].slice(-18),
      );
    };
    for (const type of types) window.addEventListener(type, onEv, { capture: true, passive: true });
    return () => {
      for (const type of types) window.removeEventListener(type, onEv, { capture: true });
    };
  }, [open]);

  const q = room?.activeQuestion;
  const remain = room?.questionEndsAt ? Math.max(0, room.questionEndsAt - Date.now()) : null;

  return (
    <>
      <button
        type="button"
        onClick={onBadgeTap}
        className="fixed bottom-1 right-2 z-[200] rounded-neo px-1 py-0.5 text-[10px] text-ink/45 opacity-70 select-none"
        style={{ touchAction: 'manipulation' }}
      >
        v{APP_VERSION}
      </button>

      {open && (
        <div className="fixed inset-x-2 bottom-8 z-[210] max-h-[70vh] overflow-auto rounded-neo border-2 border-white/25 bg-[#141414]/95 p-3 text-[11px] leading-relaxed text-white shadow-neo-lg">
          <div className="mb-1 flex items-center gap-2 font-black text-white">
            <span>🔧 调试面板</span>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-neo bg-white/15 px-2 py-0.5">
              关闭
            </button>
          </div>
          <div className="space-y-1 opacity-90">
            <div>版本: v{APP_VERSION} · 模式: {mode} · 连接中: {String(connecting)}</div>
            <div className="break-all">UA: {navigator.userAgent}</div>
            <div>
              阶段: {room?.phase ?? '无房间'} · 题型: {q?.kind ?? '-'} · 作答: {JSON.stringify(myAnswer)}
            </div>
            <div>选项数: {q?.options?.length ?? '-'} · 剩余: {remain == null ? '-' : `${Math.ceil(remain / 1000)}s`}</div>
            <div className="pt-1 text-ink/70">
              事件记录（打开面板后开始监听，捕获阶段，最后 18 条）：
            </div>
            {events.length === 0 ? (
              <div className="text-white/40">（暂无 —— 现在试着点一下答案，这里应立即出现 touchstart/pointerdown）</div>
            ) : (
              <div className="mt-1 grid grid-cols-[auto_auto_1fr] gap-x-2 gap-y-0.5 font-mono">
                {events.map((e, i) => (
                  <div key={i} className="grid contents">
                    <span className="text-white/40">{e.el}ms</span>
                    <span className={e.t === 'click' ? 'text-neo-green font-bold' : 'text-neo-yellow'}>{e.t}</span>
                    <span className="truncate text-white/60">{e.tag}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}