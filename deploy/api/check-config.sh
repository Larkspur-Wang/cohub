#!/bin/bash
# Workspace API 部署前配置检查

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

get_value() {
  local key="$1"
  grep -E "^${key}:" values.yaml | head -1 | sed 's/^[^:]*:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//'
}

check_required_field() {
  local key="$1"
  local desc="$2"
  local value
  value=$(get_value "$key")

  if [ -z "$value" ] || [[ "$value" == *"CHANGE_ME"* ]] || [[ "$value" == *"example.com"* ]]; then
    echo -e "${RED}✗ ${desc} 未填写 (${key})${NC}"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "${GREEN}✓ ${desc} 已配置${NC}"
  fi
}

check_file_exists() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo -e "${RED}✗ 缺少文件: ${file}${NC}"
    ERRORS=$((ERRORS + 1))
    return 1
  fi
  echo -e "${GREEN}✓ 文件存在: ${file}${NC}"
}

echo "========================================"
echo "  Workspace API 配置检查"
echo "========================================"

echo ""
check_file_exists "values.yaml"
check_file_exists "secrets.yaml"

if [ ! -f "values.yaml" ]; then
  echo -e "${RED}请先复制模板: cp values.template.yaml values.yaml${NC}"
  exit 1
fi

if [ ! -f "secrets.yaml" ]; then
  echo -e "${RED}请先复制模板: cp secrets.template.yaml secrets.yaml${NC}"
  exit 1
fi

echo ""
echo "📋 检查必填字段..."
check_required_field "NAMESPACE" "命名空间"
check_required_field "APP_NAME" "应用名称"
check_required_field "IMAGE_REPOSITORY" "镜像仓库"
check_required_field "IMAGE_TAG" "镜像标签"
check_required_field "AUTH_BASE_URL" "鉴权服务地址"
check_required_field "GITEA_BASE_URL" "Gitea 地址"
check_required_field "WEB_ORIGIN" "Web 域名"
check_required_field "API_HOSTNAME" "API 域名"

echo ""
echo "🔐 检查 secrets.yaml..."
if grep -q "CHANGE_ME" secrets.yaml; then
  echo -e "${YELLOW}⚠ secrets.yaml 仍包含 CHANGE_ME（如仅 public 仓库可接受）${NC}"
  WARNINGS=$((WARNINGS + 1))
else
  echo -e "${GREEN}✓ secrets.yaml 已填写${NC}"
fi

if ! grep -q "name: netaverses-api-secrets" secrets.yaml; then
  echo -e "${RED}✗ secrets.yaml 缺少 Secret 名称 netaverses-api-secrets${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "${GREEN}✓ Secret 名称正确 (netaverses-api-secrets)${NC}"
fi

echo ""
echo "========================================"
echo "检查结果: errors=${ERRORS}, warnings=${WARNINGS}"
echo "========================================"

if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}❌ 检查失败，请修复后重试${NC}"
  exit 1
fi

echo -e "${GREEN}✅ 配置检查通过${NC}"
