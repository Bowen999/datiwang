import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceAfterReveal,
  computeReveal,
  createRoomState,
  launchQuestion,
  questionTimeMs,
  resetToLobby,
  shuffleQuestionOptions,
  startCountdown,
} from '../game/gameLogic';
import { questionService } from '../services/QuestionService';
import { createRealtimeService, isSupabaseConfigured } from '../services/realtime';
import { visitStats } from '../services/stats';
import type { RealtimeService } from '../services/realtime/types';
import type {
  CategoryMeta,
  GameMessage,
  GameSettings,
  Player,
  QuizQuestion,
  RoomState,
} from '../types/game';
import { generateId, generateRoomCode, randomAvatar, randomRoomName } from '../utils/random';

export interface Notice {
  id: number;
  text: string;
  icon?: string;
}

interface MyAnswer {
  questionId: string;
  optionIndex?: number;
  order?: number[];
}

/** 作答载荷：选择题传 optionIndex，排序题传 order */
export type AnswerPayload = { optionIndex?: number; order?: number[] };

/**
 * 玩家身份 ID：基于 sessionStorage（每个标签页一个身份）。
 * 「同名重复玩家」问题不靠身份合并解决（那样会让同浏览器的两个活标签页
 * 合并成同一个人、甚至被第二个标签页劫持房主），而是由房主侧做同名去重：
 * - 昵称与「在线玩家/房主」重复 → 拒绝加入并要求换昵称；
 * - 昵称与「离线幽灵玩家」重复 → 直接复活该玩家槽位，避免同名双人。
 */
function sessionSelfId(): string {
  try {
    let id = sessionStorage.getItem('datiwang:uid');
    if (!id) {
      id = generateId();
      sessionStorage.setItem('datiwang:uid', id);
    }
    return id;
  } catch {
    // 隐私/兼容模式下存储不可用：退化为内存唯一 id
    return generateId();
  }
}

/** 昵称归一化（忽略大小写与首尾空格），用于同名去重 */
function normalizeName(s: string): string {
  return (s ?? '').trim().toLocaleLowerCase('zh-CN');
}

const COLORS = ['#FFC800', '#FF5D8F', '#4D96FF', '#3ECF8E', '#9B5DE5', '#FF7A1A'];

/** 大厅中玩家离线超过该时长（毫秒）即视为残留幽灵，房主自动清理 */
const OFFLINE_PRUNE_MS = 15000;

/** 预载的音频元素挂在这里，防止被 GC 回收导致下载中断 */
const preloadedAudioPool: HTMLAudioElement[] = [];

/**
 * 房间 Hook：把实时服务、房主权威逻辑与 React 状态粘合起来。
 * 所有游戏状态变更都通过房主广播 RoomState 完成。
 */
