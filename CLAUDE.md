# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

微信小程序，提供预算看板、课程管理、日历等工具，使用云开发能力。

## Development Environment

- **Platform**: WeChat Mini Program
- **IDE**: WeChat Developer Tools
- **AppID**: wxe4a08baedb2fcf9d
- **Cloud Environment**: cloud2-1gytehldd551cd77

## CI Commands

使用 `/mp-ci` skill 执行 CI 操作：

```bash
# 预览 - 生成二维码
./mp-ci.sh preview

# 上传代码（自动压缩）
./mp-ci.sh upload <version> "<desc>"

# 上传云函数
./mp-ci.sh cloud <functionName>

# 构建 npm
./mp-ci.sh npm
```

云函数列表：budgetCrud, calendarCrud, courseCrud, adminCrud, feideeTransactions, syncFeideeBudget, ocrBudgetImport, feideeCategoryExpense

## Architecture

```
pages/           → 页面（每个页面含 .js/.wxml/.wxss/.json）
components/      → 自定义组件
utils/           → 工具函数（*-storage.js 封装云函数调用）
cloudfunctions/  → 云函数（action-based 路由模式）
```

### 数据流

```
页面 → utils/*-storage.js → wx.cloud.callFunction → cloudfunctions/* → 云数据库
```

每个 `*-storage.js` 封装对应云函数调用，如 `budget-storage.js` → `budgetCrud`。

### 云函数模式

云函数采用 `action` 路由：

```javascript
// 调用方式
wx.cloud.callFunction({
  name: 'budgetCrud',
  data: { action: 'listByMonth', payload: { monthKey: '2026-03' } }
})

// 云函数结构
exports.main = async (event) => {
  const { action, payload } = event
  switch (action) {
    case 'listByMonth': return listByMonth(payload, openid)
    // ...
  }
}
```

## Key Patterns

### 预算模块

详见 `BUDGET_DEV_DOC.md`。核心：
- 月度分桶存储（monthKey: `YYYY-MM`）
- 假键盘组件 (`amount-keyboard`) 支持表达式输入
- 滑动操作 + 弹层交互

### Skyline 渲染器

使用 `defaultDisplayBlock` 和 `defaultContentBox`，注意样式兼容性。

### 自定义导航栏

`app.json` 设置 `navigationStyle: custom`，使用 `navigation-bar` 组件。