#!/bin/bash
# Gitea 快速部署脚本
# 自动执行：配置检查 -> 创建命名空间 -> 应用 Secret -> 部署 Gitea

set -e

if [ ! -f "./values.yaml" ]; then
  echo "Missing values.yaml. Copy values.example.yaml or values.template.yaml to values.yaml and edit it first."
  exit 1
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置变量
NAMESPACE="${GITEA_NAMESPACE:-cohub}"
RELEASE_NAME="${GITEA_RELEASE:-gitea}"
HELM_REPO="https://dl.gitea.com/charts/"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Cohub 快速部署脚本           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 步骤 1: 配置检查
echo -e "${YELLOW}[1/5] 运行配置检查...${NC}"
if [ -f "./check-config.sh" ]; then
    ./check-config.sh || exit 1
else
    echo -e "${YELLOW}⚠️  未找到 check-config.sh，跳过配置检查${NC}"
fi
echo ""

# 步骤 2: 添加 Helm Chart 仓库
echo -e "${YELLOW}[2/5] 配置 Helm Chart 仓库...${NC}"
helm repo add gitea $HELM_REPO 2>/dev/null || helm repo update gitea
helm repo update
echo -e "${GREEN}✓ Helm Chart 仓库已配置${NC}"
echo ""

# 步骤 3: 创建命名空间
echo -e "${YELLOW}[3/5] 创建 Kubernetes 命名空间 (${NAMESPACE})...${NC}"
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
echo -e "${GREEN}✓ 命名空间已准备${NC}"
echo ""

# 步骤 4: 应用 Secrets
echo -e "${YELLOW}[4/5] 应用 Kubernetes Secrets...${NC}"
if [ -f "./secrets.yaml" ]; then
    kubectl apply -f secrets.yaml -n $NAMESPACE
    echo -e "${GREEN}✓ Secrets 已应用${NC}"
else
    echo -e "${RED}✗ secrets.yaml 文件不存在${NC}"
    echo "  请先复制并填写：cp secrets.template.yaml secrets.yaml"
    exit 1
fi
echo ""

# 步骤 5: 部署 Gitea
echo -e "${YELLOW}[5/5] 部署 Gitea (Helm Install/Upgrade)...${NC}"
helm upgrade --install $RELEASE_NAME gitea/gitea \
    -f values.yaml \
    -n $NAMESPACE \
    --create-namespace \
    --timeout 10m

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   部署完成！                         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# 显示后续操作指引
echo -e "${BLUE}后续操作指引:${NC}"
echo ""
echo "1. 查看 Pod 状态:"
echo -e "   ${YELLOW}kubectl get pods -n ${NAMESPACE}${NC}"
echo ""
echo "2. 查看服务状态:"
echo -e "   ${YELLOW}kubectl get svc -n ${NAMESPACE}${NC}"
echo ""
echo "3. 查看 Gitea 日志:"
echo -e "   ${YELLOW}kubectl logs -n ${NAMESPACE} -l app.kubernetes.io/name=gitea -f${NC}"
echo ""
echo "4. 获取管理员密码:"
echo -e "   ${YELLOW}kubectl get secret gitea-admin-secret -n ${NAMESPACE} -o jsonpath='{.data.password}' | base64 -d${NC}"
echo ""
echo "5. 等待所有 Pod 就绪后，访问 Gitea Web 界面"
echo ""

# 检查 Pod 状态
echo -e "${YELLOW}等待 Pod 就绪...(最多等待 60 秒)${NC}"
for i in {1..12}; do
    total=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=gitea \
        -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | wc -w | tr -d ' ')
    ready=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=gitea \
        -o jsonpath='{range .items[*].status.conditions[?(@.type=="Ready")]}{.status}{"\n"}{end}' 2>/dev/null \
        | awk '$1=="True"{c++} END{print c+0}')

    if [ "$total" -gt 0 ] && [ "$ready" -eq "$total" ]; then
        echo -e "${GREEN}✓ 所有 ${total} 个 Pod 已就绪${NC}"
        break
    fi

    echo "  等待中... (${ready}/${total} ready) - ${i}/12"
    sleep 5

done

echo ""
echo -e "${BLUE}提示：首次访问 Gitea 可能需要 1-2 分钟初始化${NC}"
