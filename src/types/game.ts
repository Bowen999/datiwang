/** 难度 */
export type Difficulty = 'easy' | 'medium' | 'hard';

/** 题目类型：选择题 / 排序题（拖动选项排名） */
export type QuestionKind = 'choice' | 'ranking';

interface QuestionBase {
  id: string;
  category: string;
  difficulty: Difficulty;
  kind: QuestionKind;
  question: string;
  options: string[];
  explanation?: string;
}

/** 选择题：选项 + 正确下标 */
export interface ChoiceQuestion extends QuestionBase {
  kind: 'choice';
  correctAnswer: number;
}

/** 排序题：选项 + 正确排名（数组第 i 项 = 第 i 名对应的选项下标，0 起） */
export interface RankingQuestion extends QuestionBase {
  kind: 'ranking';
  correctOrder: number[];
}

/** 题库中的完整题目（含正确答案，仅数据源/房主侧可见） */
export type QuizQuestion = ChoiceQuestion | RankingQuestion;

/** 分类元信息 */
export interface CategoryMeta {
  id: string;
  name: string;
}

/** 下发给客户端的题目（不含正确答案） */
export type PublicQuestion =
  | Omit<ChoiceQuestion, 'correctAnswer' | 'explanation'>
  | Omit<RankingQuestion, 'correctOrder' | 'explanation'>;

export interface Player {
  id: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  streak: number;
  correctCount: number;
  isHost: boolean;
  connected: boolean;
  /** 是否已准备（房主无需准备） */
  ready: boolean;
  joinedAt: number;
}

/** 一名玩家在一轮中的作答记录 */
export interface AnswerRecord {
  playerId: string;
  optionIndex: number; // 选择题：选中下标；-1 表示超时未作答
  /** 排序题：玩家排出的顺序（选项下标数组，第 1 名起）；未作答为空数组 */
  order: number[];
  timeMs: number;
  correct: boolean;
  points: number;
}

export type RoomPhase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'final';

export interface GameSettings {
  roundSeconds: number;
  questionCount: number;
  categories: string[];
  difficulty: Difficulty | 'mixed';
  /** 勾选的题目类型；空数组表示全部 */
  questionTypes: QuestionKind[];
}

/** 揭晓阶段数据 */
export interface RevealData {
  kind: QuestionKind;
  correctAnswer?: number;
  correctOrder?: number[];
  explanation?: string;
  results: AnswerRecord[];
  endsAt: number;
}

/** 房间状态：由房主权威维护，全量广播给所有客户端 */
export interface RoomState {
  code: string;
  /** 房间名（随机生成，房主可换） */
  name: string;
  hostId: string;
  phase: RoomPhase;
  players: Player[];
  settings: GameSettings;
  round: number; // 当前题目序号（0 起）
  totalRounds: number;
  questionIds: string[];
  /** 本房间历史上已出过的题目 id（跨多局累计，防重复） */
  usedQuestionIds: string[];
  activeQuestion?: PublicQuestion;
  questionEndsAt?: number;
  countdownEndsAt?: number;
  answeredIds: string[];
  reveal?: RevealData;
  version: number;
}

/** 实时消息协议 */
export type GameMessage =
  | { t: 'join'; player: Pick<Player, 'id' | 'name' | 'avatar' | 'color'> }
  | { t: 'leave'; playerId: string }
  | { t: 'answer'; playerId: string; optionIndex?: number; order?: number[]; timeMs: number }
  | { t: 'ready'; playerId: string; ready: boolean }
  | { t: 'avatar'; playerId: string; avatar: string }
  | { t: 'state'; state: RoomState; sentAt: number };