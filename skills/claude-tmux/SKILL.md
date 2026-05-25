---
name: claude-tmux
description: Architecture, hook contract, and state schema for the claude-tmux repo. Use when extending the picker, adding new event types, changing status derivation, or debugging hook-to-picker flow.
---

# claude-tmux

Tmux popup picker that shows live Claude Code sessions grouped by status, with notifications and Anthropic OAuth usage indicators. Bun + OpenTUI on top of an append-only JSONL event log produced by a bash hook script.

## Architecture in one diagram

```
Claude Code → hook event JSON on stdin
   ↓
hooks/claude-tmux-hook.sh    (bash; ~5ms cold; never blocks Claude on failure)
   ↓ append-only
~/.claude-tmux/events.jsonl  (jsonl, one event per line)
   ↓ replay
src/state.ts derived view    (Map<pane_id, Row>)
   ↓ enrich
src/picker.tsx (OpenTUI)      (live updates via fs.watch on events.jsonl)
```

The hook script also invokes `bin/cct-notify` on `Notification` events to dispatch toasts / desktop notifications.

## Event schema

`~/.claude-tmux/events.jsonl` lines have the shape:

```ts
type Event = {
  ts: number;          // ms since epoch
  pane_id: string;     // e.g. "%42" — from $TMUX_PANE in the hook
  session_id: string;  // Claude session_id from the hook payload
  cwd: string;         // from hook payload
  kind:
    | "session-start"
    | "user-prompt"
    | "pre-tool-use"
    | "stop"
    | "stop-failure"
    | "notification"
    | "session-end"
  // event-specific extras: source, tool_name, reason, message, notification_type
}
```

Defined in `src/types.ts`. Reading/writing rules:

- The hook script (`hooks/claude-tmux-hook.sh`) is the only writer. It composes the line via `jq -nc` so JSON shape is guaranteed.
- The picker is the only reader (plus `bin/cct-status-segment` for the tmux badge).
- Don't add hand-written lines outside the hook — the file is append-only-by-convention, not enforced.

## Status derivation rules (locked)

In `src/state.ts > applyEvent`:

| Event           | Resulting status                                          |
| --------------- | --------------------------------------------------------- |
| session-start   | `idle`                                                    |
| user-prompt     | `working` (clears `last_notification`)                    |
| pre-tool-use    | `working` unless current status is `needs-input` (no-op)  |
| stop            | `idle`                                                    |
| stop-failure    | `error`                                                   |
| notification    | `needs-input` (override) + records `last_notification`    |
| session-end     | row removed                                               |

A `Notification` event always wins. The next `UserPromptSubmit` clears it.

## Rows = live panes, not session_ids

A row in the picker is **one live tmux pane running Claude**. Consequences:

- We don't track detached/resumed sessions — `claude --resume` in a new pane is treated as a brand-new row keyed by the new pane_id.
- Closing the tmux pane drops the row automatically (`filterRowsByLivePanes` against `tmux list-panes`).
- A stale `session-start` with no matching live pane simply doesn't render — no GC needed.

## Summary line

`src/summary.ts > loadSummary`:

1. Read the session's JSONL (`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`).
2. Scan backwards for the most recent `type: "ai-title"` line. If found → use `aiTitle`.
3. Else, scan backwards for the most recent `type: "user"` message with string content. Strip `<command-*>` markup. Skip if shorter than 3 chars.
4. Cache by file mtime.

Coverage on a real machine: roughly half of sessions have an aiTitle; the rest fall back to user prompt.

## Usage data (5h block + 7-day)

`src/usage.ts`:

- OAuth token read from macOS keychain: `security find-generic-password -s "Claude Code-credentials" -w` → JSON with `claudeAiOauth.accessToken`.
- GET `https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer <token>` and `anthropic-beta: oauth-2025-04-20`.
- Response gives `five_hour.utilization`, `five_hour.resets_at`, `seven_day.utilization`, `seven_day.resets_at` — already as percentages. No JSONL token math.
- Cached 30s in-memory. Refresh-loop in the picker fires every 30s.

If you want daily/calendar-day numbers, that endpoint does not provide them — would have to parse JSONL.

## Notification routing

`src/notify.ts > dispatchNotification`:

