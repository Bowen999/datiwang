export interface ConnectOptions {
  roomCode: string;
  selfId: string;
}

export interface RealtimeHandlers {
  /** 收到广播消息 */
  onMessage: (msg: unknown) => void;
  /** 在线成员 id 列表变化 */
  onPresence: (ids: string[]) => void;
}

/**
 * 实时通信抽象层：UI/游戏逻辑只依赖该接口，
 * 可自由替换 Supabase、WebSocket 或本地演示实现。
 */
export interface RealtimeService {
  readonly mode: 'supabase' | 'local';
  connect(opts: ConnectOptions, handlers: RealtimeHandlers): Promise<void>;
  broadcast(msg: unknown): void;
  disconnect(): void;
}
