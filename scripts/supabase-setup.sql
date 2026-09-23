-- ============================================================
-- 谁是小文盲 · 访问统计系统（Supabase 全局统计）
-- ------------------------------------------------------------
-- 使用方法：
--   1. 在 https://supabase.com 打开你的项目
--   2. 进入 SQL Editor（SQL 编辑器）
--   3. 粘贴本文件全部内容并运行
--
-- 说明：
--   · 仅需这一张表，即可记录页面访问 + 玩法事件（创建/加入房间、开局、答题、结算）
--   · 匿名访问者数据（client_id 每设备随机生成、不包含昵称等隐私信息）
--   · country / city 由 Supabase 边缘网络自动填入（源 IP 推断），拿不到时为空
--   · RLS：允许匿名写入与公开读取（本游戏无登录体系，统计页直接读公开数据）
-- ============================================================

create table if not exists public.visit_events (
  id bigint generated always as identity primary key,
  -- 事件类型：page_view / create_room / join_room / game_start / question_answered / game_end
  event_type text not null,
  -- 匿名设备标识（每台设备随机生成一次），用于统计独立访客
  client_id text not null,
  -- 本次会话标识（每个标签页一次）
  session_id text,
  -- 来源地理位置（Supabase 边缘自动推断，可能为空）
  country text,
  city text,
  -- 事件附加信息（来源渠道、答题对错、题目分类等）
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 查询加速索引
create index if not exists visit_events_created_at_idx on public.visit_events (created_at);
create index if not exists visit_events_client_id_idx on public.visit_events (client_id);
create index if not exists visit_events_event_type_idx on public.visit_events (event_type);

-- 开启行级安全
alter table public.visit_events enable row level security;

-- 允许匿名用户写入（统计上报）
drop policy if exists "visit_events_anon_insert" on public.visit_events;
create policy "visit_events_anon_insert"
  on public.visit_events
  for insert
  to anon
  with check (true);

-- 允许公开读取（统计页面展示；本游戏无鉴权体系，数据为公开统计）
drop policy if exists "visit_events_anon_select" on public.visit_events;
create policy "visit_events_anon_select"
  on public.visit_events
  for select
  to anon
  using (true);