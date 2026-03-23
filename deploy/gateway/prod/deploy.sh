#!/bin/bash
# Prod 环境部署脚本

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
REPLICAS=$(get_value "REPLICAS")
REQUEST_CPU=$(get_value "REQUEST_CPU")
REQUEST_MEMORY=$(get_value "REQUEST_MEMORY")
LIMIT_CPU=$(get_value "LIMIT_CPU")
LIMIT_MEMORY=$(get_value "LIMIT_MEMORY")
ENV=$(get_value "ENV")

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Cohub Gateway Prod 环境部署          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

if [ ! -f "secrets.yaml" ]; then
  echo -e "${RED}✗ 缺少 secrets.yaml，请复制 secrets.template.yaml 并填入真实值${NC}"
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
    -e "s|__REPLICAS__|${REPLICAS}|g" \
    -e "s|__REQUEST_CPU__|${REQUEST_CPU}|g" \
    -e "s|__REQUEST_MEMORY__|${REQUEST_MEMORY}|g" \
    -e "s|__LIMIT_CPU__|${LIMIT_CPU}|g" \
    -e "s|__LIMIT_MEMORY__|${LIMIT_MEMORY}|g" \
    -e "s|__ENV__|${ENV}|g" \
    -e "/__IMAGE_PULL_SECRETS_BLOCK__/c\\${imagePullSecretsBlock}" \
    "$src" > "$dst"
}

render_template "$MANIFESTS_DIR/configmap.tmpl.yaml" rendered/configmap.yaml
render_template "$MANIFESTS_DIR/statefulset.tmpl.yaml" rendered/statefulset.yaml

kubectl apply -f rendered/configmap.yaml
kubectl apply -f rendered/statefulset.yaml

echo ""
echo -e "${GREEN}✅ Prod 环境部署完成${NC}"
echo ""
echo "查看状态："
echo "  kubectl get pods -n ${NAMESPACE} -l app.kubernetes.io/name=${APP_NAME}"
echo "  kubectl logs -n ${NAMESPACE} -l app.kubernetes.io/name=${APP_NAME} -f"