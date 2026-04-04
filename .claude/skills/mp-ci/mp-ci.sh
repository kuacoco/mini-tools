#!/bin/bash
# 微信小程序 CI 工具脚本
# 用法: ./mp-ci.sh <command> [args]

PROJECT_PATH="/home/qingfeng/Workspace/clawBot/mini-tools"
APPID="wxe4a08baedb2fcf9d"
KEY_PATH="$PROJECT_PATH/key/private.$APPID.key"
ENV_ID="cloud2-1gytehldd551cd77"

COMMAND=$1

case "$COMMAND" in
  preview)
    VERSION=${2:-"1.0.0"}
    ROBOT=${3:-1}
    OUTPUT="$PROJECT_PATH/preview-qrcode.jpg"

    echo "生成预览二维码..."
    miniprogram-ci preview \
      --pp "$PROJECT_PATH" \
      --pkp "$KEY_PATH" \
      --appid "$APPID" \
      --uv "$VERSION" \
      -r "$ROBOT" \
      --qrcode-format image \
      --qrcode-output-dest "$OUTPUT" \
      --enable-es6 true

    echo "二维码已保存至: $OUTPUT"
    ;;

  upload)
    VERSION=$2
    DESC=$3
    ROBOT=${4:-1}

    if [ -z "$VERSION" ] || [ -z "$DESC" ]; then
      echo "错误: upload 需要指定版本号和描述"
      echo "用法: ./mp-ci.sh upload <version> <desc> [robot]"
      exit 1
    fi

    echo "上传代码..."
    miniprogram-ci upload \
      --pp "$PROJECT_PATH" \
      --pkp "$KEY_PATH" \
      --appid "$APPID" \
      --uv "$VERSION" \
      -r "$ROBOT" \
      --desc "$DESC" \
      --enable-es6 true \
      --minify true

    echo "上传完成: 版本 $VERSION"
    ;;

  cloud)
    FUNCTION_NAME=$2

    if [ -z "$FUNCTION_NAME" ]; then
      echo "错误: cloud 需要指定云函数名称"
      echo "用法: ./mp-ci.sh cloud <functionName>"
      echo "可用云函数: budgetCrud, calendarCrud, courseCrud, adminCrud, feideeTransactions, syncFeideeBudget, ocrBudgetImport, feideeCategoryExpense"
      exit 1
    fi

    echo "上传云函数: $FUNCTION_NAME..."
    miniprogram-ci cloud  \
      --pp "$PROJECT_PATH" \
      --pkp "$KEY_PATH" \
      --appid "$APPID" \
      --env "$ENV_ID" \
      --name "$FUNCTION_NAME" \
      --path "$PROJECT_PATH/cloudfunctions/" \
      --remote-npm-install true

    echo "云函数上传完成: $FUNCTION_NAME"
    ;;

  npm)
    echo "构建 npm..."
    miniprogram-ci pack-npm \
      --pp "$PROJECT_PATH" \
      --pkp "$KEY_PATH" \
      --appid "$APPID" \

    echo "npm 构建完成"
    ;;

  *)
    echo "微信小程序 CI 工具"
    echo ""
    echo "用法: ./mp-ci.sh <command> [args]"
    echo ""
    echo "命令:"
    echo "  preview [version] [robot]      - 生成预览二维码"
    echo "  upload <version> <desc> [robot] - 上传代码"
    echo "  cloud <functionName>           - 上传云函数"
    echo "  npm                            - 构建 npm"
    echo ""
    echo "示例:"
    echo "  ./mp-ci.sh preview"
    echo "  ./mp-ci.sh upload 1.0.1 \"修复登录问题\""
    echo "  ./mp-ci.sh cloud budgetCrud"
    echo "  ./mp-ci.sh npm"
    exit 1
    ;;
esac