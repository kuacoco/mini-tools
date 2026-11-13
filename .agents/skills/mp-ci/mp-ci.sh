#!/usr/bin/env bash
set -euo pipefail
repo=kuacoco/mini-tools
workflow=mp-ci.yml
usage() {
  echo '用法: mp-ci.sh preview [version] [robot] [ref]'
  echo '      mp-ci.sh upload <version> <desc> [robot] [ref]'
  echo '      mp-ci.sh cloud <functionName> [ref]'
}
action=${1:-}
case "$action" in
  preview)
    version=${2:-1.0.0}; robot=${3:-1}; ref=${4:-main}
    inputs=(-f action=preview -f "version=$version" -f "robot=$robot") ;;
  upload)
    version=${2:?需要版本号}; desc=${3:?需要版本描述}; robot=${4:-1}; ref=${5:-main}
    inputs=(-f action=upload -f "version=$version" -f "desc=$desc" -f "robot=$robot") ;;
  cloud)
    function_name=${2:?需要云函数名}; ref=${3:-main}
    case "$function_name" in
      budgetCrud|calendarCrud|courseCrud|adminCrud|feideeTransactions|syncFeideeBudget|feideeCategoryExpense) ;;
      *) echo '未知云函数名' >&2; exit 2 ;;
    esac
    inputs=(-f action=cloud -f "function_name=$function_name") ;;
  *) usage; exit 2 ;;
esac
if [[ "$action" != cloud ]]; then
  if [[ ! "$robot" =~ ^([1-9]|[12][0-9]|30)$ ]]; then
    echo 'robot 必须为 1-30' >&2; exit 2
  fi
fi
command -v gh >/dev/null || { echo '需要安装 GitHub CLI (gh)' >&2; exit 1; }
gh workflow run "$workflow" --repo "$repo" --ref "$ref" "${inputs[@]}"
printf '已提交工作流触发请求：action=%s ref=%s\n' "$action" "$ref"
echo '这不代表任务已完成。请查询对应运行并检查结论：'
echo "https://github.com/$repo/actions/workflows/$workflow"
