#!/bin/bash
# Dev 环境部署脚本

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFESTS_DIR="$(dirname "$SCRIPT_DIR")/manifests"

get_value() {
  local key="$1"
  grep -E "^${key}:" values.yaml | head -1 | sed 's/^[^:]*:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//'
}

NAMESPACE=$(get_value "NAMESPACE")
APP_NAME=$(get_value "APP_NAME")
IMAGE_REPOSITORY=$(get_value "IMAGE_REPOSITORY")
IMAGE_TAG=$(get_value "IMAGE_TAG")
IMAGE_PULL_POLICY=$(get_value "IMAGE_PULL_POLICY")
IMAGE_PULL_SECRET=$(get_value "IMAGE_PULL_SECRET")
SERVICE_PORT=$(get_value "SERVICE_PORT")
CONTAINER_PORT=$(get_value "CONTAINER_PORT")
REPLICAS=$(get_value "REPLICAS")
REQUEST_CPU=$(get_value "REQUEST_CPU")
REQUEST_MEMORY=$(get_value "REQUEST_MEMORY")
LIMIT_CPU=$(get_value "LIMIT_CPU")
LIMIT_MEMORY=$(get_value "LIMIT_MEMORY")
LIVENESS_PATH=$(get_value "LIVENESS_PATH")
LIVENESS_INITIAL_DELAY=$(get_value "LIVENESS_INITIAL_DELAY")
LIVENESS_PERIOD=$(get_value "LIVENESS_PERIOD")
LIVENESS_TIMEOUT=$(get_value "LIVENESS_TIMEOUT")
LIVENESS_FAILURE_THRESHOLD=$(get_value "LIVENESS_FAILURE_THRESHOLD")
READINESS_PATH=$(get_value "READINESS_PATH")
READINESS_INITIAL_DELAY=$(get_value "READINESS_INITIAL_DELAY")
READINESS_PERIOD=$(get_value "READINESS_PERIOD")
READINESS_TIMEOUT=$(get_value "READINESS_TIMEOUT")
READINESS_FAILURE_THRESHOLD=$(get_value "READINESS_FAILURE_THRESHOLD")
AUTH_BASE_URL=$(get_value "AUTH_BASE_URL")
GITEA_BASE_URL=$(get_value "GITEA_BASE_URL")
GITEA_MANAGED_EMAIL_DOMAIN=$(get_value "GITEA_MANAGED_EMAIL_DOMAIN")
WEB_ORIGIN=$(get_value "WEB_ORIGIN")
SANDBOX_RUNTIME_IMAGE=$(get_value "SANDBOX_RUNTIME_IMAGE")
ROUTE_ENABLED=$(get_value "ROUTE_ENABLED")
API_HOSTNAME=$(get_value "API_HOSTNAME")
ENV=$(get_value "ENV")

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Cohub API Dev 环境部署         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"

# 根据 ENV 决定 sessions namespace
if [ "$ENV" = "prod" ]; then
  SESSIONS_NAMESPACE="cohub-sessions"
else
  SESSIONS_NAMESPACE="cohub-sessions-dev"
fi

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace "$SESSIONS_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

if [ ! -f "secrets.yaml" ]; then
  echo -e "${RED}✗ 缺少 secrets.yaml${NC}"
  exit 1
fi
kubectl apply -f secrets.yaml

mkdir -p rendered

