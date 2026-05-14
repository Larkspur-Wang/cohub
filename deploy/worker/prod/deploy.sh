#!/bin/bash
# Prod 环境 Worker 部署脚本

set -e

GREEN='\033[0;32m'
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
USER_APP_NAME=$(get_value "USER_APP_NAME")
SYSTEM_APP_NAME=$(get_value "SYSTEM_APP_NAME")
IMAGE_REPOSITORY=$(get_value "IMAGE_REPOSITORY")
IMAGE_TAG=${OVERRIDE_IMAGE_TAG:-$(get_value "IMAGE_TAG")}
IMAGE_PULL_POLICY=$(get_value "IMAGE_PULL_POLICY")
IMAGE_PULL_SECRET=$(get_value "IMAGE_PULL_SECRET")
USER_REPLICAS=$(get_value "USER_REPLICAS")
USER_REQUEST_CPU=$(get_value "USER_REQUEST_CPU")
USER_REQUEST_MEMORY=$(get_value "USER_REQUEST_MEMORY")
USER_LIMIT_CPU=$(get_value "USER_LIMIT_CPU")
USER_LIMIT_MEMORY=$(get_value "USER_LIMIT_MEMORY")
SYSTEM_REPLICAS=$(get_value "SYSTEM_REPLICAS")
SYSTEM_REQUEST_CPU=$(get_value "SYSTEM_REQUEST_CPU")
SYSTEM_REQUEST_MEMORY=$(get_value "SYSTEM_REQUEST_MEMORY")
SYSTEM_LIMIT_CPU=$(get_value "SYSTEM_LIMIT_CPU")
SYSTEM_LIMIT_MEMORY=$(get_value "SYSTEM_LIMIT_MEMORY")
FS_CDN_WORKER_CONCURRENCY=$(get_value "FS_CDN_WORKER_CONCURRENCY")
INTERNAL_API_BASE_URL=$(get_value "INTERNAL_API_BASE_URL")
GITEA_BASE_URL=$(get_value "GITEA_BASE_URL")
SPACE_STORAGE_ROOT=$(get_value "SPACE_STORAGE_ROOT")
SPACE_STORAGE_PVC=$(get_value "SPACE_STORAGE_PVC")
SPACE_STORAGE_SUBPATH=$(get_value "SPACE_STORAGE_SUBPATH")
PLATFORM_CONFIG_ROOT=$(get_value "PLATFORM_CONFIG_ROOT")
PLATFORM_SPACE_ID=$(get_value "PLATFORM_SPACE_ID")
CONFIGS_SUBPATH=$(get_value "CONFIGS_SUBPATH")
ENV=$(get_value "ENV")
TURN_OBJECT_S3_ENDPOINT=$(get_value "TURN_OBJECT_S3_ENDPOINT")
TURN_OBJECT_S3_REGION=$(get_value "TURN_OBJECT_S3_REGION")
TURN_OBJECT_S3_BUCKET=$(get_value "TURN_OBJECT_S3_BUCKET")

