import { useState } from 'react';

interface QuestionImageProps {
  src: string;
  credit?: string;
  /** 揭晓阶段才显示署名，避免答题时干扰 */
  showCredit: boolean;
}

/** 看图题配图：加载中显示骨架，失败时给出提示；调用方用 key={src} 让每题重置状态 */
export function QuestionImage({ src, credit, showCredit }: QuestionImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  return (
    <figure className="mt-4">
      <div className="relative flex min-h-[9rem] items-center justify-center overflow-hidden rounded-neo border-[3px] border-ink bg-neo-yellow/20">
        {status === 'loading' && <div className="absolute inset-0 animate-pulse bg-ink/5" aria-hidden />}
        {status === 'error' ? (
          <p className="p-6 text-sm font-bold text-ink/60">图片加载失败，可凭直觉作答</p>
        ) : (
          <img
            src={src}
            alt="题目配图"
            decoding="async"
            draggable={false}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
            className={`max-h-[36vh] w-auto max-w-full object-contain transition-opacity duration-200 ${
              status === 'loaded' ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
      </div>
      {showCredit && credit && <figcaption className="mt-1 text-right text-[11px] font-bold text-ink/50">图片：{credit}</figcaption>}
    </figure>
  );
}
