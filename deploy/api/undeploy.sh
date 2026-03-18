#!/bin/bash
# Workspace API 卸载脚本

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
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

kubectl delete httproute "${APP_NAME}-route" -n "$NAMESPACE" --ignore-not-found
kubectl delete deployment "$APP_NAME" -n "$NAMESPACE" --ignore-not-found
kubectl delete service "$APP_NAME" -n "$NAMESPACE" --ignore-not-found
kubectl delete configmap "${APP_NAME}-config" -n "$NAMESPACE" --ignore-not-found
kubectl delete secret netaverses-api-secrets -n "$NAMESPACE" --ignore-not-found
kubectl delete -f manifests/rbac.yaml --ignore-not-found

echo -e "${GREEN}✅ Workspace API 卸载完成${NC}"
