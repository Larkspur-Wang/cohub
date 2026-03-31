#!/bin/bash
# Prod 环境卸载脚本

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

get_value() {
  local key="$1"
  grep -E "^${key}:" values.yaml | head -1 | sed 's/^[^:]*:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//'
}

NAMESPACE=$(get_value "NAMESPACE")
APP_NAME=$(get_value "APP_NAME")

ROUTE_ENABLED=$(get_value "ROUTE_ENABLED")

echo -e "${BLUE}卸载 Cohub Gateway Prod 环境...${NC}"

kubectl delete statefulset "$APP_NAME" -n "$NAMESPACE" --ignore-not-found
kubectl delete service "$APP_NAME" -n "$NAMESPACE" --ignore-not-found
kubectl delete configmap "$APP_NAME-config" -n "$NAMESPACE" --ignore-not-found
kubectl delete secret "$APP_NAME-secrets" -n "$NAMESPACE" --ignore-not-found

if [ "$ROUTE_ENABLED" = "true" ]; then
  kubectl delete httproute "$APP_NAME-route" -n "$NAMESPACE" --ignore-not-found
fi

echo -e "${GREEN}✅ 卸载完成${NC}"