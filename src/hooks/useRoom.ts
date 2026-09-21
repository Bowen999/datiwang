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

function sessionSelfId(): string {
  let id = sessionStorage.getItem('datiwang:uid');
  if (!id) {
    id = generateId();
    sessionStorage.setItem('datiwang:uid', id);
  }
  return id;
}

const COLORS = ['#FFC800', '#FF5D8F', '#4D96FF', '#3ECF8E', '#9B5DE5', '#FF7A1A'];

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

  const serviceRef = useRef<RealtimeService | null>(null);
  const roomRef = useRef<RoomState | null>(null);
  const clockOffsetRef = useRef(0);
  const answersRef = useRef(new Map<string, { optionIndex?: number; order?: number[]; timeMs: number }>());
  const hostQuestionsRef = useRef(new Map<string, QuizQuestion>());
  const joinWaiterRef = useRef<((ok: boolean) => void) | null>(null);
  const noticeIdRef = useRef(0);

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
      // 非抢答机制：不在全员答完时提前揭晓，等计时结束统一结算
    },
    [selfId, publish],
  );

  /** 被踢 / 被移出房间：断开连接并清空房间状态（保留被踢提示） */
  const handleKicked = useCallback(
    (byName?: string) => {
      serviceRef.current?.disconnect();
      serviceRef.current = null;
      answersRef.current = new Map();
      hostQuestionsRef.current = new Map();
      joinWaiterRef.current = null;
      clockOffsetRef.current = 0;
      applyRoom(null);
      setMyAnswer(null);
      setKickedBy(byName ?? '房主');
      pushNotice('你已被移出房间', '🚫');
    },
    [applyRoom, pushNotice],
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
        // 兜底检测：房主把我们移出了成员列表（此时 kick 消息可能先到或已错过）
        if (
          prev &&
          prev.players.some((p) => p.id === selfId) &&
          !msg.state.players.some((p) => p.id === selfId)
        ) {
          const byName = prev.players.find((p) => p.id === msg.state.hostId)?.name;
          handleKicked(byName);
          return;
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
        joinWaiterRef.current?.(msg.state.players.some((p) => p.id === selfId));
        return;
      }

      // 被房主点名踢出
      if (msg.t === 'kick' && msg.playerId === selfId) {
        const byName = st?.players.find((p) => p.id === msg.by)?.name;
        handleKicked(byName);
        return;
      }

      // 以下只有房主处理
      if (!st || st.hostId !== selfId) return;

      if (msg.t === 'join') {
        const exists = st.players.some((p) => p.id === msg.player.id);
        // 被踢过的玩家：拒绝再次加入（无需改状态，仅提示对方）
        if (!exists && st.kickedIds?.includes(msg.player.id)) {
          serviceRef.current?.broadcast({ t: 'kick', playerId: msg.player.id, by: selfId } satisfies GameMessage);
          return;
        }
        if (exists) {
          // 重连：恢复在线状态
          publish({
            ...st,
            players: st.players.map((p) =>
              p.id === msg.player.id ? { ...p, connected: true, name: msg.player.name } : p,
            ),
          });
          return;
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
        // 房主：同步玩家在线状态
        const changed = st.players.some((p) => p.connected !== present.has(p.id));
        if (changed) {
          publish({
            ...st,
            players: st.players.map((p) => ({ ...p, connected: present.has(p.id) })),
          });
        }
        return;
      }

      // 非房主：检测房主是否离线 → 房主迁移
      if (!present.has(st.hostId)) {
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
            pushNotice('房主已离开，你接任房主', '👑');
            publish({
              ...current,
              hostId: selfId,
              players: current.players.map((p) => ({
                ...p,
                connected: present.has(p.id),
                isHost: p.id === selfId,
              })),
            });
          })();
        }
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
      try {
        const service = await connect(code.toUpperCase());
        const joined = await new Promise<boolean>((resolve) => {
          joinWaiterRef.current = resolve;
          service.broadcast({
            t: 'join',
            player: { id: selfId, name, avatar: randomAvatar(), color: COLORS[0] },
          } satisfies GameMessage);
          // 多次重发，防止房主恰好错过
          const retry = setInterval(() => {
            service.broadcast({
              t: 'join',
              player: { id: selfId, name, avatar: randomAvatar(), color: COLORS[0] },
            } satisfies GameMessage);
          }, 1200);
          setTimeout(() => {
            clearInterval(retry);
            resolve(roomRef.current?.players.some((p) => p.id === selfId) ?? false);
          }, 8000);
          const origResolve = joinWaiterRef.current;
          joinWaiterRef.current = (ok) => {
            clearInterval(retry);
            origResolve?.(ok);
            resolve(ok);
          };
        });
        joinWaiterRef.current = null;
        if (!joined) {
          service.disconnect();
          serviceRef.current = null;
          setError('找不到这个房间，检查一下房间码？');
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
      publish({ ...next, usedQuestionIds: [...st.usedQuestionIds, ...next.questionIds] });
    } catch {
      pushNotice('题库加载失败，请重试', '⚠️');
    }
  }, [selfId, publish, pushNotice]);

  const submitAnswer = useCallback(
    (payload: AnswerPayload) => {
      const st = roomRef.current;
      if (!st || st.phase !== 'question' || !st.activeQuestion || !st.questionEndsAt) return;
      const isRanking = st.activeQuestion.kind === 'ranking';
      const timeMs = Math.max(0, questionTimeMs(st.activeQuestion.kind, st.settings.roundSeconds) - (st.questionEndsAt - now()));
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
      });
      pushNotice(`已将「${target.name}」移出房间`, '🚫');
    },
    [selfId, publish, pushNotice],
  );

  /** 被踢后返回首页 */
  const backToHome = useCallback(() => {
    setKickedBy(null);
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
    backToHome,
  };
}
