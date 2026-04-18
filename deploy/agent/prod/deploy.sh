#!/bin/bash
# Agent Prod 环境部署脚本

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFESTS_DIR="$(dirname "$SCRIPT_DIR")/manifests"

get_value() {
  local key="$1"
  grep -E "^${key}:" values.yaml | head -1 | sed 's/^[^:]*:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//'
}

APP_NAME=$(get_value "appName")
NAMESPACE=$(get_value "namespace")
SERVICE_NAME=$(get_value "serviceName")
PORT=$(get_value "port")
IMAGE=${OVERRIDE_IMAGE:-$(get_value "image")}
ENV=$(get_value "env")
REDIS_URL=$(get_value "redisUrl")
SESSIONS_DIR=$(get_value "sessionsDir")

if [ ! -f "secrets.yaml" ]; then
  echo -e "${RED}✗ 缺少 secrets.yaml，请先参考 secrets.template.yaml 生成${NC}"
  exit 1
fi

mkdir -p rendered
cp "$MANIFESTS_DIR/configmap.tmpl.yaml" rendered/configmap.yaml
cp "$MANIFESTS_DIR/service.tmpl.yaml" rendered/service.yaml
cp "$MANIFESTS_DIR/deployment.tmpl.yaml" rendered/deployment.yaml
cp "secrets.yaml" rendered/secrets.yaml

sed -i.bak \
  -e "s|{{APP_NAME}}|${APP_NAME}|g" \
  -e "s|{{NAMESPACE}}|${NAMESPACE}|g" \
  -e "s|{{SERVICE_NAME}}|${SERVICE_NAME}|g" \
  -e "s|{{PORT}}|${PORT}|g" \
  rendered/configmap.yaml rendered/service.yaml rendered/deployment.yaml rendered/secrets.yaml

sed -i.bak \
  -e "s|{{APP_NAME}}|${APP_NAME}|g" \
  -e "s|{{NAMESPACE}}|${NAMESPACE}|g" \
  -e "s|{{IMAGE}}|${IMAGE}|g" \
  -e "s|{{PORT}}|${PORT}|g" \
  -e "s|{{ENV}}|${ENV}|g" \
  -e "s|{{REDIS_URL}}|${REDIS_URL}|g" \
  -e "s|{{SESSIONS_DIR}}|${SESSIONS_DIR}|g" \
  rendered/configmap.yaml rendered/deployment.yaml

rm -f rendered/*.bak

kubectl apply -f rendered/secrets.yaml
kubectl apply -f rendered/configmap.yaml
kubectl apply -f rendered/service.yaml
kubectl apply -f rendered/deployment.yaml

echo -e "${BLUE}Agent prod deployment rendered and applied.${NC}"
echo -e "${GREEN}✅ Deploy finished${NC}"
