#!/usr/bin/env bash
# Libra-Nextgen Deployment Script (Linux/macOS)
# Builds Agent, Service, and Webapp into dist/

set -euo pipefail

OUT_DIR="${OUT_DIR:-dist}"
SKIP_WEBAPP="${SKIP_WEBAPP:-0}"
SKIP_SERVICE="${SKIP_SERVICE:-0}"
SKIP_AGENT="${SKIP_AGENT:-0}"
AGENT_TARGET="${AGENT_TARGET:-linux-x64}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
DIST_DIR="$SCRIPT_DIR/$OUT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Libra-Nextgen Deployment ===${NC}"
echo "Output:   $DIST_DIR"
echo "Agent RID: $AGENT_TARGET"
echo ""

# ── Clean ────────────────────────────────────────────────────────────────────

if [ -d "$DIST_DIR" ]; then
    echo -e "${YELLOW}[Clean] Removing previous dist/${NC}"
    rm -rf "$DIST_DIR"
fi
mkdir -p "$DIST_DIR"

# ── Pre-flight checks ────────────────────────────────────────────────────────

echo -e "${CYAN}[Check] Verifying prerequisites...${NC}"

if ! command -v dotnet &>/dev/null; then
    echo -e "${RED}Error: .NET SDK not found. Install from https://dotnet.microsoft.com${NC}"
    exit 1
fi
echo "  dotnet: v$(dotnet --version)"

if ! command -v node &>/dev/null; then
    echo -e "${RED}Error: Node.js not found. Install from https://nodejs.org${NC}"
    exit 1
fi
echo "  node:   $(node --version)"

# ── Webapp ───────────────────────────────────────────────────────────────────

if [ "$SKIP_WEBAPP" != "1" ]; then
    echo ""
    echo -e "${CYAN}=== Building Webapp ===${NC}"

    pushd "$SRC_DIR/webapp" > /dev/null

    if [ ! -d "node_modules" ]; then
        echo "[Webapp] Installing dependencies..."
        npm ci
    fi

    echo "[Webapp] Building..."
    npm run build

    webapp_out="$DIST_DIR/webapp"
    cp -r dist "$webapp_out"
    echo -e "${GREEN}[Webapp] Done -> $webapp_out${NC}"

    popd > /dev/null
fi

# ── Service ──────────────────────────────────────────────────────────────────

if [ "$SKIP_SERVICE" != "1" ]; then
    echo ""
    echo -e "${CYAN}=== Building Service ===${NC}"

    pushd "$SRC_DIR" > /dev/null

    service_proj="service/service.csproj"
    service_out="$DIST_DIR/service"

    echo "[Service] Publishing (Release)..."
    dotnet publish "$service_proj" -c Release -o "$service_out" --no-self-contained

    echo -e "${GREEN}[Service] Done -> $service_out${NC}"
    popd > /dev/null
fi

# ── Agent ────────────────────────────────────────────────────────────────────

if [ "$SKIP_AGENT" != "1" ]; then
    echo ""
    echo -e "${CYAN}=== Building Agent (NativeAOT) ===${NC}"

    pushd "$SRC_DIR" > /dev/null

    agent_proj="agent/agent.csproj"
    agent_out="$DIST_DIR/agent"

    echo "[Agent] Publishing Release/$AGENT_TARGET (NativeAOT)..."
    dotnet publish "$agent_proj" -c Release -r "$AGENT_TARGET" -o "$agent_out" --self-contained

    echo -e "${GREEN}[Agent] Done -> $agent_out${NC}"
    popd > /dev/null
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""

format_size() {
    local bytes=$1
    if [ "$bytes" -gt 1048576 ]; then
        echo "$(echo "scale=1; $bytes / 1048576" | bc) MB"
    elif [ "$bytes" -gt 1024 ]; then
        echo "$(echo "scale=1; $bytes / 1024" | bc) KB"
    else
        echo "$bytes B"
    fi
}

total_size=$(du -sb "$DIST_DIR" 2>/dev/null | cut -f1 || echo 0)
echo "Output: $DIST_DIR ($(format_size "$total_size"))"
echo ""
echo "  webapp/   Static frontend files"
echo "  service/  ASP.NET Core backend  (dotnet service.dll)"
echo "  agent/    NativeAOT agent binary"
echo ""
echo -e "${YELLOW}Run the service:${NC}"
echo "  cd $DIST_DIR/service && dotnet service.dll"
echo ""
echo -e "${YELLOW}Serve the webapp (dev):${NC}"
echo "  cd $SRC_DIR/webapp && npm run preview"
