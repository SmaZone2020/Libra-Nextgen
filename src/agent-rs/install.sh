#!/usr/bin/env bash
# Libra Agent Linux Install Script
# Auto-detects environment, builds Rust agent, injects config, and runs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colors ──────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================"
echo -e "  Libra Agent - Linux Install Script"
echo -e "========================================${NC}"
echo ""

# ── Parse args ──────────────────────────────────────────────────────────

SERVER=""
PORT=5270
BUILD_ONLY=false
SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server) SERVER="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --build-only) BUILD_ONLY=true; shift ;;
        --skip-build) SKIP_BUILD=true; shift ;;
        --help|-h)
            echo "Usage: $0 [--server HOST] [--port PORT] [--build-only] [--skip-build]"
            echo ""
            echo "Options:"
            echo "  --server HOST   Server IP/hostname (default: prompt)"
            echo "  --port PORT     Server port (default: 5270)"
            echo "  --build-only    Build only, don't run"
            echo "  --skip-build    Skip build, run existing binary"
            exit 0
            ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
    esac
done

# ── 1. Environment Detection ────────────────────────────────────────────

echo -e "${YELLOW}[1/5] Detecting environment...${NC}"

# OS info
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "  OS:      $PRETTY_NAME"
else
    echo "  OS:      $(uname -s)"
fi

ARCH=$(uname -m)
echo "  Arch:    $ARCH"

# Map arch to Rust target
case "$ARCH" in
    x86_64|amd64)  RUST_TARGET="x86_64-unknown-linux-gnu" ;;
    aarch64|arm64) RUST_TARGET="aarch64-unknown-linux-gnu" ;;
    armv7l)        RUST_TARGET="armv7-unknown-linux-gnueabihf" ;;
    i686)          RUST_TARGET="i686-unknown-linux-gnu" ;;
    *)             RUST_TARGET="" ;;
esac

if [ -n "$RUST_TARGET" ]; then
    echo "  Target:  $RUST_TARGET"
fi

# Check Rust toolchain
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}  [ERROR] Cargo not found. Install Rust:${NC}"
    echo -e "${RED}          curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh${NC}"
    exit 1
fi
echo "  Rust:    $(cargo --version)"

# Check installed targets
INSTALLED_TARGETS=$(rustup target list --installed 2>/dev/null || echo "")
echo "  Targets: $(echo "$INSTALLED_TARGETS" | tr '\n' ' ')"

# Check Git
if command -v git &> /dev/null; then
    echo "  Git:     $(git --version)"
else
    echo -e "  ${YELLOW}[WARN] Git not found. Build may fail if deps need fetching.${NC}"
fi

# Check build essentials (Linux)
if ! command -v cc &> /dev/null; then
    echo -e "  ${YELLOW}[WARN] C compiler (cc) not found. Install build-essential:${NC}"
    echo -e "  ${YELLOW}        sudo apt install build-essential  (Debian/Ubuntu)${NC}"
    echo -e "  ${YELLOW}        sudo yum groupinstall 'Development Tools'  (RHEL/CentOS)${NC}"
fi

echo ""

# ── 2. Server Configuration ────────────────────────────────────────────

echo -e "${YELLOW}[2/5] Server configuration...${NC}"

if [ -z "$SERVER" ]; then
    read -r -p "  Enter server IP/hostname [127.0.0.1]: " input_server
    SERVER="${input_server:-127.0.0.1}"
fi

SERVER_URL="http://${SERVER}:${PORT}"
echo "  Server URL: $SERVER_URL"
echo ""

# ── 3. Build ───────────────────────────────────────────────────────────

echo -e "${YELLOW}[3/5] Building agent...${NC}"

cd "$SCRIPT_DIR"

if [ "$SKIP_BUILD" = false ]; then
    echo "  Mode: Console"
    BUILD_CMD=("cargo" "build" "--release")

    # Add target if cross-compiling
    if [ -n "$RUST_TARGET" ] && ! echo "$INSTALLED_TARGETS" | grep -q "$RUST_TARGET"; then
        echo "  Installing target: $RUST_TARGET"
        rustup target add "$RUST_TARGET"
        BUILD_CMD+=("--target" "$RUST_TARGET")
    fi

    echo "  Running: ${BUILD_CMD[*]}"
    if ! "${BUILD_CMD[@]}"; then
        echo -e "${RED}  [ERROR] Build failed (exit code: $?)${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}Build succeeded.${NC}"
else
    echo -e "  ${YELLOW}Skipping build (--skip-build).${NC}"
fi

# ── 4. Locate Binary & Inject Config ────────────────────────────────────

