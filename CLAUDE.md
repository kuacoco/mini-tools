# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **WeChat Mini Program** (微信小程序) with cloud development capabilities. The app provides utility tools including a budget tracking dashboard and location picker.

## Development Environment

- **Platform**: WeChat Mini Program
- **IDE**: WeChat Developer Tools (微信开发者工具)
- **AppID**: wxe4a08baedb2fcf9d
- **Cloud Environment**: cloud1-3gfzmsmq655e791e

## Key Commands

- **开发/预览**: Open the project in WeChat Developer Tools and use the "预览" button to test on a simulator or real device
- **上传代码**: Use WeChat Developer Tools "上传" button to upload for review/release
- **云函数部署**: Right-click on `cloudfunctions/` folder in WeChat Developer Tools to upload and configure cloud functions

## Architecture

```
/
├── pages/                    # 页面目录
│   ├── index/               # 首页 - 工具列表入口
│   ├── budget/              # 预算看板
│   ├── feidee-bill/         # 随手记账单页面
│   ├── course/              # 课程页面
│   ├── course-detail/       # 课程详情
│   ├── qing-calendar/       # Qing 日历页面
│   ├── statics/             # 统计页面
│   ├── admin/               # 管理页面
│   ├── location/            # 定位拾取工具
│   └── logs/                # 日志页面
├── components/              # 自定义组件
│   ├── amount-keyboard/    # 金额输入键盘组件
│   ├── navigation-bar/     # 自定义导航栏
│   └── checkin-calendar/   # 签到日历组件
├── utils/                   # 工具函数
│   ├── budget-storage.js   # 预算数据存储 (云函数调用封装)
│   ├── amount-expression.js # 金额表达式解析
│   ├── course-storage.js   # 课程数据存储
│   ├── course-calendar.js  # 课程日历逻辑
│   ├── qing-calendar-storage.js # Qing 日历数据存储
│   ├── tool.js             # 通用工具
│   └── util.js             # 辅助工具
├── cloudfunctions/          # 云函数
│   ├── budgetCrud/         # 预算 CRUD
│   ├── calendarCrud/       # 日历 CRUD
│   ├── courseCrud/         # 课程 CRUD
│   ├── adminCrud/          # 管理 CRUD
│   ├── feideeTransactions/ # 随手记交易
│   ├── syncFeideeBudget/   # 同步随手记预算
│   └── ocrBudgetImport/    # OCR 图片识别导入
└── app.js                   # 应用入口 (云开发初始化)
```

## 技术栈

- **渲染模式**: WeChat Skyline (现代渲染器)
- **样式**: WXSS with v2 style
- **组件框架**: glass-easel
- **数据存储**: 本地 Storage + 云数据库

## 核心功能模块

### 预算看板 (Budget Dashboard)

详细开发文档见 `BUDGET_DEV_DOC.md`，核心特性：

- **月度视图**: 按自然月管理预算，支持月份切换
- **交互**: 底部弹层、假键盘输入、滑动编辑/删除、振动反馈
- **云函数**: `budgetCrud` 处理所有数据操作

### 课程模块 (Course)

- 课程列表与详情展示
- 签到日历组件 (`checkin-calendar`)
- 云函数: `courseCrud`

### Qing 日历

- 日历事件管理
- 云函数: `calendarCrud`

### 随手记集成 (Feidee)

- 账单页面 (`feidee-bill`)
- 同步预算 (`syncFeideeBudget` 云函数)
- 交易数据获取 (`feideeTransactions` 云函数)

## 关键实现

- **假键盘组件** (`components/amount-keyboard/`): 计算器样式数字键盘，支持表达式输入
- **自定义导航栏**: 通过 `app.json` 的 `navigationStyle: custom` 启用
- **数据流**: 页面 → utils/*-storage.js (云函数封装) → 云函数 → 云数据库
- **Skyline 渲染器**: 使用 `defaultDisplayBlock` 和 `defaultContentBox` 模式，注意样式兼容性