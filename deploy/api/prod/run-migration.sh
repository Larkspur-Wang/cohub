#!/bin/bash
# 数据库迁移 Job
# 用法: ./run-migration.sh [IMAGE_TAG]

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFESTS_DIR="$SCRIPT_DIR/../manifests"

get_value() {
  local key="$1"
  grep -E "^${key}:" values.yaml | head -1 | sed 's/^[^:]*:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//'
}

NAMESPACE=$(get_value "NAMESPACE")
APP_NAME=$(get_value "APP_NAME")
IMAGE_REPOSITORY=$(get_value "IMAGE_REPOSITORY")
IMAGE_TAG="${1:-$(get_value "IMAGE_TAG")}"
IMAGE_PULL_POLICY=$(get_value "IMAGE_PULL_POLICY")

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Prod Database Migration Job         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"

echo -e "${YELLOW}Image: ${IMAGE_REPOSITORY}:${IMAGE_TAG}${NC}"

# 删除已存在的 Job（如果有）
kubectl delete job "${APP_NAME}-migrate" -n "$NAMESPACE" --ignore-not-found

# 渲染 Job 模板
mkdir -p rendered

sed \
  -e "s|__NAMESPACE__|${NAMESPACE}|g" \
  -e "s|__APP_NAME__|${APP_NAME}|g" \
  -e "s|__IMAGE_REPOSITORY__|${IMAGE_REPOSITORY}|g" \
  -e "s|__IMAGE_TAG__|${IMAGE_TAG}|g" \
  -e "s|__IMAGE_PULL_POLICY__|${IMAGE_PULL_POLICY}|g" \
  "$MANIFESTS_DIR/migration-job.tmpl.yaml" > rendered/migration-job.yaml

# 创建 Job
kubectl apply -f rendered/migration-job.yaml

echo ""
echo -e "${YELLOW}等待 Migration Job 完成...${NC}"

# 等待 Job 完成
kubectl wait --for=condition=complete job/${APP_NAME}-migrate -n "$NAMESPACE" --timeout=120s && \
  echo -e "${GREEN}✅ Migration 完成${NC}" || \
  echo -e "${RED}❌ Migration 失败，查看日志: kubectl logs job/${APP_NAME}-migrate -n ${NAMESPACE}${NC}"

# 显示 Job 状态
kubectl get job ${APP_NAME}-migrate -n "$NAMESPACE"

echo ""
echo "查看日志："
echo "  kubectl logs job/${APP_NAME}-migrate -n ${NAMESPACE}"