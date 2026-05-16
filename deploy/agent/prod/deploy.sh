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
WORKSPACE_ROOT=$(get_value "workspaceRoot")
SESSIONS_DIR=$(get_value "sessionsDir")
PLATFORM_CONFIG_ROOT=$(get_value "platformConfigRoot")
SPACE_STORAGE_PVC=$(get_value "spaceStoragePvc")
WORKSPACE_SUBPATH=$(get_value "workspaceSubpath")
SESSIONS_SUBPATH=$(get_value "sessionsSubpath")
CONFIGS_SUBPATH=$(get_value "configsSubpath")
SESSIONS_NAMESPACE=$(get_value "sessionsNamespace")
AGENT_WORKER_CONCURRENCY=$(get_value "agentWorkerConcurrency")

require_value() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo -e "${RED}✗ 缺少必填配置: ${name}${NC}"
    exit 1
  fi
}

require_value "appName" "$APP_NAME"
require_value "namespace" "$NAMESPACE"
require_value "serviceName" "$SERVICE_NAME"
require_value "port" "$PORT"
require_value "image" "$IMAGE"
require_value "env" "$ENV"
require_value "workspaceRoot" "$WORKSPACE_ROOT"
require_value "sessionsDir" "$SESSIONS_DIR"
require_value "platformConfigRoot" "$PLATFORM_CONFIG_ROOT"
require_value "spaceStoragePvc" "$SPACE_STORAGE_PVC"
require_value "workspaceSubpath" "$WORKSPACE_SUBPATH"
require_value "sessionsSubpath" "$SESSIONS_SUBPATH"
require_value "configsSubpath" "$CONFIGS_SUBPATH"
require_value "sessionsNamespace" "$SESSIONS_NAMESPACE"
require_value "agentWorkerConcurrency" "$AGENT_WORKER_CONCURRENCY"

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
  -e "s|{{WORKSPACE_ROOT}}|${WORKSPACE_ROOT}|g" \
  -e "s|{{SESSIONS_DIR}}|${SESSIONS_DIR}|g" \
  -e "s|{{SESSIONS_NAMESPACE}}|${SESSIONS_NAMESPACE}|g" \
  -e "s|{{AGENT_WORKER_CONCURRENCY}}|${AGENT_WORKER_CONCURRENCY}|g" \
  -e "s|{{PLATFORM_CONFIG_ROOT}}|${PLATFORM_CONFIG_ROOT}|g" \
  -e "s|{{SPACE_STORAGE_PVC}}|${SPACE_STORAGE_PVC}|g" \
  -e "s|{{WORKSPACE_SUBPATH}}|${WORKSPACE_SUBPATH}|g" \
  -e "s|{{SESSIONS_SUBPATH}}|${SESSIONS_SUBPATH}|g" \
  -e "s|{{CONFIGS_SUBPATH}}|${CONFIGS_SUBPATH}|g" \
  rendered/configmap.yaml rendered/deployment.yaml

# Inject resource limits (prod)
awk '/{{RESOURCES}}/ {
  print "          resources:"
  print "            requests:"
  print "              cpu: \"0.5\""
  print "              memory: \"256Mi\""
  print "            limits:"
  print "              cpu: \"1\""
  print "              memory: \"1024Mi\""
  next
}
{ print }' rendered/deployment.yaml > rendered/deployment.tmp && mv rendered/deployment.tmp rendered/deployment.yaml

rm -f rendered/*.bak

kubectl apply -f rendered/secrets.yaml
kubectl apply -f rendered/configmap.yaml
kubectl apply -f rendered/service.yaml
kubectl apply -f rendered/deployment.yaml

echo -e "${BLUE}Agent prod deployment rendered and applied.${NC}"
echo -e "${GREEN}✅ Deploy finished${NC}"