USER_APP_NAME=${USER_APP_NAME:-${APP_NAME}-user}
SYSTEM_APP_NAME=${SYSTEM_APP_NAME:-${APP_NAME}-system}
FS_CDN_WORKER_CONCURRENCY=${FS_CDN_WORKER_CONCURRENCY:-4}

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
    -e "s|__USER_APP_NAME__|${USER_APP_NAME}|g" \
    -e "s|__SYSTEM_APP_NAME__|${SYSTEM_APP_NAME}|g" \
    -e "s|__SECRET_NAME__|cohub-api-secrets|g" \
    -e "s|__IMAGE_REPOSITORY__|${IMAGE_REPOSITORY}|g" \
    -e "s|__IMAGE_TAG__|${IMAGE_TAG}|g" \
    -e "s|__IMAGE_PULL_POLICY__|${IMAGE_PULL_POLICY}|g" \
    -e "s|__USER_REPLICAS__|${USER_REPLICAS}|g" \
    -e "s|__USER_REQUEST_CPU__|${USER_REQUEST_CPU}|g" \
    -e "s|__USER_REQUEST_MEMORY__|${USER_REQUEST_MEMORY}|g" \
    -e "s|__USER_LIMIT_CPU__|${USER_LIMIT_CPU}|g" \
    -e "s|__USER_LIMIT_MEMORY__|${USER_LIMIT_MEMORY}|g" \
    -e "s|__SYSTEM_REPLICAS__|${SYSTEM_REPLICAS}|g" \
    -e "s|__SYSTEM_REQUEST_CPU__|${SYSTEM_REQUEST_CPU}|g" \
    -e "s|__SYSTEM_REQUEST_MEMORY__|${SYSTEM_REQUEST_MEMORY}|g" \
    -e "s|__SYSTEM_LIMIT_CPU__|${SYSTEM_LIMIT_CPU}|g" \
    -e "s|__SYSTEM_LIMIT_MEMORY__|${SYSTEM_LIMIT_MEMORY}|g" \
    -e "s|__FS_CDN_WORKER_CONCURRENCY__|${FS_CDN_WORKER_CONCURRENCY}|g" \
    -e "s|__INTERNAL_API_BASE_URL__|${INTERNAL_API_BASE_URL}|g" \
    -e "s|__GITEA_BASE_URL__|${GITEA_BASE_URL}|g" \
    -e "s|__SPACE_STORAGE_ROOT__|${SPACE_STORAGE_ROOT}|g" \
    -e "s|__SPACE_STORAGE_PVC__|${SPACE_STORAGE_PVC}|g" \
    -e "s|__SPACE_STORAGE_SUBPATH__|${SPACE_STORAGE_SUBPATH}|g" \
    -e "s|__PLATFORM_CONFIG_ROOT__|${PLATFORM_CONFIG_ROOT}|g" \
    -e "s|__PLATFORM_SPACE_ID__|${PLATFORM_SPACE_ID}|g" \
    -e "s|__CONFIGS_SUBPATH__|${CONFIGS_SUBPATH}|g" \
    -e "s|__ENV__|${ENV}|g" \
    -e "s|__TURN_OBJECT_S3_ENDPOINT__|${TURN_OBJECT_S3_ENDPOINT}|g" \
    -e "s|__TURN_OBJECT_S3_REGION__|${TURN_OBJECT_S3_REGION}|g" \
    -e "s|__TURN_OBJECT_S3_BUCKET__|${TURN_OBJECT_S3_BUCKET}|g" \
    "$dst"
  rm -f "$dst.bak"
}

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Cohub Worker Prod 部署           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo -e "${BLUE}ℹ 复用 API 的 secret: cohub-api-secrets${NC}"

mkdir -p rendered
render_template "$MANIFESTS_DIR/configmap.tmpl.yaml" rendered/configmap.yaml
render_template "$MANIFESTS_DIR/serviceaccount.tmpl.yaml" rendered/serviceaccount.yaml
render_template "$MANIFESTS_DIR/user-deployment.tmpl.yaml" rendered/user-deployment.yaml
render_template "$MANIFESTS_DIR/system-deployment.tmpl.yaml" rendered/system-deployment.yaml

kubectl apply -f rendered/configmap.yaml
kubectl apply -f rendered/serviceaccount.yaml
kubectl apply -f rendered/user-deployment.yaml
kubectl apply -f rendered/system-deployment.yaml

echo ""
echo -e "${GREEN}✅ Worker Prod 部署完成${NC}"
echo ""
echo "查看状态："
echo "  kubectl get pods -n ${NAMESPACE} -l app.kubernetes.io/component=worker"
echo "  kubectl logs -n ${NAMESPACE} -l app.kubernetes.io/name=${USER_APP_NAME} -f"
echo "  kubectl logs -n ${NAMESPACE} -l app.kubernetes.io/name=${SYSTEM_APP_NAME} -f"
