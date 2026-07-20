#!/bin/bash
# install-hooks.sh - 安装 Kimi hooks 到配置

set -e

echo ">>> Installing Kimi hooks"

# 注意：这是 Kimi CLI 的 hook 安装示例
# 实际安装需要根据 Kimi CLI 的版本和配置路径调整

KIMI_CONFIG_DIR="$HOME/.kimi"
KIMI_CONFIG_FILE="$KIMI_CONFIG_DIR/config.toml"

if [ ! -d "$KIMI_CONFIG_DIR" ]; then
    echo ">>> Creating Kimi config directory: $KIMI_CONFIG_DIR"
    mkdir -p "$KIMI_CONFIG_DIR"
fi

if [ ! -f "$KIMI_CONFIG_FILE" ]; then
    echo ">>> Creating Kimi config file: $KIMI_CONFIG_FILE"
    cat > "$KIMI_CONFIG_FILE" << 'EOF'
# Kimi CLI 配置
[hooks]
EOF
fi

# 备份原配置
cp "$KIMI_CONFIG_FILE" "$KIMI_CONFIG_FILE.bak"

echo ">>> Hooks installed (manual configuration required)"
echo ">>> Please add the following to your $KIMI_CONFIG_FILE:"
echo ""
cat << 'EOF'
[hooks]
auto-format = { event = "PostToolUse", command = "bash .kimi/hooks/auto-format.sh" }
block-oversized = { event = "PreToolUse", command = "bash .kimi/hooks/block-oversized.sh" }
protect-env = { event = "PreToolUse", command = "bash .kimi/hooks/protect-env.sh" }
stop-verify = { event = "Stop", command = "bash .kimi/hooks/stop-verify.sh" }
EOF
