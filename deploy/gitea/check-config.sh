#!/bin/bash
# Gitea 部署配置检查脚本
# 用于验证 values.yaml 和 secrets.yaml 是否已正确填写

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  Cohub 部署配置检查"
echo "========================================"
echo ""

ERRORS=0
WARNINGS=0

# 检查 values.yaml
check_values() {
    echo "📋 检查 values.yaml..."
    
    if [ ! -f "values.yaml" ]; then
        echo -e "${RED}✗ values.yaml 文件不存在${NC}"
        echo "  请先复制模板：cp values.template.yaml values.yaml"
        ERRORS=$((ERRORS + 1))
        return
    fi
    
    # 检查必填字段
    check_field() {
        local field=$1
        local desc=$2
        local value=$(grep -E "^\s*${field}:" values.yaml | head -1 | sed 's/.*: *//' | tr -d '"' | tr -d "'")
        
        if [ -z "$value" ] || [[ "$value" == *"CHANGE_ME"* ]] || [[ "$value" == *"example.com"* ]]; then
            echo -e "${RED}✗ ${desc} 未填写${NC}"
            echo "  字段：${field}"
            ERRORS=$((ERRORS + 1))
        else
            echo -e "${GREEN}✓ ${desc} 已配置${NC}"
        fi
    }
    
    check_field "DOMAIN" "Gitea 域名"
    check_field "ROOT_URL" "Gitea 完整 URL"
    check_field "HOST" "RDS 数据库地址"
    check_field "storageClass" "NAS StorageClass"
    
    # 检查副本数
    replicas=$(grep -E "^replicaCount:" values.yaml | sed 's/.*: *//')
    if [ "$replicas" -lt 2 ] 2>/dev/null; then
        echo -e "${YELLOW}⚠ HA 架构建议 replicaCount >= 2${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${GREEN}✓ 副本数配置合理 (${replicas})${NC}"
    fi
    
    # 检查索引器配置
    issue_indexer=$(grep -E "ISSUE_INDEXER_TYPE:" values.yaml | sed 's/.*: *//')
    if [ "$issue_indexer" == "bleve" ]; then
        echo -e "${RED}✗ HA 架构下 ISSUE_INDEXER_TYPE 不能为 bleve${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓ Issue 索引器配置正确 (${issue_indexer})${NC}"
    fi
    
    repo_indexer=$(grep -E "REPO_INDEXER_ENABLED:" values.yaml | sed 's/.*: *//')
    if [ "$repo_indexer" == "true" ]; then
        echo -e "${YELLOW}⚠ HA 架构下 REPO_INDEXER_ENABLED 建议为 false${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${GREEN}✓ 代码索引器已禁用${NC}"
    fi
    
    echo ""
}

# 检查 secrets.yaml
check_secrets() {
    echo "🔐 检查 secrets.yaml..."
    
    if [ ! -f "secrets.yaml" ]; then
        echo -e "${RED}✗ secrets.yaml 文件不存在${NC}"
        echo "  请先复制模板：cp secrets.template.yaml secrets.yaml"
        ERRORS=$((ERRORS + 1))
        return
    fi
    
    # 检查是否仍包含占位符
    if grep -q "CHANGE_ME" secrets.yaml; then
        echo -e "${RED}✗ secrets.yaml 中仍有未填写的占位符 (CHANGE_ME)${NC}"
        echo "  请搜索并替换所有 CHANGE_ME 标记"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✓ 所有占位符已填写${NC}"
    fi
    
    # 检查必需 Secret 是否存在
    check_secret() {
        local name=$1
        if grep -q "name: ${name}" secrets.yaml; then
            echo -e "${GREEN}✓ Secret '${name}' 已定义${NC}"
        else
            echo -e "${RED}✗ Secret '${name}' 未定义${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    }
    
    check_secret "gitea-admin-secret"
    check_secret "gitea-secrets"
    
    # 检查文件权限
    perms=$(stat -f "%Lp" secrets.yaml 2>/dev/null || stat -c "%a" secrets.yaml 2>/dev/null)
    if [ "$perms" != "600" ]; then
        echo -e "${YELLOW}⚠ 建议设置 secrets.yaml 权限为 600${NC}"
        echo "  执行：chmod 600 secrets.yaml"
        WARNINGS=$((WARNINGS + 1))
    fi
    
    echo ""
}

# 检查依赖组件是否已禁用
check_dependencies() {
    echo "📦 检查内置依赖组件状态..."
    
    check_disabled() {
        local component=$1
        local value=$(grep -A1 "^${component}:" values.yaml | grep "enabled:" | sed 's/.*: *//')
        
        if [ "$value" == "false" ]; then
            echo -e "${GREEN}✓ ${component} 已禁用（使用阿里云托管服务）${NC}"
        else
            echo -e "${YELLOW}⚠ ${component} 未禁用${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
    }
    
    check_disabled "valkey-cluster"
    check_disabled "postgresql"
    check_disabled "minio"
    
    echo ""
}

# 主函数
main() {
    echo "检查路径：$(pwd) (gitea 子目录)"
    echo ""
    
    check_values
    check_secrets
    check_dependencies
    
    echo "========================================"
    echo "  检查结果汇总"
    echo "========================================"
    echo -e "错误：${RED}${ERRORS}${NC}"
    echo -e "警告：${YELLOW}${WARNINGS}${NC}"
    echo ""
    
    if [ $ERRORS -gt 0 ]; then
        echo -e "${RED}❌ 存在错误，请修复后再部署${NC}"
        exit 1
    elif [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠️  存在警告，建议检查后部署${NC}"
        exit 0
    else
        echo -e "${GREEN}✅ 配置检查通过，可以部署${NC}"
        exit 0
    fi
}

main
