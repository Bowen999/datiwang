/** 洗牌（Fisher-Yates），返回新数组 */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 字符串 → 32 位哈希种子（FNV-1a 风格） */
export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 伪随机数发生器：同种子必产生同序列 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 可复现洗牌：用注入的 rng 代替 Math.random，同种子必同排列 */
export function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
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

import { randomAvatarStyle } from '../avatarStyles';

/** 随机头像种子（格式：风格id:种子，喂给 DiceBear 生成卡通头像，同种子必同头像） */
export function randomAvatar(): string {
  return `${randomAvatarStyle()}:${generateId()}`;
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

/** 文艺作品中的经典地点（游戏/动漫/电影/小说等），随机用作房间名 */
const ROOM_PLACES = [
  // 用户点名
  '霍格沃滋', '木叶村', '伟大航道', '武当山',
  // 小说/武侠
  '花果山', '大观园', '桃花岛', '光明顶', '黑木崖', '少林寺', '蜀山', '稻香村',
  // 动漫
  '圣域', '数码世界', '米花町', '真新镇',
  // 游戏
  '海拉鲁', '米德加', '艾泽拉斯', '德玛西亚', '提瓦特', '璃月', '王者峡谷', '罗德岛', '平安京', '苇名城',
  // 电影/动画电影
  '夏尔', '瓦坎达', '拉普达', '阿伦黛尔',
];

/** 随机房间名，如「木叶村」「艾泽拉斯」 */
export function randomRoomName(): string {
  return ROOM_PLACES[Math.floor(Math.random() * ROOM_PLACES.length)];
}
