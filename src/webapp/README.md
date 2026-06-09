# HeroUI Pro React — Vite Template

基于 **HeroUI Pro v3** + **React 19** + **TypeScript** + **Tailwind CSS v4** 的生产级前端脚手架，内置 60+ 企业级组件与示例页面。

## 快速启动

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 生产构建
npm run build

# 预览构建产物
npm run preview

# TypeScript 类型检查
npm run typecheck
```

浏览器访问 `http://localhost:5173`。

## 项目结构

```
heroui3pro-vite-template/
├── index.html                  # Vite 入口 HTML
├── package.json
├── vite.config.ts              # Vite + Tailwind + React 插件
├── tsconfig.json               # TypeScript 配置（含路径别名）
├── README.md
└── src/
    ├── main.tsx                # 应用入口
    ├── app/
    │   └── App.tsx             # 根组件：侧边栏 + 页面路由 + 过渡动画
    ├── config/
    │   └── site.ts             # 站点配置：页面列表、标题、图标
    ├── pages/                  # 页面目录
    │   ├── Home/
    │   │   └── index.tsx       # 首页：KPI 卡片 + 折线图 Widget
    │   └── About/
    │       └── index.tsx       # 关于页：项目介绍 + 技术栈
    ├── shared/                 # 共享模块
    │   ├── layout/
    │   │   └── Sidebar.tsx     # 侧边栏组件（折叠/展开/移动端）
    │   └── lib/
    │       └── animations.ts   # 复用动画预设
    ├── components/             # HeroUI Pro 组件库（60+ 组件）
    ├── styles/                 # 样式文件
    │   ├── app.css             # 全局样式（Tailwind + 组件样式入口）
    │   ├── index.css           # 组件样式 + 主题聚合
    │   ├── components/         # 各组件独立 CSS
    │   └── themes/             # 可选主题（Brutalism / Glass / Mouve）
    └── utils/                  # 工具函数
```

## 路径别名

| 别名 | 路径 | 用途 |
|---|---|---|
| `@components/*` | `src/components/*` | HeroUI Pro 组件 |
| `@css/*` | `src/styles/*` | 样式文件 |
| `@utils/*` | `src/utils/*` | 工具函数 |

## 添加新页面

### 1. 创建页面文件

在 `src/pages/` 下新建目录和文件，导出页面组件：

```tsx
// src/pages/Contact/index.tsx
import { motion } from 'motion/react';
import { Widget } from '@components/widget';
import { staggerContainer } from '../../shared/lib/animations';

export function ContactPage() {
  return (
    <motion.div
      animate="show"
      initial="hidden"
      variants={staggerContainer}
      className="space-y-6"
    >
      <Widget>
        <Widget.Header>
          <Widget.Title>Contact</Widget.Title>
        </Widget.Header>
        <Widget.Content>
          <p className="text-sm text-neutral-600">
            Get in touch with us.
          </p>
        </Widget.Content>
      </Widget>
    </motion.div>
  );
}
```

### 2. 注册页面

编辑 `src/config/site.ts`，在 `pages` 数组中添加条目：

```ts
import { Envelope } from '@gravity-ui/icons';

// 在 pages 数组中追加：
{
  icon: Envelope,
  id: 'Contact',
  label: 'Contact',
  subtitle: 'Get in touch',
},
```

### 3. 注册路由

编辑 `src/app/App.tsx`，导入页面并在 `AnimatePresence` 内添加分支：

```tsx
import { ContactPage } from '../pages/Contact';

// 在 AnimatePresence > motion.div 内部添加：
{page === 'Contact' && <ContactPage />}
```

保存后页面会自动出现在侧边栏导航中，并带有页面切换动画。

## 组件库

项目内置 HeroUI Pro v3 全部 60+ 组件，按分类：

| 分类 | 组件 |
|---|---|
| **Data Display** | AreaChart、BarChart、DataGrid、KPI、LineChart、PieChart、TrendChip 等 |
| **AI & Messaging** | ChatMessage、PromptInput、Markdown、CodeBlock、ChainOfThought 等 |
| **Inputs** | CellSelect、DropZone、Rating、NumberStepper、Segment 等 |
| **Layout** | AppLayout、Sidebar、Navbar、Sheet、ActionBar、Resizable |
| **Surfaces** | Widget、Command、Kanban、FileTree、Carousel、EmptyState 等 |

完整列表参见 `src/components/` 目录。

## 技术栈

| 类别 | 技术 |
|---|---|
| 框架 | React 19 |
| 语言 | TypeScript |
| 构建 | Vite 6 |
| 样式 | Tailwind CSS v4 + tailwind-variants |
| 无障碍 | React Aria Components |
| 动画 | Motion |
| 图表 | Recharts |
| 轮播 | Embla Carousel |
| 图标 | @gravity-ui/icons |

## 许可

HeroUI Pro 为商业授权组件库。本模板仅包含脚手架代码。
