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
│   ├── budget/             # 预算看板 - 核心功能页面
│   ├── location/            # 定位拾取工具
│   └── logs/                # 日志页面
├── components/              # 自定义组件
│   ├── amount-keyboard/    # 金额输入键盘组件
│   ├── navigation-bar/     # 自定义导航栏
│   └── swipe-item/         # 滑动操作组件
├── utils/                   # 工具函数
│   ├── budget-storage.js   # 预算数据存储 (云函数调用封装)
│   ├── amount-expression.js # 金额表达式解析
│   └── util.js             # 通用工具
├── cloudfunctions/          # 云函数
│   ├── budgetCrud/         # 预算 CRUD 云函数
│   └── ocrBudgetImport/    # OCR 图片识别导入
└── app.js                   # 应用入口 (云开发初始化)
```

## 技术栈

- **渲染模式**: WeChat Skyline (现代渲染器)
- **样式**: WXSS with v2 style
- **组件框架**: glass-easel
- **数据存储**: 本地 Storage + 云数据库

## 核心功能

### 预算看板 (Budget Dashboard)

详细开发文档见 `BUDGET_DEV_DOC.md`，核心特性：

- **月度视图**: 按自然月管理预算，支持月份切换
- **本地存储**: 使用 `budget_items_v1` 作为 Storage Key
- **交互**: 底部弹层、假键盘输入、滑动编辑/删除、振动反馈
- **云函数**: `budgetCrud` 处理所有数据操作

### 关键实现

- **假键盘组件** (`components/amount-keyboard/`): 计算器样式数字键盘
- **自定义导航栏**: 通过 `app.json` 的 `navigationStyle: custom` 启用
- **数据流**: 页面 → budget-storage.js (云函数封装) → 云函数 → 云数据库

## Common Development Tasks

- **添加新页面**: 在 `pages/` 创建文件夹，编辑 `app.json` 的 `pages` 数组
- **创建组件**: 在 `components/` 创建文件夹，组件需在页面 JSON 中声明
- **修改云函数**: 修改后右键 cloudfunction 文件夹选择"上传并部署"
- **调试云函数**: 在 WeChat Developer Tools 的"云开发"控制台查看调用日志