#!/bin/bash
# Dev 环境 Worker 部署脚本
# Worker 复用 API 的 secret（cohub-api-dev-secrets），不需要单独管理

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
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
IMAGE_TAG=${OVERRIDE_IMAGE_TAG:-$(get_value "IMAGE_TAG")}
IMAGE_PULL_POLICY=$(get_value "IMAGE_PULL_POLICY")
IMAGE_PULL_SECRET=$(get_value "IMAGE_PULL_SECRET")
REPLICAS=$(get_value "REPLICAS")
REQUEST_CPU=$(get_value "REQUEST_CPU")
REQUEST_MEMORY=$(get_value "REQUEST_MEMORY")
LIMIT_CPU=$(get_value "LIMIT_CPU")
LIMIT_MEMORY=$(get_value "LIMIT_MEMORY")
INTERNAL_API_BASE_URL=$(get_value "INTERNAL_API_BASE_URL")
SPACE_STORAGE_ROOT=$(get_value "SPACE_STORAGE_ROOT")
SPACE_STORAGE_PVC=$(get_value "SPACE_STORAGE_PVC")
SPACE_STORAGE_SUBPATH=$(get_value "SPACE_STORAGE_SUBPATH")
ENV=$(get_value "ENV")

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Cohub Worker Dev 环境部署          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo -e "${BLUE}ℹ 复用 API 的 secret: cohub-api-dev-secrets${NC}"

mkdir -p rendered

render_template() {
  local src="$1"
  local dst="$2"
  cp "$src" "$dst"

  python - "$dst" "$IMAGE_PULL_SECRET" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
secret = sys.argv[2]
text = path.read_text()
placeholder = "__IMAGE_PULL_SECRETS_BLOCK__\n"
if placeholder in text:
    replacement = ""
    if secret:
        replacement = f"      imagePullSecrets:\n        - name: {secret}\n"
    text = text.replace(placeholder, replacement)
path.write_text(text)
PY

  sed -i.bak \
    -e "s|__NAMESPACE__|${NAMESPACE}|g" \
    -e "s|__APP_NAME__|${APP_NAME}|g" \
    -e "s|__SECRET_NAME__|cohub-api-dev-secrets|g" \
    -e "s|__IMAGE_REPOSITORY__|${IMAGE_REPOSITORY}|g" \
    -e "s|__IMAGE_TAG__|${IMAGE_TAG}|g" \
    -e "s|__IMAGE_PULL_POLICY__|${IMAGE_PULL_POLICY}|g" \
    -e "s|__REPLICAS__|${REPLICAS}|g" \
    -e "s|__REQUEST_CPU__|${REQUEST_CPU}|g" \
    -e "s|__REQUEST_MEMORY__|${REQUEST_MEMORY}|g" \
    -e "s|__LIMIT_CPU__|${LIMIT_CPU}|g" \
    -e "s|__LIMIT_MEMORY__|${LIMIT_MEMORY}|g" \
    -e "s|__INTERNAL_API_BASE_URL__|${INTERNAL_API_BASE_URL}|g" \
    -e "s|__SPACE_STORAGE_ROOT__|${SPACE_STORAGE_ROOT}|g" \
    -e "s|__SPACE_STORAGE_PVC__|${SPACE_STORAGE_PVC}|g" \
    -e "s|__SPACE_STORAGE_SUBPATH__|${SPACE_STORAGE_SUBPATH}|g" \
    -e "s|__ENV__|${ENV}|g" \
    "$dst"
  rm -f "$dst.bak"
}

render_template "$MANIFESTS_DIR/configmap.tmpl.yaml" rendered/configmap.yaml
render_template "$MANIFESTS_DIR/deployment.tmpl.yaml" rendered/deployment.yaml

kubectl apply -f rendered/configmap.yaml
kubectl apply -f rbac.yaml
kubectl apply -f rendered/deployment.yaml

echo ""
echo -e "${GREEN}✅ Worker Dev 部署完成${NC}"
echo ""
echo "查看状态："
echo "  kubectl get pods -n ${NAMESPACE} -l app.kubernetes.io/name=${APP_NAME}"
echo "  kubectl logs -n ${NAMESPACE} -l app.kubernetes.io/name=${APP_NAME} -f"
