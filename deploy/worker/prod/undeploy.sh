#!/bin/bash
# Worker 卸载脚本

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

if [ ! -f "values.yaml" ]; then
  echo -e "${RED}✗ 缺少 values.yaml${NC}"
  exit 1
fi

get_value() {
  local key="$1"
  grep -E "^${key}:" values.yaml | head -1 | sed 's/^[^:]*:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//'
}

NAMESPACE=$(get_value "NAMESPACE")
APP_NAME=$(get_value "APP_NAME")
USER_APP_NAME=$(get_value "USER_APP_NAME")
SYSTEM_APP_NAME=$(get_value "SYSTEM_APP_NAME")
USER_APP_NAME=${USER_APP_NAME:-${APP_NAME}-user}
SYSTEM_APP_NAME=${SYSTEM_APP_NAME:-${APP_NAME}-system}

kubectl delete deployment "$USER_APP_NAME" -n "$NAMESPACE" --ignore-not-found
kubectl delete deployment "$SYSTEM_APP_NAME" -n "$NAMESPACE" --ignore-not-found
kubectl delete configmap "${APP_NAME}-config" -n "$NAMESPACE" --ignore-not-found
kubectl delete serviceaccount "$APP_NAME" -n "$NAMESPACE" --ignore-not-found

# 清理旧版部署残留。
kubectl delete -f rbac.yaml --ignore-not-found 2>/dev/null || true
kubectl delete secret "${APP_NAME}-secrets" -n "$NAMESPACE" --ignore-not-found 2>/dev/null || true

echo -e "${GREEN}✅ Worker 卸载完成${NC}"
