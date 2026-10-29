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
./.claude/skills/mp-ci/mp-ci.sh preview

# 上传代码（自动压缩）
./.claude/skills/mp-ci/mp-ci.sh upload <version> "<desc>"

# 上传云函数
./.claude/skills/mp-ci/mp-ci.sh cloud <functionName>

# 构建 npm
./.claude/skills/mp-ci/mp-ci.sh npm
```

云函数列表：budgetCrud, calendarCrud, courseCrud, adminCrud, feideeTransactions, syncFeideeBudget, feideeCategoryExpense

## Architecture

```
pages/           → 页面（每个页面含 .js/.wxml/.wxss/.json）
components/      → 自定义组件
utils/           → 工具函数（*-storage.js 封装云函数调用）
cloudfunctions/  → 云函数（action-based 路由模式）
```

### Pages

| 页面 | 功能 |
|------|------|
| index | 首页，工具入口 |
| budget | 预算看板（详见 BUDGET_DEV_DOC.md） |
| feidee-bill | 随手记账单明细 |
| expense-calendar | 消费日历 |
| expense-calendar-detail | 当日账单明细 |
| category-expense | 分类支出统计 |
| course | 课程管理 |
| course-detail | 课程详情编辑 |
| qing-calendar | 清日历 |
| admin | 管理后台（随手记账号配置） |

### Components

- `navigation-bar` - 自定义导航栏（适配 Skyline）
- `amount-keyboard` - 假键盘组件，支持表达式输入
- `checkin-calendar` - 签到日历组件
- `page-loader` - 全局统一加载页面

### 数据流

```
页面 → utils/*-storage.js → wx.cloud.callFunction → cloudfunctions/* → 云数据库
```

Storage 文件对应关系：
- `budget-storage.js` → budgetCrud + syncFeideeBudget + feideeTransactions + feideeCategoryExpense
- `course-storage.js` → courseCrud
- `qing-calendar-storage.js` → calendarCrud

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

### Database Collections

| 集合 | 用途 |
|------|------|
| budget_items | 预算项数据（按 monthKey 分桶） |
| budget_config | 飞笛 API 配置（authorization、accountIds） |
| calendar_events | 清日历事件 |
| course_records | 课程数据 |
| checkin_logs | 上课打卡明细 |
| course_share / course_viewed_share | 课程只读分享和最近查看 |
| calendar_share / calendar_viewed_share | 日历分享和最近查看 |

## Feidee Integration

飞笛（Feidee）是外部记账服务，通过云函数调用其 API：

- `feideeTransactions` - 获取交易明细（按日期范围）
- `feideeCategoryExpense` - 获取分类支出汇总
- `syncFeideeBudget` - 同步飞笛数据到预算项

配置存储在 `budget_config` 集合，包含 `authorization`、`tradingEntity`、`accountIds`。

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
## Repository checks

```bash
node scripts/check-repo.js
node --test tests/regression.test.js
git diff --check
```

图片导入、模板日志页、白名单、通知订阅、定时/批量同步已移除。仅保留预算看板手动同步；删除本地云函数文件不等于删除线上资源。