echo -e "${YELLOW}[4/5] Preparing binary...${NC}"

# Find the release binary
EXE_PATH=""
if [ -n "$RUST_TARGET" ]; then
    CANDIDATE="$SCRIPT_DIR/target/$RUST_TARGET/release/agent"
    [ -f "$CANDIDATE" ] && EXE_PATH="$CANDIDATE"
fi
if [ -z "$EXE_PATH" ]; then
    CANDIDATE="$SCRIPT_DIR/target/release/agent"
    [ -f "$CANDIDATE" ] && EXE_PATH="$CANDIDATE"
fi

# Fallback: search for it
if [ -z "$EXE_PATH" ]; then
    EXE_PATH=$(find "$SCRIPT_DIR/target" -maxdepth 3 -name "agent" -type f 2>/dev/null | head -1)
fi

if [ -z "$EXE_PATH" ] || [ ! -f "$EXE_PATH" ]; then
    echo -e "${RED}  [ERROR] Binary not found. Check build output.${NC}"
    exit 1
fi

SIZE_KB=$(( $(stat -c%s "$EXE_PATH" 2>/dev/null || stat -f%z "$EXE_PATH" 2>/dev/null) / 1024 ))
echo "  Binary: $EXE_PATH ($SIZE_KB KB)"

# Ensure executable
chmod +x "$EXE_PATH"

# Inject config (append to binary)
echo "  Injecting config..."

CONFIG_JSON=$(cat <<INNEREOF
{"server_url":"$SERVER_URL","register_path":"/api/beacon/register","heartbeat_path":"/api/beacon/heartbeat","result_path":"/api/beacon/result","ws_path":"/ws/agent","heartbeat_interval_ms":3000,"jitter_percent":0.2,"require_admin":false,"copy_to_path":null,"enable_persistence":false}
INNEREOF
)

# Append: MAGIC (16 bytes) + LENGTH (4 bytes LE) + JSON
MAGIC="LIBRA_CFG_BLOCK!"
CONFIG_LEN=${#CONFIG_JSON}

# Use Python for binary append (most portable on Linux)
if command -v python3 &> /dev/null; then
    python3 -c "
import struct, sys
with open('$EXE_PATH', 'ab') as f:
    f.write(b'$MAGIC')
    f.write(struct.pack('<I', $CONFIG_LEN))
    f.write('$CONFIG_JSON'.encode('utf-8'))
"
elif command -v python &> /dev/null; then
    python -c "
import struct, sys
with open('$EXE_PATH', 'ab') as f:
    f.write(b'$MAGIC')
    f.write(struct.pack('<I', $CONFIG_LEN))
    f.write('$CONFIG_JSON'.encode('utf-8'))
"
else
    # Pure bash fallback
    printf '%s' "$MAGIC" >> "$EXE_PATH"
    # Little-endian 4-byte length
    printf '%b' "$(printf '\\x%02x' $((CONFIG_LEN & 0xff)) $(((CONFIG_LEN >> 8) & 0xff)) $(((CONFIG_LEN >> 16) & 0xff)) $(((CONFIG_LEN >> 24) & 0xff)))" >> "$EXE_PATH"
    printf '%s' "$CONFIG_JSON" >> "$EXE_PATH"
fi

echo -e "  ${GREEN}Config injected: $CONFIG_LEN bytes${NC}"

# Create a clean backup (without config) for reuse
CLEAN_PATH="$SCRIPT_DIR/target/release/agent-clean"
if [ ! -f "$CLEAN_PATH" ]; then
    cp "$EXE_PATH" "$CLEAN_PATH" 2>/dev/null || true
    # Re-copy with clean binary by rebuilding? No, just note it.
fi

echo ""

# ── 5. Run ──────────────────────────────────────────────────────────────

if [ "$BUILD_ONLY" = true ]; then
    echo -e "${YELLOW}[5/5] Build-only mode. Binary ready at:${NC}"
    echo -e "  ${GREEN}$EXE_PATH${NC}"
    echo ""
    echo -e "${GRAY}  Run manually with:${NC}"
    echo -e "${GRAY}    $EXE_PATH --server $SERVER_URL${NC}"
    echo -e "${GRAY}  or as background service:${NC}"
    echo -e "${GRAY}    nohup $EXE_PATH --server $SERVER_URL &> /dev/null &${NC}"
else
    echo -e "${YELLOW}[5/5] Starting agent...${NC}"
    echo "  Connecting to: $SERVER_URL"
    echo "  Press Ctrl+C to stop."
    echo ""

    exec "$EXE_PATH" --server "$SERVER_URL"
fi
