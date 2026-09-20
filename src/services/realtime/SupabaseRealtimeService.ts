import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { ConnectOptions, RealtimeHandlers, RealtimeService } from './types';

const CHANNEL_PREFIX = 'party-quiz:';
const EVENT = 'msg';

/** 基于 Supabase Realtime（Broadcast + Presence）的房间通信，无需建表 */
export class SupabaseRealtimeService implements RealtimeService {
  readonly mode = 'supabase' as const;
  private client: SupabaseClient;
  private channel: RealtimeChannel | null = null;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }

  connect(opts: ConnectOptions, handlers: RealtimeHandlers): Promise<void> {
    return new Promise((resolve, reject) => {
      const channel = this.client.channel(CHANNEL_PREFIX + opts.roomCode, {
        config: { broadcast: { self: false }, presence: { key: opts.selfId } },
      });
      this.channel = channel;

      const timer = setTimeout(() => {
        reject(new Error('连接超时，请检查网络或房间号'));
      }, 10000);

      channel
        .on('broadcast', { event: EVENT }, ({ payload }) => handlers.onMessage(payload))
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          handlers.onPresence(Object.keys(state));
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            await channel.track({ id: opts.selfId, at: Date.now() });
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timer);
            reject(new Error('无法连接房间，请稍后再试'));
          }
        });
    });
  }

  broadcast(msg: unknown): void {
    void this.channel?.send({ type: 'broadcast', event: EVENT, payload: msg });
  }

  disconnect(): void {
    if (this.channel) {
      void this.channel.untrack();
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
