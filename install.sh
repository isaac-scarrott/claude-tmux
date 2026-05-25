#!/usr/bin/env bash
# claude-tmux installer
# - Symlinks bin/* into $BIN_DIR
# - Deep-merges hook config into ~/.claude/settings.json (backup first)
# - Adds source-file lines to ~/.tmux.conf

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
CLAUDE_SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
TMUX_CONF="${TMUX_CONF:-$HOME/.tmux.conf}"
STATE_DIR="$HOME/.claude-tmux"

require() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "missing required dependency: $1" >&2
        exit 1
    fi
}

echo "→ checking dependencies"
require bun
require jq
require tmux
if ! command -v terminal-notifier >/dev/null 2>&1; then
    echo "  warning: terminal-notifier not found; desktop notifications will fall back to osascript"
fi

echo "→ installing dependencies"
(cd "$REPO_DIR" && bun install --silent)

echo "→ symlinking bin/ → $BIN_DIR"
mkdir -p "$BIN_DIR"
ln -sf "$REPO_DIR/bin/cct" "$BIN_DIR/cct"
ln -sf "$REPO_DIR/bin/cct-notify" "$BIN_DIR/cct-notify"
ln -sf "$REPO_DIR/bin/cct-status-segment" "$BIN_DIR/cct-status-segment"

echo "→ creating state dir at $STATE_DIR"
mkdir -p "$STATE_DIR"
ln -sf "$BIN_DIR/cct-notify" "$STATE_DIR/notify-bin"

HOOK="$REPO_DIR/hooks/claude-tmux-hook.sh"

echo "→ merging Claude Code settings"
mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
if [ -f "$CLAUDE_SETTINGS" ]; then
    cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.cct-backup.$(date +%s)"
    EXISTING="$(cat "$CLAUDE_SETTINGS")"
else
    EXISTING="{}"
fi

ADDITION="$(jq -n --arg hook "$HOOK" '
    {
        hooks: {
            SessionStart:     [{ hooks: [{ type: "command", command: $hook }] }],
            UserPromptSubmit: [{ hooks: [{ type: "command", command: $hook }] }],
            PreToolUse:       [{ matcher: "", hooks: [{ type: "command", command: $hook }] }],
            PostToolUse:      [{ matcher: "", hooks: [{ type: "command", command: $hook }] }],
            Stop:             [{ hooks: [{ type: "command", command: $hook }] }],
            StopFailure:      [{ hooks: [{ type: "command", command: $hook }] }],
            Notification:     [{ hooks: [{ type: "command", command: $hook }] }],
            SessionEnd:       [{ hooks: [{ type: "command", command: $hook }] }]
        }
    }
')"

printf '%s\n' "$EXISTING" | jq --argjson add "$ADDITION" '. * $add' > "$CLAUDE_SETTINGS.tmp"
mv "$CLAUDE_SETTINGS.tmp" "$CLAUDE_SETTINGS"

echo "→ ensuring tmux config sources $REPO_DIR/tmux/keybinds.conf"
SOURCE_LINE="source-file $REPO_DIR/tmux/keybinds.conf"
if [ -f "$TMUX_CONF" ] && grep -Fq "$SOURCE_LINE" "$TMUX_CONF"; then
    echo "  already sourced"
else
    printf '\n# claude-tmux\n%s\n' "$SOURCE_LINE" >> "$TMUX_CONF"
    echo "  appended source-file line to $TMUX_CONF"
fi

if tmux info >/dev/null 2>&1; then
    tmux source-file "$REPO_DIR/tmux/keybinds.conf" 2>/dev/null || true
    echo "  reloaded current tmux server"
fi

echo
echo "✓ installed."
echo "  binary:        $BIN_DIR/cct"
echo "  state dir:     $STATE_DIR"
echo "  claude config: $CLAUDE_SETTINGS"
echo "  keybinding:    <prefix>+a  (in tmux)"
echo
echo "  Next: start a new claude session in tmux, then hit <prefix>+a."
