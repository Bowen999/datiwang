# 谁是小文盲 · 派对问答（Datiwang）

中文多人派对问答游戏，和好友实时 PK！基于 React + Vite + TypeScript + Tailwind CSS 构建，支持 Supabase Realtime 实时联机，未配置时自动降级为本地演示模式。

## ✨ 功能特性

- 🎮 创建 / 加入房间，最多 8 人同场竞技
- ⚡ 实时同步作答与计分（Supabase Realtime / 本地演示模式）
- 🏆 实时排名、倒计时、动态计分与连击加成
- 📚 19 个分类 1143 道精选题目（历史、科学、三国、商业财经、古诗、四大名著、美食、影视、体育、音乐、科技、国家常识、排名题等）
- 📊 访问统计系统：全局聚合访问量 / 独立访客 / 时段与星期分布 / 来源渠道 / 地区 / 玩法数据等多维度统计（隐藏路由 `http://<主机>/stats`，需密码访问）
- 🎨 新拟态（Neumorphism）UI 风格 + DiceBear 开源头像库（15 种风格随机）+ 彩带动效

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 生产构建
npm run build

# 本地预览
npm run preview
```

## 🔌 Supabase 配置（可选）

联机对战仅需 **Realtime** 功能；访问统计还需要建一张表（见下文）。两步完成：

### 1. 创建项目并填入环境变量

1. 在 [supabase.com](https://supabase.com) 创建项目
2. 从 **Project Settings → API** 获取 URL 与 anon key
3. 复制 `.env.example` 为 `.env` 并填入：

```
VITE_SUPABASE_URL=你的项目URL
VITE_SUPABASE_ANON_KEY=你的anon key
```

> 不配置时自动使用「本地演示模式」——同一浏览器的多个标签页之间即可联机对战。

### 2. 创建访问统计表（可选，用于全局访问统计）

打开 Supabase **SQL Editor**，把 `scripts/supabase-setup.sql` 的内容粘贴运行，即可创建
`visit_events` 表（含 RLS 策略，允许匿名写入 + 公开读取）：

```bash
# 或使用 supabase CLI
supabase db reset   # 本地开发时
```

配置完成后，通过**隐藏路由**访问统计页（入口不挂在任何页面上）：

```
http://你的主机/stats      # 密码：stats
```

同标签页会话内只需输入一次密码。统计维度：

- **总览**：总访问量、独立访客（每设备匿名 ID）、今日 / 昨日 / 近 7 天
- **趋势**：近 14 天每日访问柱状图
- **时段**：24 小时活跃分布、最活跃时段
- **星期**：周一~周日分布、最热闹的一天
- **来源**：直接访问首页 vs 房间分享链接
- **地区**：国家 / 城市分布（Supabase 边缘网络由 IP 推断，可能为空）
- **玩法**：创建/加入房间、开局、答题总数、正确率、平均每局人数、热门分类

> 所有事件匿名上报：仅含每设备随机生成的 ID，不包含昵称、回答内容等隐私信息。
> 密码锁为纯前端实现（密码编译进包内），能防路人误入，无法防住翻源码的技术流。

## 📁 项目结构

```
src/
├── components/    # UI 组件（答题按钮、倒计时、排名、彩带等）
├── screens/       # 页面（大厅、答题、结算）
├── game/          # 游戏逻辑与计分规则
├── hooks/         # 自定义 Hooks（useRoom）
├── services/
│   ├── realtime/  # 实时通信服务（Supabase / 本地双实现）
│   ├── stats/     # 访问统计服务（Supabase 全局 / 本地双实现）
│   └── QuestionService.ts  # 题库加载
└── types/         # TypeScript 类型定义
scripts/           # 工具脚本（题库导入、数据库建表 SQL）
public/questions/  # 题库 JSON
```

## 🛠️ 技术栈

- **React 18** + **TypeScript**
- **Vite 5**
- **Tailwind CSS 3**
- **Supabase Realtime**
- **Motion**（动画）
- **DiceBear**（头像生成）

## 📄 许可证

保留所有权利。