export function useRoom() {
  const selfId = useMemo(sessionSelfId, []);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [myAnswer, setMyAnswer] = useState<MyAnswer | null>(null);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  /** 被房主踢出后显示踢人来源（null = 正常状态） */
  const [kickedBy, setKickedBy] = useState<string | null>(null);
  /** 被踢后是否已提交重新加入申请（等待房主审批） */
  const [joinApplied, setJoinApplied] = useState(false);

  const serviceRef = useRef<RealtimeService | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const clockOffsetRef = useRef(0);
  const answersRef = useRef(new Map<string, { optionIndex?: number; order?: number[]; timeMs: number }>());
  const hostQuestionsRef = useRef(new Map<string, QuizQuestion>());
  /** 加入房间的发起时刻：刚进房几秒内禁止抢房主，防止手机弱网下误接管 */
  const joinStartedAtRef = useRef(0);
  /** 看到房主缺失的起始时刻：需持续缺失才允许接管房主 */
  const hostAbsentSinceRef = useRef<number | null>(null);
  /** 加入等待回调：true=加入成功；'rejected'=被房主拒绝（昵称占用等） */
  const joinWaiterRef = useRef<((status: boolean | 'rejected') => void) | null>(null);
  const noticeIdRef = useRef(0);
  /** 是否处于“被踢”状态（期间忽略不含自己的房间状态，除非房主批准重进） */
  const kickedRef = useRef(false);
  /** 被踢前的个人信息，用于申请重新加入 */
  const selfPlayerRef = useRef<Pick<Player, 'id' | 'name' | 'avatar' | 'color'> | null>(null);
  /** 答题统计去重：每道题只上报一次自己的作答结果 */
  const answerTrackedRef = useRef('');
  /** 结算统计去重：每局只上报一次 game_end */
  const gameEndTrackedRef = useRef('');

  const isHost = room != null && room.hostId === selfId;
  const now = useCallback(() => Date.now() + clockOffsetRef.current, []);

  const pushNotice = useCallback((text: string, icon?: string) => {
    const id = ++noticeIdRef.current;
    setNotices((ns) => [...ns, { id, text, icon }]);
    setTimeout(() => setNotices((ns) => ns.filter((n) => n.id !== id)), 3200);
  }, []);

  const applyRoom = useCallback((next: RoomState | null) => {
    roomRef.current = next;
    setRoom(next);
  }, []);

  /** 房主专用：更新并广播状态 */
  const publish = useCallback(
    (state: RoomState) => {
      const versioned = { ...state, version: Date.now() };
      applyRoom(versioned);
      serviceRef.current?.broadcast({ t: 'state', state: versioned, sentAt: Date.now() } satisfies GameMessage);
    },
    [applyRoom],
  );

  // ---------- 房主：记录答案 / 结算 ----------
  const hostReveal = useCallback(() => {
    const st = roomRef.current;
    if (!st || st.phase !== 'question' || !st.activeQuestion) return;
    const q = hostQuestionsRef.current.get(st.questionIds[st.round]);
    if (!q) return;
    const { state } = computeReveal(st, q, answersRef.current, Date.now());
    publish(state);
  }, [publish]);

  const hostRecordAnswer = useCallback(
    (playerId: string, payload: AnswerPayload, timeMs: number) => {
      const st = roomRef.current;
      if (!st || st.hostId !== selfId || st.phase !== 'question') return;
      const isNew = !answersRef.current.has(playerId);
      // 允许修改答案：以最后一次选择为准（含时间）
      answersRef.current.set(playerId, { ...payload, timeMs });
      // 仅首次作答时广播进度，避免改答案时刷屏
      if (isNew) {
        const answeredIds = [...new Set([...st.answeredIds, playerId])];
        publish({ ...st, answeredIds });
      }
      // 非抢答机制：不在全员答完时提前揭晓，等计时结束统一结算。
      // 单人模式（房间只有房主一人）例外：作答完成即提交揭晓，无需等倒计时结束。
      if (st.players.length === 1) {
        hostReveal();
      }
    },
    [selfId, publish, hostReveal],
  );

  /** 被踢 / 被移出房间：保留连接（以便申请重新加入并即时收到审批），清空房间状态 */
  const handleKicked = useCallback(
    (byName?: string) => {
      const st = roomRef.current;
      if (st) {
        const me = st.players.find((p) => p.id === selfId);
        if (me) selfPlayerRef.current = { id: me.id, name: me.name, avatar: me.avatar, color: me.color };
      }
      kickedRef.current = true;
      setJoinApplied(false);
      answersRef.current = new Map();
      hostQuestionsRef.current = new Map();
      joinWaiterRef.current = null;
      clockOffsetRef.current = 0;
      applyRoom(null);
      setMyAnswer(null);
      setKickedBy(byName ?? '房主');
      pushNotice('你已被移出房间', '🚫');
    },
    [applyRoom, pushNotice, selfId],
  );

  // ---------- 消息处理 ----------
  const handleMessage = useCallback(
    (raw: unknown) => {
      const msg = raw as GameMessage;
      const st = roomRef.current;

      if (msg.t === 'state') {
        clockOffsetRef.current = msg.sentAt - Date.now();
        const prev = roomRef.current;
        if (prev && msg.state.version < prev.version) return; // 过期状态
        if (prev && msg.state.code !== prev.code) return;
        const selfInState = msg.state.players.some((p) => p.id === selfId);
        // 被踢期间本地房间已清空：只接受“我重新变成成员”的状态（即房主批准重进）
        if (prev === null && kickedRef.current && !selfInState) return;
        // 兜底检测：房主把我们移出了成员列表（此时 kick 消息可能先到或已错过）
        if (
          prev &&
          prev.players.some((p) => p.id === selfId) &&
          !selfInState
        ) {
          const byName = prev.players.find((p) => p.id === msg.state.hostId)?.name;
          handleKicked(byName);
          return;
        }
        // 房主已批准重新加入：解除被踢状态
        if (kickedRef.current && selfInState) {
          kickedRef.current = false;
          setKickedBy(null);
          setJoinApplied(false);
          pushNotice('房主已同意你重新加入', '🎉');
        }
        // 玩家加入提示
        if (prev) {
          const prevIds = new Set(prev.players.map((p) => p.id));
          for (const p of msg.state.players) {
            if (!prevIds.has(p.id)) pushNotice(`${p.name} 加入了游戏`, '👋');
          }
          if (prev.hostId !== msg.state.hostId) {
            const h = msg.state.players.find((p) => p.id === msg.state.hostId);
            if (h && h.id !== selfId) pushNotice(`${h.name} 成为新房主`, '👑');
          }
        }
        applyRoom(msg.state);
        // 只有自己真正进入成员列表才结束「加入中」；其它无关状态（如他人改设置）
        // 的广播不应提前中止加入流程（避免弱网下误判“找不到房间”）
        if (selfInState) joinWaiterRef.current?.(true);
        return;
      }

      // 被房主点名踢出
      if (msg.t === 'kick' && msg.playerId === selfId) {
        const byName = st?.players.find((p) => p.id === msg.by)?.name;
        handleKicked(byName);
        return;
      }

      // 房主拒绝加入（昵称被占用等）：立即停止重试并提示换昵称
      if (msg.t === 'join-denied' && msg.playerId === selfId) {
        joinWaiterRef.current?.('rejected');
        return;
      }

      // 房主对重新加入申请的答复（针对被踢者本人）
      if (msg.t === 'join-reply' && msg.playerId === selfId) {
        if (!msg.accept) {
          setJoinApplied(false);
          pushNotice('房主拒绝了你的加入申请', '😢');
        }
        return;
      }

      // 以下只有房主处理
      if (!st || st.hostId !== selfId) return;

      if (msg.t === 'join') {
        const exists = st.players.some((p) => p.id === msg.player.id);
        // 房主自己无需加入（防止同源标签页克隆 sessionStorage 后“重连”顶掉房主身份）
        if (msg.player.id === st.hostId) return;
        // 被踢过的玩家：拒绝再次加入（无需改状态，仅提示对方）
        if (!exists && st.kickedIds?.includes(msg.player.id)) {
          serviceRef.current?.broadcast({ t: 'kick', playerId: msg.player.id, by: selfId } satisfies GameMessage);
          return;
        }
        if (exists) {
          // 重连：恢复在线状态（头像沿用消息里的，昵称以消息为准）
          publish({
            ...st,
            players: st.players.map((p) =>
              p.id === msg.player.id
                ? { ...p, connected: true, name: msg.player.name, avatar: msg.player.avatar, offlineSince: undefined }
                : p,
            ),
          });
          return;
        }
        // 同名去重：同一昵称只保留一个玩家（忽略大小写/首尾空格）
        const jName = msg.player.name?.trim();
        if (jName) {
          const conflict = st.players.find(
            (p) => p.name && normalizeName(p.name) === normalizeName(jName),
          );
          if (conflict) {
            if (conflict.connected || conflict.isHost) {
              // 昵称已被在线的玩家占用（含房主）：拒绝并入，提示改昵称
              serviceRef.current?.broadcast({ t: 'join-denied', playerId: msg.player.id } satisfies GameMessage);
              pushNotice(`「${jName}」昵称已被占用，请换个名字`, '⚠️');
              return;
            }
            // 占用该昵称的旧玩家已离线（幽灵残留）：把身份迁移给新加入者，避免出现同名双人
            publish({
              ...st,
              players: st.players.map((p) =>
                p.id === conflict.id
                  ? {
                      ...p,
                      id: msg.player.id,
                      name: msg.player.name,
                      avatar: msg.player.avatar,
                      connected: true,
                      ready: false,
                      offlineSince: undefined,
                    }
                  : p,
              ),
              kickedIds: (st.kickedIds ?? []).filter((id) => id !== conflict.id),
            });
            return;
          }
        }
        const usedColors = new Set(st.players.map((p) => p.color));
        const color = COLORS.find((c) => !usedColors.has(c)) ?? COLORS[st.players.length % COLORS.length];
        const player: Player = {
          ...msg.player,
          color,
          score: 0,
          streak: 0,
          correctCount: 0,
          isHost: false,
          connected: true,
          ready: false,
          joinedAt: Date.now(),
        };
        publish({ ...st, players: [...st.players, player] });
      } else if (msg.t === 'apply-join') {
        // 被踢玩家的重新加入申请：非被踢玩家按普通加入处理，被踢玩家进入待审批队列
        const inPlayers = st.players.some((p) => p.id === msg.player.id);
        if (inPlayers) return;
        // 同名去重：昵称已被在线玩家/房主占用则直接拒绝
        const aName = msg.player.name?.trim();
        if (aName) {
          const conflict = st.players.find(
            (p) => p.name && normalizeName(p.name) === normalizeName(aName) && (p.connected || p.isHost),
          );
          if (conflict) {
            serviceRef.current?.broadcast({ t: 'join-reply', playerId: msg.player.id, accept: false } satisfies GameMessage);
            pushNotice(`「${aName}」昵称已被占用，无法重新加入`, '⚠️');
            return;
          }
        }
        if (!st.kickedIds?.includes(msg.player.id)) {
          const usedColors = new Set(st.players.map((p) => p.color));
          const color = COLORS.find((c) => !usedColors.has(c)) ?? COLORS[st.players.length % COLORS.length];
          const player: Player = {
            ...msg.player,
            color,
            score: 0,
            streak: 0,
            correctCount: 0,
            isHost: false,
            connected: true,
            ready: false,
            joinedAt: Date.now(),
          };
          publish({ ...st, players: [...st.players, player] });
          return;
        }
        const reqs = st.joinRequests ?? [];
        if (reqs.some((r) => r.player.id === msg.player.id)) return; // 已在队列
        publish({ ...st, joinRequests: [...reqs, { player: msg.player, at: Date.now() }] });
        pushNotice(`${msg.player.name} 申请重新加入`, '✋');
      } else if (msg.t === 'leave') {
        const target = st.players.find((p) => p.id === msg.playerId);
        if (!target) return;
        if (st.phase === 'lobby') {
          publish({ ...st, players: st.players.filter((p) => p.id !== msg.playerId) });
        } else {
          publish({
            ...st,
            players: st.players.map((p) => (p.id === msg.playerId ? { ...p, connected: false } : p)),
          });
        }
      } else if (msg.t === 'answer') {
        hostRecordAnswer(msg.playerId, { optionIndex: msg.optionIndex, order: msg.order }, msg.timeMs);
      } else if (msg.t === 'ready') {
        publish({
          ...st,
          players: st.players.map((p) => (p.id === msg.playerId ? { ...p, ready: msg.ready } : p)),
        });
      } else if (msg.t === 'avatar') {
        publish({
          ...st,
          players: st.players.map((p) => (p.id === msg.playerId ? { ...p, avatar: msg.avatar } : p)),
        });
      }
    },
    [selfId, applyRoom, publish, pushNotice, hostRecordAnswer, handleKicked],
  );

  // ---------- 在线状态（Presence）----------
  const handlePresence = useCallback(
    (ids: string[]) => {
      const st = roomRef.current;
      if (!st) return;
      const present = new Set(ids);

      if (st.hostId === selfId) {
        // 房主：同步玩家在线状态（记录离线起始时刻，供大厅清理幽灵玩家）
        const nowMs = Date.now();
        const players = st.players.map((p) => {
          const online = present.has(p.id);
          if (p.id === st.hostId) return { ...p, connected: true, offlineSince: undefined };
          return {
            ...p,
            connected: online,
            offlineSince: online ? undefined : (p.offlineSince ?? nowMs),
          };
        });
        const changed = st.players.some((p, i) => {
          const np = players[i];
          return p.connected !== np.connected || p.offlineSince !== np.offlineSince;
        });
        if (changed) publish({ ...st, players });
        return;
      }

      // 非房主：检测房主是否离线 → 房主迁移
      if (!present.has(st.hostId)) {
        // 防误判：手机弱网/重连瞬间 presence 短暂缺失，不强求立刻接管。
        // 需房主持续缺失 4 秒以上，且本人进房已超过 6 秒，才进行迁移。
        const nowMs = Date.now();
        if (hostAbsentSinceRef.current == null) hostAbsentSinceRef.current = nowMs;
        if (nowMs - hostAbsentSinceRef.current < 4000) return;
        if (joinStartedAtRef.current > 0 && nowMs - joinStartedAtRef.current < 6000) return;
        const candidates = st.players
          .filter((p) => present.has(p.id))
          .sort((a, b) => a.joinedAt - b.joinedAt);
        const successor = candidates[0];
        if (successor && successor.id === selfId) {
          void (async () => {
            try {
              // 重建题目数据以接管房主职责
              if (st.questionIds.length > 0) {
                hostQuestionsRef.current = await questionService.getByIds(
                  st.questionIds,
                  st.settings.categories,
                );
              }
            } catch {
              /* 题目重建失败时仍能接管大厅 */
            }
            const current = roomRef.current;
            if (!current || current.hostId === selfId) return;
            if (current.players.some((p) => p.id === st.hostId && p.connected)) return;
            hostAbsentSinceRef.current = null;
            pushNotice('房主已离开，你接任房主', '👑');
            publish({
              ...current,
              hostId: selfId,
              players: current.players.map((p) => ({
                ...p,
                connected: present.has(p.id) || p.id === selfId,
                isHost: p.id === selfId,
              })),
            });
          })();
        }
      } else {
        hostAbsentSinceRef.current = null;
      }
    },
    [selfId, publish, pushNotice],
  );

  // ---------- 房主游戏循环 ----------
  useEffect(() => {
    if (!isHost || !room) return;
    if (room.phase !== 'countdown' && room.phase !== 'question' && room.phase !== 'reveal') return;
    const timer = setInterval(() => {
      const st = roomRef.current;
      if (!st || st.hostId !== selfId) return;
      const t = Date.now();
      if (st.phase === 'countdown' && st.countdownEndsAt && t >= st.countdownEndsAt) {
        const q = hostQuestionsRef.current.get(st.questionIds[st.round]);
        if (!q) return;
        answersRef.current = new Map();
        publish(launchQuestion(st, q, t));
      } else if (st.phase === 'question' && st.questionEndsAt && t >= st.questionEndsAt + 300) {
        hostReveal();
      } else if (st.phase === 'reveal' && st.reveal && t >= st.reveal.endsAt) {
        publish(advanceAfterReveal(st, t));
      }
    }, 250);
    return () => clearInterval(timer);
  }, [isHost, room?.phase, selfId, publish, hostReveal]);

  // 我的答案随题目切换而重置
  useEffect(() => {
    setMyAnswer(null);
  }, [room?.round, room?.phase === 'question' ? room.activeQuestion?.id : null]);

  // 访问统计：揭晓阶段上报自己的作答结果（每道题一次，去重）
  useEffect(() => {
    const st = room;
    if (!st || st.phase !== 'reveal' || !st.reveal || !st.activeQuestion) return;
    const mine = st.reveal.results.find((r) => r.playerId === selfId);
    if (!mine) return;
    const key = `${st.code}:${st.round}:${st.activeQuestion.id}`;
    if (answerTrackedRef.current === key) return;
    answerTrackedRef.current = key;
    visitStats.track('question_answered', {
      correct: mine.correct,
      category: st.activeQuestion.category,
      kind: st.activeQuestion.kind,
      questionId: st.activeQuestion.id,
    });
  }, [room, selfId]);

  // 访问统计：进入结算页时上报一局结束（每局一次，去重）
  useEffect(() => {
    const st = room;
    if (!st || st.phase !== 'final') return;
    const gameId = `${st.code}#${st.questionIds.join(',')}`;
    if (gameEndTrackedRef.current === gameId) return;
    gameEndTrackedRef.current = gameId;
    visitStats.track('game_end', {
      players: st.players.length,
      rounds: st.totalRounds,
    });
  }, [room]);

  // 看图题：开局时各端提前把本局配图拉进浏览器缓存，避免到了答题时才开始下载
  const preloadKey = room?.preloadImages?.join('|') ?? '';
  useEffect(() => {
    if (!preloadKey) return;
    for (const src of preloadKey.split('|')) new Image().src = src;
  }, [preloadKey]);

  // 听音题：同理预载音频。挂在模块级数组上防止被 GC 中断下载
  const preloadAudioKey = room?.preloadAudio?.join('|') ?? '';
  useEffect(() => {
    if (!preloadAudioKey) return;
    for (const src of preloadAudioKey.split('|')) {
      const a = new Audio();
      a.preload = 'auto';
      a.src = src;
      preloadedAudioPool.push(a);
    }
  }, [preloadAudioKey]);

  // 房主专用：大厅清理长时间掉线的幽灵玩家（关标签页/断网遗留的残留会显示为「离线」）
  useEffect(() => {
    if (!isHost || !room || room.phase !== 'lobby') return;
    const timer = setInterval(() => {
      const st = roomRef.current;
      if (!st || st.hostId !== selfId || st.phase !== 'lobby') return;
      const nowMs = Date.now();
      const stale = st.players.filter(
        (p) => !p.isHost && !p.connected && p.offlineSince != null && nowMs - p.offlineSince > OFFLINE_PRUNE_MS,
      );
      if (stale.length === 0) return;
      const staleIds = new Set(stale.map((p) => p.id));
      publish({
        ...st,
        players: st.players.filter((p) => !staleIds.has(p.id)),
        answeredIds: st.answeredIds.filter((id) => !staleIds.has(id)),
        reveal: st.reveal
          ? { ...st.reveal, results: st.reveal.results.filter((r) => !staleIds.has(r.playerId)) }
          : undefined,
      });
      for (const p of stale) pushNotice(`已清理掉线玩家「${p.name}」`, '🧹');
    }, 5000);
    return () => clearInterval(timer);
  }, [isHost, room?.phase, selfId, publish, pushNotice]);

  // 加载题库分类
  useEffect(() => {
    questionService
      .listCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  // ---------- 对外操作 ----------
  const connect = useCallback(
    async (code: string) => {
      const service = createRealtimeService();
      serviceRef.current = service;
      await service.connect(
        { roomCode: code, selfId },
        { onMessage: handleMessage, onPresence: handlePresence },
      );
      return service;
    },
    [selfId, handleMessage, handlePresence],
  );

  const createRoom = useCallback(
    async (name: string, settings: GameSettings) => {
      setConnecting(true);
      setError(null);
      try {
        const code = generateRoomCode();
        await connect(code);
        const host: Player = {
          id: selfId,
          name,
          avatar: randomAvatar(),
          color: COLORS[0],
          score: 0,
          streak: 0,
          correctCount: 0,
          isHost: true,
          connected: true,
          ready: true,
          joinedAt: Date.now(),
        };
        applyRoom(createRoomState(code, randomRoomName(), host, settings, Date.now()));
        visitStats.track('create_room', {});
      } catch (e) {
        setError(e instanceof Error ? e.message : '创建房间失败');
      } finally {
        setConnecting(false);
      }
    },
    [connect, selfId, applyRoom],
  );

  const joinRoom = useCallback(
    async (code: string, name: string) => {
      setConnecting(true);
      setError(null);
      joinStartedAtRef.current = Date.now();
      try {
        const service = await connect(code.toUpperCase());
        // 加入载荷只生成一次（重试沿用同一头像，避免同一玩家反复换头像的怪异观感）
        const player = { id: selfId, name, avatar: randomAvatar(), color: COLORS[0] };
        joinWaiterRef.current = null;
        const result = await new Promise<'ok' | 'rejected' | 'timeout'>((resolve) => {
          service.broadcast({ t: 'join', player } satisfies GameMessage);
          // 多次重发，防止房主恰好错过
          const retry = setInterval(() => {
            service.broadcast({ t: 'join', player } satisfies GameMessage);
          }, 1200);
          const finish = (r: 'ok' | 'rejected' | 'timeout') => {
            clearInterval(retry);
            resolve(r);
          };
          const timer = setTimeout(() => finish('timeout'), 8000);
          joinWaiterRef.current = (status) => {
            clearTimeout(timer);
            finish(status === true ? 'ok' : status === 'rejected' ? 'rejected' : 'timeout');
          };
        });
        joinWaiterRef.current = null;
        if (result !== 'ok') {
          // 即使没加入成功，也可能已被房主接收过（重发期间）——补发 leave 防止残留幽灵玩家
          service.broadcast({ t: 'leave', playerId: selfId } satisfies GameMessage);
          service.disconnect();
          serviceRef.current = null;
          setError(result === 'rejected' ? '该昵称已被使用，请换个名字再试' : '找不到这个房间，检查一下房间码？');
        } else {
          visitStats.track('join_room', {});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '加入房间失败');
      } finally {
        setConnecting(false);
      }
    },
    [connect, selfId],
  );

  const leaveRoom = useCallback(() => {
    if (roomRef.current) {
      serviceRef.current?.broadcast({ t: 'leave', playerId: selfId } satisfies GameMessage);
    }
    serviceRef.current?.disconnect();
    serviceRef.current = null;
    answersRef.current = new Map();
    hostQuestionsRef.current = new Map();
    clockOffsetRef.current = 0;
    applyRoom(null);
    setMyAnswer(null);
  }, [selfId, applyRoom]);

  const updateSettings = useCallback(
    (patch: Partial<GameSettings>) => {
      const st = roomRef.current;
      if (!st || st.hostId !== selfId || st.phase !== 'lobby') return;
      // 改动设置后全员需重新准备
      publish({
        ...st,
        settings: { ...st.settings, ...patch },
        players: st.players.map((p) => ({ ...p, ready: false })),
      });
    },
    [selfId, publish],
  );

  /** 玩家准备/取消准备 */
  const setReady = useCallback(
    (ready: boolean) => {
      const st = roomRef.current;
      if (!st || st.phase !== 'lobby') return;
      if (st.hostId === selfId) return; // 房主无需准备
      serviceRef.current?.broadcast({ t: 'ready', playerId: selfId, ready } satisfies GameMessage);
    },
    [selfId],
  );

  /** 房主重摇房间名 */
  const renameRoom = useCallback(() => {
    const st = roomRef.current;
    if (!st || st.hostId !== selfId || st.phase !== 'lobby') return;
    publish({ ...st, name: randomRoomName() });
  }, [selfId, publish]);

  /** 更换自己的头像（随机换一个新的） */
  const rerollAvatar = useCallback(() => {
    const st = roomRef.current;
    if (!st || st.phase !== 'lobby') return;
    const avatar = randomAvatar();
    if (st.hostId === selfId) {
      publish({
        ...st,
        players: st.players.map((p) => (p.id === selfId ? { ...p, avatar } : p)),
      });
    } else {
      serviceRef.current?.broadcast({ t: 'avatar', playerId: selfId, avatar } satisfies GameMessage);
    }
  }, [selfId, publish]);

  const startGame = useCallback(async () => {
    const st = roomRef.current;
    if (!st || st.hostId !== selfId || st.phase !== 'lobby') return;
    const notReady = st.players.filter((p) => !p.isHost && p.connected && !p.ready);
    if (notReady.length > 0) {
      pushNotice(`还有 ${notReady.length} 位玩家未准备`, '⏳');
      return;
    }
    try {
      const questions = await questionService.getQuestions({
        categories: st.settings.categories,
        difficulty: st.settings.difficulty,
        questionTypes: st.settings.questionTypes,
        count: st.settings.questionCount,
        // 排除本房间历史已出题目，避免重复
        excludeIds: st.usedQuestionIds,
      });
      if (questions.length === 0) {
        pushNotice('题库里没有符合条件的题目', '⚠️');
        return;
      }
      // 每局重新洗牌选项顺序
      const shuffled = questions.map(shuffleQuestionOptions);
      hostQuestionsRef.current = new Map(shuffled.map((q) => [q.id, q]));
      answersRef.current = new Map();
      const next = startCountdown(st, shuffled.map((q) => q.id), Date.now());
      publish({
        ...next,
        usedQuestionIds: [...st.usedQuestionIds, ...next.questionIds],
        preloadImages: shuffled.map((q) => q.image).filter((src): src is string => !!src),
        preloadAudio: shuffled.map((q) => q.audio).filter((src): src is string => !!src),
      });
      visitStats.track('game_start', {
        players: st.players.filter((p) => p.connected || p.isHost).length || st.players.length,
        categoryCount: st.settings.categories.length,
        rounds: shuffled.length,
      });
    } catch {
      pushNotice('题库加载失败，请重试', '⚠️');
    }
  }, [selfId, publish, pushNotice]);

  const submitAnswer = useCallback(
    (payload: AnswerPayload) => {
      const st = roomRef.current;
      if (!st || st.phase !== 'question' || !st.activeQuestion || !st.questionEndsAt) return;
      const isRanking = st.activeQuestion.kind === 'ranking';
      const timeMs = Math.max(0, questionTimeMs(st.activeQuestion.kind, st.settings.roundSeconds, !!st.activeQuestion.audio) - (st.questionEndsAt - now()));
      // 重复提交同一答案忽略；修改则覆盖（时间以最后一次为准）
      const same =
        myAnswer != null &&
        myAnswer.questionId === st.activeQuestion.id &&
        (isRanking
          ? myAnswer.order != null &&
            payload.order != null &&
            myAnswer.order.length === payload.order.length &&
            myAnswer.order.every((v, i) => v === payload.order?.[i])
          : myAnswer.optionIndex === payload.optionIndex);
      if (same) return;
      const answer: { optionIndex?: number; order?: number[] } = isRanking
        ? { order: payload.order }
        : { optionIndex: payload.optionIndex };
      setMyAnswer({ questionId: st.activeQuestion.id, ...answer });
      if (st.hostId === selfId) {
        hostRecordAnswer(selfId, answer, timeMs);
      } else {
        serviceRef.current?.broadcast({ t: 'answer', playerId: selfId, ...answer, timeMs } satisfies GameMessage);
      }
    },
    [myAnswer, selfId, now, hostRecordAnswer],
  );

  /** 房主手动跳到下一题 */
  const nextRound = useCallback(() => {
    const st = roomRef.current;
    if (!st || st.hostId !== selfId || st.phase !== 'reveal') return;
    publish(advanceAfterReveal(st, Date.now()));
  }, [selfId, publish]);

  const playAgain = useCallback(() => {
    const st = roomRef.current;
    if (!st || st.hostId !== selfId) return;
    answersRef.current = new Map();
    publish(resetToLobby(st, Date.now()));
  }, [selfId, publish]);

  /** 房主踢出玩家（游戏进行中也适用，作答记录一并清理） */
  const kickPlayer = useCallback(
    (playerId: string) => {
      const st = roomRef.current;
      if (!st || st.hostId !== selfId) return;
      if (playerId === selfId || playerId === st.hostId) return;
      const target = st.players.find((p) => p.id === playerId);
      if (!target) return;
      // 通知被踢者本人（房主收不到自己发的广播）
      serviceRef.current?.broadcast({ t: 'kick', playerId, by: selfId } satisfies GameMessage);
      answersRef.current.delete(playerId);
      const answeredIds = st.answeredIds.filter((id) => id !== playerId);
      const reveal = st.reveal
        ? { ...st.reveal, results: st.reveal.results.filter((r) => r.playerId !== playerId) }
        : undefined;
      publish({
        ...st,
        players: st.players.filter((p) => p.id !== playerId),
        answeredIds,
        reveal,
        kickedIds: [...new Set([...(st.kickedIds ?? []), playerId])],
        joinRequests: (st.joinRequests ?? []).filter((r) => r.player.id !== playerId),
      });
      pushNotice(`已将「${target.name}」移出房间`, '🚫');
    },
    [selfId, publish, pushNotice],
  );

  /** 被踢后申请重新加入（等待房主审批） */
  const applyJoin = useCallback(() => {
    const me = selfPlayerRef.current;
    if (!me || !serviceRef.current) return;
    serviceRef.current.broadcast({
      t: 'apply-join',
      player: { id: me.id, name: me.name, avatar: me.avatar, color: me.color },
    } satisfies GameMessage);
    setJoinApplied(true);
    pushNotice('已发送加入申请，等待房主同意…', '✋');
  }, []);

  /** 房主审批被踢玩家的重新加入申请 */
  const respondJoinRequest = useCallback(
    (playerId: string, accept: boolean) => {
      const st = roomRef.current;
      if (!st || st.hostId !== selfId) return;
      const req = (st.joinRequests ?? []).find((r) => r.player.id === playerId);
      if (!req) return;
      const joinRequests = (st.joinRequests ?? []).filter((r) => r.player.id !== playerId);
      if (!accept) {
        serviceRef.current?.broadcast({ t: 'join-reply', playerId, accept: false } satisfies GameMessage);
        publish({ ...st, joinRequests });
        pushNotice(`已拒绝「${req.player.name}」的加入申请`, '🚫');
        return;
      }
      // 同意重进前校验昵称未被占用，避免出现同名玩家
      const reqName = req.player.name?.trim();
      if (reqName) {
        const conflict = st.players.find(
          (p) => p.name && normalizeName(p.name) === normalizeName(reqName) && (p.connected || p.isHost),
        );
        if (conflict) {
          serviceRef.current?.broadcast({ t: 'join-reply', playerId, accept: false } satisfies GameMessage);
          publish({ ...st, joinRequests });
          pushNotice(`「${req.player.name}」昵称已被占用，已拒绝`, '⚠️');
          return;
        }
      }
      let players = st.players;
      if (!players.some((p) => p.id === playerId)) {
        const usedColors = new Set(st.players.map((p) => p.color));
        const color = COLORS.find((c) => !usedColors.has(c)) ?? COLORS[st.players.length % COLORS.length];
        players = [
          ...st.players,
          {
            ...req.player,
            color,
            score: 0,
            streak: 0,
            correctCount: 0,
            isHost: false,
            connected: true,
            ready: false,
            joinedAt: Date.now(),
          },
        ];
      }
      publish({
        ...st,
        players,
        joinRequests,
        kickedIds: (st.kickedIds ?? []).filter((id) => id !== playerId),
      });
      pushNotice(`已同意「${req.player.name}」重新加入`, '✅');
    },
    [selfId, publish, pushNotice],
  );

  /** 被踢后返回首页（断开房间连接，放弃申请） */
  const backToHome = useCallback(() => {
    serviceRef.current?.disconnect();
    serviceRef.current = null;
    kickedRef.current = false;
    selfPlayerRef.current = null;
    setKickedBy(null);
    setJoinApplied(false);
    setError(null);
  }, []);

  return {
    room,
    selfId,
    isHost,
    connecting,
    error,
    setError,
    notices,
    myAnswer,
    categories,
    kickedBy,
    joinApplied,
    mode: isSupabaseConfigured ? ('supabase' as const) : ('local' as const),
    now,
    createRoom,
    joinRoom,
    leaveRoom,
    updateSettings,
    renameRoom,
    setReady,
    rerollAvatar,
    startGame,
    submitAnswer,
    nextRound,
    playAgain,
    kickPlayer,
    respondJoinRequest,
    applyJoin,
    backToHome,
  };
}