```
list attached tmux clients
├── none → terminal-notifier (fallback osascript)
├── exactly one, active pane == event pane → silent (you're looking at it)
└── otherwise → tmux display-message toast to all clients
```

Always refresh status-line (`tmux refresh-client -S`) so the badge counter updates.

## Install / uninstall

`install.sh`:
1. Symlinks `bin/cct`, `bin/cct-notify`, `bin/cct-status-segment` → `~/.local/bin/`.
2. `jq`-merges hook config into `~/.claude/settings.json` (with a timestamped backup). Wires all 7 events to `hooks/claude-tmux-hook.sh`.
3. Appends `source-file <repo>/tmux/keybinds.conf` to `~/.tmux.conf`.
4. Creates `~/.claude-tmux/` and symlinks the notify binary into it for the hook to find.

`uninstall.sh` reverses with `jq` filtering and `sed -i.cct-bak`.

## Testing

`bun test` covers:
- All event → status transitions (`state.test.ts`)
- Hook end-to-end (`hook.test.ts` — spawns the real bash script with fake payloads)
- Summary extraction including command-markup cleanup (`summary.test.ts`)
- Render layout / grouping / cursor (`render.test.ts`)
- Usage formatters (`usage.test.ts`)

For the picker UI itself, the testable surface is `dumpPicker()` — runs the whole render pipeline against the events.jsonl and prints what would be shown. Run with:

```sh
CLAUDE_TMUX_FIXTURE=fixtures/events.jsonl bun run src/picker.tsx --dump
```

`fixtures/events.jsonl` is a hand-crafted set of rows covering all four statuses.

## Adding a new event type

1. Add a discriminated variant to `Event` in `src/types.ts`.
2. Handle it in `applyEvent` in `src/state.ts`.
3. Add a `case` in `hooks/claude-tmux-hook.sh` mapping the upstream hook name.
4. Add a test in `src/state.test.ts`.
5. If it should trigger notifications, branch in `src/notify-cli.ts` / `src/notify.ts`.

## Adding a new picker action (e.g. kill pane on `x`)

1. Add a key handler in `src/picker.tsx` (`renderer.keyInput.on("keypress", ...)`).
2. Update the footer in `src/render.ts > buildFooter` to list the new binding.
3. Test by adding a fixture row and running with `--dump` first (can't test interactive keys with the unit harness — use a manual run).

## What's intentionally NOT here

- **Daemon mode** — direct popup launches at ~150ms; adequate for v0. A daemon would shave that to <20ms via Unix socket. Add later if popup feel suffers.
- **Cross-machine sync** — single machine only.
- **Daily (calendar-day) usage** — endpoint doesn't expose it. Add JSONL parsing if needed.
- **Linux desktop notifications** — `terminal-notifier` is macOS. For Linux, swap to `notify-send` in `src/notify.ts`.
- **Status segment auto-refresh trigger** — the badge only updates on `refresh-client -S` (from the notify dispatcher) or status-interval tick. If a hook fires without going through the notify path, status may lag by `status-interval`. Acceptable.

## Common pitfalls

- **`date +%s%3N` doesn't work on macOS** — use `perl -MTime::HiRes=time -e 'print int(time()*1000)'` (already done in the hook).
- **`process.env` spread in tests carries through `TMUX_PANE`** — explicitly `delete env.TMUX_PANE` in tests that need to simulate "outside tmux".
- **OpenTUI requires a TTY on stdout** — piping the picker to anything other than a terminal will error. Use `--dump` for non-interactive inspection.
- **The `cwd → ~/.claude/projects/` encoding is lossy**: `/` becomes `-`, but original dashes vs. slashes can't be distinguished. Worktree paths with many slashes can round-trip incorrectly. Don't rely on the inverse mapping.

## Locked architectural decisions (from grilling)

If you're tempted to change one of these, re-grill first:

1. **Rows = live panes**, not session_ids
2. **Hook events own appearance/disappearance**, with pane-exists filter as safety net
3. **Append-only JSONL**, not sqlite, not materialized json
4. **Bash hook**, not bun (cold start matters per-event)
5. **OAuth endpoint for usage**, not JSONL summation
6. **OpenTUI direct (no daemon) for v0** — daemon when 150ms hurts, not before
