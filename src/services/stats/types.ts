/** 访问统计事件类型 */
export type StatsEventType =
  | 'page_view' // 页面访问（含来源：直接打开 / 房间分享链接）
  | 'create_room' // 创建房间
  | 'join_room' // 加入房间
  | 'game_start' // 开始一局游戏
  | 'question_answered' // 作答一道题（揭晓后上报对错与分类）
  | 'game_end'; // 一局游戏结束（进入结算页）

/** 页面访问附加信息 */
export interface PageViewDetail {
  /** 来源渠道：直接打开首页 / 通过 ?room= 分享链接进入 */
  source: 'direct' | 'room';
  /** 外链来源（如有），截断到 200 字符 */
  referrer?: string | null;
}

/** 开局附加信息 */
export interface GameStartDetail {
  players: number;
  /** 勾选的分类数（0 = 全部分类） */
  categoryCount: number;
  rounds: number;
}

/** 单题作答附加信息 */
export interface QuestionAnsweredDetail {
  correct: boolean;
  category: string;
  kind: string;
}

/** 结算附加信息 */
export interface GameEndDetail {
  players: number;
  rounds: number;
}

/** 单条统计事件（与数据库 visit_events 表结构对应） */
export interface StatsEvent {
  eventType: StatsEventType;
  clientId: string;
  sessionId: string;
  country?: string | null;
  city?: string | null;
  detail: Record<string, unknown>;
  /** ISO 时间字符串 */
  createdAt: string;
}