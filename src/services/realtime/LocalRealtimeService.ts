import type { ConnectOptions, RealtimeHandlers, RealtimeService } from './types';

const HEARTBEAT_MS = 1500;
const STALE_MS = 4000;

interface Envelope {
  from: string;
  kind: 'msg' | 'hb' | 'bye';
  payload?: unknown;
}

/**
 * 本地演示实现：基于 BroadcastChannel，
 * 同一浏览器的多个标签页即可联机（无需 Supabase 配置）。
 */
export class LocalRealtimeService implements RealtimeService {
  readonly mode = 'local' as const;
  private channel: BroadcastChannel | null = null;
  private selfId = '';
  private handlers: RealtimeHandlers | null = null;
  private lastSeen = new Map<string, number>();
  private hbTimer: ReturnType<typeof setInterval> | null = null;

  connect(opts: ConnectOptions, handlers: RealtimeHandlers): Promise<void> {
    this.selfId = opts.selfId;
    this.handlers = handlers;
    this.lastSeen.set(opts.selfId, Date.now());
    this.channel = new BroadcastChannel(`party-quiz-${opts.roomCode}`);
    this.channel.onmessage = (e: MessageEvent<Envelope>) => {
      const env = e.data;
      if (!env || env.from === this.selfId) return;
      this.lastSeen.set(env.from, Date.now());
      if (env.kind === 'msg') this.handlers?.onMessage(env.payload);
      if (env.kind === 'bye') this.lastSeen.delete(env.from);
      this.emitPresence();
    };
    this.hbTimer = setInterval(() => {
      this.lastSeen.set(this.selfId, Date.now());
      this.channel?.postMessage({ from: this.selfId, kind: 'hb' } satisfies Envelope);
      const now = Date.now();
      for (const [id, at] of this.lastSeen) {
        if (id !== this.selfId && now - at > STALE_MS) this.lastSeen.delete(id);
      }
      this.emitPresence();
    }, HEARTBEAT_MS);
    // 立即广播一次心跳，让已有成员感知
    this.channel.postMessage({ from: this.selfId, kind: 'hb' } satisfies Envelope);
    setTimeout(() => this.emitPresence(), 50);
    return Promise.resolve();
  }

  private emitPresence() {
    this.handlers?.onPresence([...this.lastSeen.keys()]);
  }

  broadcast(msg: unknown): void {
    this.channel?.postMessage({ from: this.selfId, kind: 'msg', payload: msg } satisfies Envelope);
  }

  disconnect(): void {
    this.channel?.postMessage({ from: this.selfId, kind: 'bye' } satisfies Envelope);
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.channel?.close();
    this.channel = null;
    this.lastSeen.clear();
  }
}
