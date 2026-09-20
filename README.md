# 答题王 · 派对问答（Datiwang）

中文多人派对问答游戏，和好友实时 PK！基于 React + Vite + TypeScript + Tailwind CSS 构建，支持 Supabase Realtime 实时联机，未配置时自动降级为本地演示模式。

## ✨ 功能特性

- 🎮 创建 / 加入房间，最多 8 人同场竞技
- ⚡ 实时同步作答与计分（Supabase Realtime / 本地演示模式）
- 🏆 实时排名、倒计时、动态计分与连击加成
- 📚 13 个分类 1300+ 道题目（历史、科学、三国、古诗、四大名著、美食、影视等）
- 🎨 新拟态（Neumorphism）UI 风格 + DiceBear 头像 + 彩带动效

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

## 🔌 Supabase Realtime 配置（可选）

无需任何数据库表，仅需 Realtime 功能：

1. 在 [supabase.com](https://supabase.com) 创建项目
2. 从 **Project Settings → API** 获取 URL 与 anon key
3. 复制 `.env.example` 为 `.env` 并填入：

```
VITE_SUPABASE_URL=你的项目URL
VITE_SUPABASE_ANON_KEY=你的anon key
```

> 不配置时自动使用「本地演示模式」——同一浏览器的多个标签页之间即可联机对战。

## 📁 项目结构

```
src/
├── components/    # UI 组件（答题按钮、倒计时、排名、彩带等）
├── screens/       # 页面（大厅、答题、结算）
├── game/          # 游戏逻辑与计分规则
├── hooks/         # 自定义 Hooks（useRoom）
├── services/
│   ├── realtime/  # 实时通信服务（Supabase / 本地双实现）
│   └── QuestionService.ts  # 题库加载
└── types/         # TypeScript 类型定义
scripts/           # 工具脚本（如题库导入）
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