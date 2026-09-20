/** 洗牌（Fisher-Yates），返回新数组 */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从数组中随机取 n 个（不放回） */
export function pickN<T>(arr: readonly T[], n: number): T[] {
  return shuffle(arr).slice(0, Math.max(0, n));
}

/** 生成 6 位房间码（去掉易混淆字符） */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** 生成玩家 ID */
export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const AVATARS = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🦄', '🐙', '🦖', '🐳', '🐝', '🦉', '🍉', '⚡', '🚀', '🎮'];

export const PLAYER_COLORS = ['#FFC800', '#FF5D8F', '#4D96FF', '#3ECF8E', '#9B5DE5', '#FF7A1A'];

/** 随机头像种子（喂给 DiceBear 生成卡通头像，同种子必同头像） */
export function randomAvatar(): string {
  return generateId();
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

const ANIMALS = ['熊猫', '霸王龙', '水豚', '柯基', '可达鸭', '卡皮巴拉', '吗喽', '章鱼哥', '哥斯拉', '皮卡丘', '土拨鼠', '水母'];
const FOODS = ['螺蛳粉', '奶茶', '火锅', '麻辣烫', '小笼包', '烤冷面', '臭豆腐', '糖葫芦', '泡面', '冰淇淋'];
const ADJ = ['快乐', '暴走', '摆烂', '摸鱼', '社恐', '显眼包', '熬夜', '干饭', '上头', '破防', '躺平', '亢奋'];
const ACTIONS = ['在月球蹦迪', '骑着扫帚飞', '偷喝可乐', '在银河钓鱼', '深夜放毒', '扛着音箱跑路', '在云端打滚', '开拖拉机兜风'];
const TITLES = ['扛把子', '课代表', '天花板', '小能手', '终结者', '代言人', '名誉会长', '在逃公主'];

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const NOUNS = [...ANIMALS, ...FOODS];

const NICK_PATTERNS: Array<() => string> = [
  () => `${pick(ADJ)}的${pick(NOUNS)}`,
  () => `${pick(ACTIONS)}的${pick(ANIMALS)}`,
  () => `${pick(FOODS)}界${pick(TITLES)}`,
  () => `爱吃${pick(FOODS)}的${pick(ANIMALS)}`,
  () => `${pick(ANIMALS)}${pick(TITLES)}`,
  () => `${pick(ADJ)}${pick(ANIMALS)}本${pick(['人', '熊', '龙', '鸭'])}`,
];

/** 随机中文昵称，如「在月球蹦迪的水豚」「螺蛳粉界扛把子」 */
export function randomNickname(): string {
  return pick(NICK_PATTERNS)().slice(0, 12);
}

const ROOM_PREFIX = ['疯狂', '欢乐', '巅峰', '摸鱼', '深夜', '周末', '摸金', '全明星', '龙卷风', '超级'];
const ROOM_SUFFIX = ['答题夜', '挑战赛', '大作战', '派对', '争霸赛', '头脑风暴', 'PK现场', '知识擂台'];

/** 随机房间名，如「疯狂答题夜」 */
export function randomRoomName(): string {
  return ROOM_PREFIX[Math.floor(Math.random() * ROOM_PREFIX.length)] + ROOM_SUFFIX[Math.floor(Math.random() * ROOM_SUFFIX.length)];
}