render_template() {
  local src="$1"
  local dst="$2"
  local imagePullSecretsBlock=""

  if [ -n "$IMAGE_PULL_SECRET" ]; then
    imagePullSecretsBlock="      imagePullSecrets:\n        - name: ${IMAGE_PULL_SECRET}"
  fi

  sed \
    -e "s|__NAMESPACE__|${NAMESPACE}|g" \
    -e "s|__APP_NAME__|${APP_NAME}|g" \
    -e "s|__IMAGE_REPOSITORY__|${IMAGE_REPOSITORY}|g" \
    -e "s|__IMAGE_TAG__|${IMAGE_TAG}|g" \
    -e "s|__IMAGE_PULL_POLICY__|${IMAGE_PULL_POLICY}|g" \
    -e "s|__SERVICE_PORT__|${SERVICE_PORT}|g" \
    -e "s|__CONTAINER_PORT__|${CONTAINER_PORT}|g" \
    -e "s|__REPLICAS__|${REPLICAS}|g" \
    -e "s|__REQUEST_CPU__|${REQUEST_CPU}|g" \
    -e "s|__REQUEST_MEMORY__|${REQUEST_MEMORY}|g" \
    -e "s|__LIMIT_CPU__|${LIMIT_CPU}|g" \
    -e "s|__LIMIT_MEMORY__|${LIMIT_MEMORY}|g" \
    -e "s|__LIVENESS_PATH__|${LIVENESS_PATH}|g" \
    -e "s|__LIVENESS_INITIAL_DELAY__|${LIVENESS_INITIAL_DELAY}|g" \
    -e "s|__LIVENESS_PERIOD__|${LIVENESS_PERIOD}|g" \
    -e "s|__LIVENESS_TIMEOUT__|${LIVENESS_TIMEOUT}|g" \
    -e "s|__LIVENESS_FAILURE_THRESHOLD__|${LIVENESS_FAILURE_THRESHOLD}|g" \
    -e "s|__READINESS_PATH__|${READINESS_PATH}|g" \
    -e "s|__READINESS_INITIAL_DELAY__|${READINESS_INITIAL_DELAY}|g" \
    -e "s|__READINESS_PERIOD__|${READINESS_PERIOD}|g" \
    -e "s|__READINESS_TIMEOUT__|${READINESS_TIMEOUT}|g" \
    -e "s|__READINESS_FAILURE_THRESHOLD__|${READINESS_FAILURE_THRESHOLD}|g" \
    -e "s|__AUTH_BASE_URL__|${AUTH_BASE_URL}|g" \
    -e "s|__GITEA_BASE_URL__|${GITEA_BASE_URL}|g" \
    -e "s|__GITEA_MANAGED_EMAIL_DOMAIN__|${GITEA_MANAGED_EMAIL_DOMAIN}|g" \
    -e "s|__WEB_ORIGIN__|${WEB_ORIGIN}|g" \
    -e "s|__SANDBOX_RUNTIME_IMAGE__|${SANDBOX_RUNTIME_IMAGE}|g" \
    -e "s|__API_HOSTNAME__|${API_HOSTNAME}|g" \
    -e "s|__ENV__|${ENV}|g" \
    -e "/__IMAGE_PULL_SECRETS_BLOCK__/c\\${imagePullSecretsBlock}" \
    "$src" > "$dst"
}

render_template "$MANIFESTS_DIR/configmap.tmpl.yaml" rendered/configmap.yaml
render_template "$MANIFESTS_DIR/deployment.tmpl.yaml" rendered/deployment.yaml
render_template "$MANIFESTS_DIR/service.tmpl.yaml" rendered/service.yaml

kubectl apply -f rendered/configmap.yaml
kubectl apply -f rendered/service.yaml
kubectl apply -f rbac.yaml
kubectl apply -f rendered/deployment.yaml

if [ "$ROUTE_ENABLED" = "true" ]; then
  render_template "$MANIFESTS_DIR/httproute.tmpl.yaml" rendered/httproute.yaml
  kubectl apply -f rendered/httproute.yaml
fi

echo ""
echo -e "${GREEN}✅ Dev 环境部署完成${NC}"
echo ""
echo "查看状态："
echo "  kubectl get pods -n ${NAMESPACE} -l app.kubernetes.io/name=${APP_NAME}"
echo "  kubectl logs -n ${NAMESPACE} -l app.kubernetes.io/name=${APP_NAME} -f"