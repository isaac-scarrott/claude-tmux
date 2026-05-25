#!/usr/bin/env bash
# claude-tmux uninstaller — reverses what install.sh did.
# Hook config keys for the events we wired are removed from settings.json.
# Symlinks are removed. Source-file line is removed from .tmux.conf.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
CLAUDE_SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
TMUX_CONF="${TMUX_CONF:-$HOME/.tmux.conf}"
HOOK="$REPO_DIR/hooks/claude-tmux-hook.sh"

echo "→ removing symlinks from $BIN_DIR"
for f in cct cct-notify cct-status-segment; do
    [ -L "$BIN_DIR/$f" ] && rm "$BIN_DIR/$f" && echo "  removed $BIN_DIR/$f"
done

if [ -f "$CLAUDE_SETTINGS" ]; then
    echo "→ pruning hook entries from $CLAUDE_SETTINGS"
    cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.cct-uninstall-backup.$(date +%s)"
    jq --arg hook "$HOOK" '
        if .hooks then
            .hooks |= with_entries(
                .value |= map(
                    .hooks |= map(select(.command != $hook))
                ) | map(select(.hooks | length > 0))
            )
            | if (.hooks | length) == 0 then del(.hooks) else . end
        else . end
    ' "$CLAUDE_SETTINGS" > "$CLAUDE_SETTINGS.tmp"
    mv "$CLAUDE_SETTINGS.tmp" "$CLAUDE_SETTINGS"
fi

if [ -f "$TMUX_CONF" ]; then
    echo "→ removing source-file line from $TMUX_CONF"
    sed -i.cct-bak "/# claude-tmux/d;\\#source-file $REPO_DIR/tmux/keybinds.conf#d" "$TMUX_CONF"
fi

echo "✓ uninstalled. state in ~/.claude-tmux/ has been left in place."
