---
name: mp-ci
description: 通过 GitHub Actions 预览微信小程序、上传代码和部署云函数，并获取运行结果及二维码。
---

# 小程序 CI

从仓库根目录执行 `.agents/skills/mp-ci/mp-ci.sh`。云环境不直接连接微信；微信 CI 在 GitHub Actions 的 `.github/workflows/mp-ci.yml` 执行，底层执行脚本仍是 `.claude/skills/mp-ci/mp-ci.sh`，不要将两个脚本混淆。

## 前提与授权

需要 `gh` 及可读 Actions、触发工作流和下载产物的 GitHub 认证。先以 `gh workflow view mp-ci.yml --repo kuacoco/mini-tools` 验证访问；Git 读取权限不等于 Actions 写入权限。认证失败时使用平台安全凭据设置，不索取或输出令牌。
GitHub 仓库需配置 Secret `MP_PRIVATE_KEY`。本地私钥不需要上传到云环境，也不得提交到仓库。微信后台的 IP 白名单需要匹配 GitHub runner 的出口。
仅在用户请求对应操作时触发。修改技能、安装或检查不授权预览、上传或部署。缺少上传版本、描述或云函数名时询问用户。

## 操作

```bash
./.agents/skills/mp-ci/mp-ci.sh preview [version] [robot] [ref]
./.agents/skills/mp-ci/mp-ci.sh upload <version> "<desc>" [robot] [ref]
./.agents/skills/mp-ci/mp-ci.sh cloud <functionName> [ref]
```

默认 ref 为 `main`，preview 版本默认 `1.0.0`，robot 默认 `1`。执行的是 GitHub 上该 ref 的代码，未提交或未推送的本地改动不会包含。触发前明确告知目标 ref；用户要求包含本地改动时，先检查是否已提交推送，不能静默推送代码。
支持 budgetCrud、calendarCrud、courseCrud、adminCrud、feideeTransactions、syncFeideeBudget、feideeCategoryExpense。
`npm` 不在当前工作流支持范围内，不要将其映射为其他操作。

## 等待与结果

触发前记录当前时间与该 ref 的远端 SHA，触发后查询：

```bash
gh run list --repo kuacoco/mini-tools --workflow mp-ci.yml --event workflow_dispatch --limit 10 --json databaseId,url,headSha,headBranch,createdAt,status,conclusion,displayTitle
```

按触发时间、ref、headSha 确认对应运行。并发请求导致无法唯一确认时查看运行任务日志与工作流输入，或让用户指定运行链接；不得直接取“最新运行”并当成本次运行。任务暂未出现时稍后查询，不要重复触发。

```bash
gh run view RUN_ID --repo kuacoco/mini-tools --json status,conclusion,url,jobs
gh run view RUN_ID --repo kuacoco/mini-tools --log-failed
```

间隔查询并向用户汇报，避免长时间阻塞式等待。只有 `conclusion=success` 才报告成功。失败时读取对应日志，不泄露凭据，不自动重试上传或部署。返回运行链接和结论。

预览成功后，下载**本次运行**的产物到独立目录：

```bash
python3 scripts/preview-qrcode.py download RUN_ID /tmp/mini-tools-preview-RUN_ID
```

下载脚本优先使用 Actions 产物；存储域名返回 403 时，自动读取本次运行的二维码日志备用数据，并校验大小和 SHA-256。旧工作流没有备用数据时会明确失败，不得使用其他运行的二维码。日志与产物均含预览二维码，沿用仓库 Actions 的访问范围；不要将私钥或其他凭据写入日志。需要 Python 3。

检查 `preview-qrcode.jpg` 存在且有效，返回图片或文件链接及运行链接。不得使用旧二维码或仅凭触发成功声称预览成功；下载失败时返回运行链接与产物获取限制。仅在用户明确要求时向微信发送图片。
