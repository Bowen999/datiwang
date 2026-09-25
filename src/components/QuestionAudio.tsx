import { useEffect, useRef, useState } from 'react';

interface QuestionAudioProps {
  src: string;
  credit?: string;
  /** 揭晓阶段才显示署名，避免答题时干扰/泄题 */
  showCredit: boolean;
}

/**
 * 听音题音频：进题后尝试自动播放（浏览器要求先有用户交互，
 * 进过房、答过题就满足），被拦截则显示大号播放按钮。
 * 可不限次暂停/重播；调用方用 key={src} 让每题重置状态。
 */
export function QuestionAudio({ src, credit, showCredit }: QuestionAudioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'playing' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'auto';
    a.src = src;
    audioRef.current = a;
    const onReady = () => setStatus((s) => (s === 'loading' ? 'ready' : s));
    const onPlay = () => {
      setStatus('playing');
      setBlocked(false);
    };
    const onPause = () => setStatus((s) => (s === 'playing' ? 'ready' : s));
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => {
      setStatus('ready');
      setProgress(0);
    };
    const onError = () => setStatus('error');
    a.addEventListener('canplaythrough', onReady);
    a.addEventListener('playing', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onError);
    // 自动播放被浏览器拦截（无声自动播放策略）时，退化为手动点击
    a.play()
      .then(() => setBlocked(false))
      .catch(() => setBlocked(true));
    return () => {
      a.pause();
      a.src = '';
      audioRef.current = null;
    };
  }, [src]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (status === 'playing') a.pause();
    else void a.play().catch(() => setBlocked(true));
  };

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 rounded-neo border-[3px] border-ink bg-neo-blue/15 p-3">
        {status === 'error' ? (
          <p className="p-2 text-sm font-bold text-ink/60">音频加载失败，可凭直觉作答</p>
        ) : (
          <>
            <button
              type="button"
              onClick={toggle}
              aria-label={status === 'playing' ? '暂停' : '播放'}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[3px] border-ink text-xl font-black shadow-neo-sm transition-transform active:translate-y-0.5 active:shadow-none ${
                blocked ? 'animate-pulse bg-neo-yellow' : 'bg-white'
              }`}
            >
              {status === 'loading' ? '⏳' : status === 'playing' ? '⏸' : '▶️'}
            </button>
            <div className="flex-1">
              <div className="h-2.5 w-full overflow-hidden rounded-full border-2 border-ink bg-white">
                <div
                  className="h-full bg-neo-blue transition-[width] duration-200"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <div className="mt-1 text-[11px] font-bold text-ink/50">
                {blocked ? '🔊 点一下播放（浏览器要求手动开启声音）' : status === 'playing' ? '播放中…可反复听' : '点击按钮可重播'}
              </div>
            </div>
          </>
        )}
      </div>
      {showCredit && credit && <p className="mt-1 text-right text-[11px] font-bold text-ink/50">音频：{credit}</p>}
    </div>
  );
}
