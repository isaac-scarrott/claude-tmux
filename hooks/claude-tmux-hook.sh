#!/usr/bin/env bash
# Reads a Claude Code hook payload from stdin, derives an internal event,
# appends it to ~/.claude-tmux/events.jsonl. Errors are swallowed to the
# hook log so a broken hook can never break Claude itself.

set -u
set +e

STATE_DIR="${CLAUDE_TMUX_STATE_DIR:-$HOME/.claude-tmux}"
EVENTS_FILE="$STATE_DIR/events.jsonl"
HOOK_LOG="$STATE_DIR/hook.log"
NOTIFY_BIN="${CLAUDE_TMUX_NOTIFY_BIN:-$STATE_DIR/notify-bin}"

mkdir -p "$STATE_DIR" 2>/dev/null

log_err() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >>"$HOOK_LOG" 2>/dev/null; }

if ! command -v jq >/dev/null 2>&1; then
    log_err "jq missing; skipping hook"
    exit 0
fi

PAYLOAD="$(cat 2>/dev/null)"
if [ -z "$PAYLOAD" ]; then
    log_err "empty payload"
    exit 0
fi

EVENT_NAME="${CLAUDE_HOOK_EVENT_NAME:-$(printf '%s' "$PAYLOAD" | jq -r '.hook_event_name // empty')}"
SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty')"
CWD="$(printf '%s' "$PAYLOAD" | jq -r '.cwd // empty')"
PANE_ID="${TMUX_PANE:-}"

if [ -z "$EVENT_NAME" ] || [ -z "$PANE_ID" ]; then
    # No tmux pane = not a row we care about (rows = live panes).
    exit 0
fi

TS="$(perl -MTime::HiRes=time -e 'print int(time()*1000)' 2>/dev/null || date +%s)"

kind=""
extra="{}"
case "$EVENT_NAME" in
    SessionStart)
        kind="session-start"
        extra="$(printf '%s' "$PAYLOAD" | jq -c '{source: .source}')"
        ;;
    UserPromptSubmit)
        kind="user-prompt"
        ;;
    PreToolUse)
        kind="pre-tool-use"
        extra="$(printf '%s' "$PAYLOAD" | jq -c '{tool_name: .tool_name}')"
        ;;
    PostToolUse)
        kind="post-tool-use"
        extra="$(printf '%s' "$PAYLOAD" | jq -c '{tool_name: .tool_name}')"
        ;;
    Stop)
        kind="stop"
        ;;
    StopFailure)
        kind="stop-failure"
        extra="$(printf '%s' "$PAYLOAD" | jq -c '{reason: .reason}')"
        ;;
    Notification)
        kind="notification"
        extra="$(printf '%s' "$PAYLOAD" | jq -c '{notification_type: .notification_type, message: .message}')"
        ;;
    SessionEnd)
        kind="session-end"
        extra="$(printf '%s' "$PAYLOAD" | jq -c '{reason: .reason}')"
        ;;
    *)
        # Unknown hook — log and skip.
        log_err "unknown event: $EVENT_NAME"
        exit 0
        ;;
esac

LINE="$(jq -nc \
    --arg kind "$kind" \
    --arg pane "$PANE_ID" \
    --arg sess "$SESSION_ID" \
    --arg cwd "$CWD" \
    --argjson ts "$TS" \
    --argjson extra "$extra" \
    '{ts:$ts, pane_id:$pane, session_id:$sess, cwd:$cwd, kind:$kind} + $extra')"

if [ -z "$LINE" ]; then
    log_err "failed to compose event line for $EVENT_NAME"
    exit 0
fi

printf '%s\n' "$LINE" >>"$EVENTS_FILE" 2>>"$HOOK_LOG"

tool_name="$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty')"
notification_type="$(printf '%s' "$PAYLOAD" | jq -r '.notification_type // empty')"
should_notify=0
case "$kind" in
    notification)
        [ "$notification_type" != "idle_prompt" ] && should_notify=1
        ;;
    pre-tool-use)
        [ "$tool_name" = "AskUserQuestion" ] && should_notify=1
        ;;
    stop|stop-failure)
        should_notify=1
        ;;
esac

if [ "$should_notify" = "1" ] && [ -x "$NOTIFY_BIN" ]; then
    "$NOTIFY_BIN" "$LINE" >>"$HOOK_LOG" 2>&1 &
fi

exit 0
