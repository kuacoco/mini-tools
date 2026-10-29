# mini-tools

微信云开发小程序，包含随手记预算/账单、消课记录、青青日历和定位拾取。

## 目录

- `pages/`：11 个页面，注册入口见 `app.json`。
- `components/`：导航栏、统一加载页、金额键盘、签到日历。
- `utils/`：金额/日期计算、颜色与云函数调用封装。
- `cloudfunctions/`：7 个可独立部署的云函数。
- `scripts/`、`tests/`：仓库引用检查和离线回归测试。

## 本地检查

需要支持 `node:test` 的 Node.js，无需安装第三方测试依赖：

```bash
node scripts/check-repo.js
node --test tests/regression.test.js
git diff --check
```

检查覆盖 JS/JSON、已注册路由、WXML 事件、组件、静态资源和直接云函数引用。它不能代替微信开发者工具中的 Skyline 渲染、真机交互及云端联调。

## 云函数

| 云函数 | 用途 |
|---|---|
| `budgetCrud` | 月度预算增删改查、分类重命名、跨月复制及获取当前 OpenID |
| `adminCrud` | 随手记账号配置管理 |
| `syncFeideeBudget` | 预算看板手动同步，固定账号授权，无定时/批量同步 |
| `feideeTransactions` | 消费账单、消费日历和每日明细的数据查询 |
| `feideeCategoryExpense` | 分类支出统计 |
| `courseCrud` | 课程、打卡、只读分享和最近查看记录 |
| `calendarCrud` | 青青日历、日程分享和最近查看记录 |

## 清理边界

已移除模板日志页、无入口的图片 OCR 导入链路、旧预算提示配置读取及未使用接口/样式。历史数据库记录和云端已部署资源不会因本地删代码而自动删除。

本次清理后需重新部署 `budgetCrud`、`adminCrud`、`syncFeideeBudget`。`ocrBudgetImport` 已不在本地调用链中，线上旧函数可在确认旧版小程序不再使用后单独下线。账号配置中的系统历史记录仍通过 `userId` 过滤，不作为用户配置展示。

保留品牌图片、开发者工具配置、课程/日历分享接口和仍使用的数据集合，不凭一次字符串搜索推断其无用。

## 文档

- [预算看板开发文档](BUDGET_DEV_DOC.md)
- [设计约定](DESIGN.md)
- [交互与权限约定](UX-CONTRACT.md)
