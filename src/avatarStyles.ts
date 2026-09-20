import {
  adventurer,
  bigEars,
  bigSmile,
  croodles,
  dylan,
  funEmoji,
  glass,
  lorelei,
  micah,
  miniavs,
  notionists,
  openPeeps,
  personas,
  pixelArt,
  toonHead,
} from '@dicebear/collection';
import type { Options, Style } from '@dicebear/core';

/**
 * 头像风格注册表：全部来自 @dicebear/collection 开源素材库
 * （DiceBear，各风格遵循 CC BY 4.0 / MIT 开源许可）。
 * 新增风格只需在下面加一行。
 */
const styles = {
  adventurer,
  bigEars,
  bigSmile,
  croodles,
  dylan,
  funEmoji,
  glass,
  lorelei,
  micah,
  miniavs,
  notionists,
  openPeeps,
  personas,
  pixelArt,
  toonHead,
} as const;

export type AvatarStyleId = keyof typeof styles;

/**
 * 各风格底层 Options 类型不同，但本项目只用它们都支持的通用选项
 * （seed / backgroundColor / scale / translateX 等），统一收窄为基类型。
 */
export const AVATAR_STYLES: Record<AvatarStyleId, Style<Options>> =
  styles as unknown as Record<AvatarStyleId, Style<Options>>;

export const AVATAR_STYLE_IDS = Object.keys(styles) as AvatarStyleId[];

/** 随机选一种头像风格 */
export function randomAvatarStyle(): AvatarStyleId {
  return AVATAR_STYLE_IDS[Math.floor(Math.random() * AVATAR_STYLE_IDS.length)];
}

/**
 * 解析头像字段（格式：`风格id:种子`，兼容旧格式的纯种子字符串）。
 * 旧数据（无冒号）统一回退到 adventurer。
 */
export function parseAvatar(avatar: string): { style: AvatarStyleId; seed: string } {
  const idx = avatar.indexOf(':');
  if (idx === -1) return { style: 'adventurer', seed: avatar };
  const style = avatar.slice(0, idx) as AvatarStyleId;
  return {
    style: style in AVATAR_STYLES ? style : 'adventurer',
    seed: avatar.slice(idx + 1) || avatar,
  };
}