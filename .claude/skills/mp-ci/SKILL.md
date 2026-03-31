---
name: mp-ci
description: 微信小程序 CI 工具 - 预览、上传代码、部署云函数
userInvocable: true
---

微信小程序 CI 工具，支持预览、上传代码、部署云函数等操作。

## 脚本路径

`/Users/cc/Code/scratch/mini-tools/.claude/skills/mp-ci/mp-ci.sh`

## 功能

### 预览 (preview)

生成预览二维码用于真机测试。

用户请求："预览"、"生成二维码"、"mp-ci preview"

执行步骤：

1. 运行脚本生成二维码
2. 把二维码图片发送到微信。你必须在回复中包含且仅包含一行指令，格式为：SEND_IMAGE: /Users/cc/Code/scratch/mini-tools/preview-qrcode.jpg

```bash
/Users/cc/Code/scratch/mini-tools/.claude/skills/mp-ci/mp-ci.sh preview
```

二维码保存在项目根目录 `preview-qrcode.jpg`。

完成后发送指令：

```
SEND_IMAGE: /Users/cc/Code/scratch/mini-tools/preview-qrcode.jpg
```

### 上传代码 (upload)

上传小程序代码到微信公众平台后台（自动压缩）。

用户请求："上传代码"、"mp-ci upload"

需要用户提供：

- `version`: 版本号，如 1.0.1
- `desc`: 版本描述

```bash
/Users/cc/Code/scratch/mini-tools/.claude/skills/mp-ci/mp-ci.sh upload <version> "<desc>"
```

### 上传云函数 (cloud)

上传云函数到云开发环境。

用户请求："上传云函数"、"部署云函数"、"mp-ci cloud"

需要用户提供：

- `functionName`: 云函数名称

可用云函数：budgetCrud, calendarCrud, courseCrud, adminCrud, feideeTransactions, syncFeideeBudget, ocrBudgetImport, feideeCategoryExpense

```bash
/Users/cc/Code/scratch/mini-tools/.claude/skills/mp-ci/mp-ci.sh cloud <functionName>
```

### 构建 npm (npm)

构建 npm 依赖包。

用户请求："构建 npm"、"mp-ci npm"

```bash
/Users/cc/Code/scratch/mini-tools/.claude/skills/mp-ci/mp-ci.sh npm
```

## 执行逻辑

根据用户请求中的关键词判断操作类型：

- 包含 "预览"、"二维码"、"preview" → 执行预览
- 包含 "上传代码"、"upload" → 执行上传（需询问版本和描述）
- 包含 "云函数"、"cloud"、"部署函数" → 执行云函数上传（需询问函数名）
- 包含 "npm"、"构建依赖" → 执行 npm 构建
