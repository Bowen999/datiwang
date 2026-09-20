import { LocalRealtimeService } from './LocalRealtimeService';
import { SupabaseRealtimeService } from './SupabaseRealtimeService';
import type { RealtimeService } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 是否配置了 Supabase（未配置则使用本地演示模式） */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** 创建实时服务：优先 Supabase，未配置时回退到本地 BroadcastChannel */
export function createRealtimeService(): RealtimeService {
  if (isSupabaseConfigured) {
    return new SupabaseRealtimeService(SUPABASE_URL!, SUPABASE_ANON_KEY!);
  }
  return new LocalRealtimeService();
}
