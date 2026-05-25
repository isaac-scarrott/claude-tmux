# claude-tmux

A tmux popup picker for the Claude Code sessions you have running across your machine. Bound to `<prefix>+a`. Shows what's working, errored, waiting on you, or idle. Grouped by repo, sorted by recency.

Built because I kept losing track of which Claude session was blocked on a permission prompt while I was off in another pane. Sometimes for hours.

## Install

```bash
git clone https://github.com/isaac-scarrott/claude-tmux ~/git/claude-tmux
cd ~/git/claude-tmux
./install.sh
```

`install.sh` is idempotent. It symlinks `bin/` scripts into `~/.local/bin`, `jq`-merges hook entries into `~/.claude/settings.json` (with a timestamped backup), appends a `source-file` line to `~/.tmux.conf`, and reloads the running tmux server.

Requires `bun`, `jq`, `tmux`. Optional: `terminal-notifier` for desktop notifications.

macOS only for now. The OAuth token read uses `security find-generic-password`, which is macOS-specific.

## Keybinding

```
<prefix>+a    open picker
```

In the picker:

```
j / k         move
↵             jump to that pane
type          filter on repo, branch, or last activity
esc           clear filter, or close
q             close
```

## Status glyphs

```
?    needs input — amber. A question is pending or a permission prompt is up.
!    errored — red. Rate limited, tool failed, etc.
›    working — blue.
●    idle with unread output — green.
     idle, read — nothing.
```

A row is "unread" if a Claude event has fired for it since the last time the pane was focused. Read state updates via tmux's `pane-focus-in` hook, so it works whether you opened the pane via this picker or via tmux directly.

## How it works

Three things glued together.

1. **Hook script.** A bash dispatcher subscribed to every Claude Code event. Each event becomes one line in `~/.claude-tmux/events.jsonl`, with `pane_id` captured from `$TMUX_PANE` so events stay tied to where they happened.

2. **Picker.** A Solid app (`@opentui/solid`) that reads the event log, derives current status per pane, enriches with repo + branch + last activity, and renders into a tmux popup. The events file is watched so the popup updates live.

3. **Notify dispatcher.** Fires on `Stop`, `StopFailure`, `Notification` (other than `idle_prompt`), and `PreToolUse(AskUserQuestion)`. Routes: silent if you're focused on the target pane, tmux toast if you're in tmux but elsewhere, desktop notification if you're not in tmux.

## Layout

```
bin/cct                       picker launcher (cd into repo, bun run)
bin/cct-notify                notify dispatcher CLI
bin/cct-mark-viewed           writes a focus-in timestamp
hooks/claude-tmux-hook.sh     bash event dispatcher
src/picker.tsx                Solid app
src/state.ts                  events.jsonl → Map<pane_id, Row>
src/render.ts                 buildItems, sort, formatAge
src/git.ts                    repo + branch via git rev-parse --git-common-dir
src/summary.ts                pulls aiTitle from the JSONL transcript
src/usage.ts                  Anthropic OAuth /usage endpoint, on-disk cache
src/viewed.ts                 reads viewed.jsonl
tmux/keybinds.conf            bind-key and the pane-focus-in hook
install.sh / uninstall.sh
```

## State files

```
~/.claude-tmux/events.jsonl       hook events, append-only
~/.claude-tmux/viewed.jsonl       pane focus-in timestamps
~/.claude-tmux/usage-cache.json   OAuth /usage response, 2-minute TTL
~/.claude-tmux/hook.log           any errors from the hook script
```

Nothing in there is sensitive other than what's already in your JSONL transcripts under `~/.claude/projects/`.

## Tests

```bash
bun test
```

Covers state derivation across every event kind, the hook script end-to-end via spawning the real bash with fake payloads, summary extraction, and render layout. The picker UI itself is exercised manually with a `CLAUDE_TMUX_DEMO=1` mode that ships rich fake data.

## Gotchas

- The `cct` shim has to `cd` into the repo before running, otherwise `bun` doesn't find `bunfig.toml` and falls back to React's JSX runtime (which fails to load).
- Italic ANSI (`\x1b[3m`) is the least portable text attribute. Terminal.app and some font configurations render it as reverse-video. claude-tmux uses colour and weight instead.
- `idle_prompt` notifications (Claude's "are you still there?" timer) get filtered out of needs-input. Only `permission_prompt` and `AskUserQuestion` flip a row to `?`.
- Sessions stuck in `working` after a hard interrupt time out after 5 minutes. `needs-input` rows time out after 30 minutes for the same reason.
- A worktree is grouped under its parent repo via `git rev-parse --git-common-dir`. A broken or prunable worktree falls back to `basename(cwd)`.
- The Anthropic OAuth `/usage` endpoint rate-limits. Cache TTL is 2 minutes and persists to disk so multiple popup opens share it; if it 429s, the usage strip just goes blank until it recovers.

## Uninstall

```bash
./uninstall.sh
```

Removes the symlinks, prunes the hook entries from `~/.claude/settings.json`, and removes the `source-file` line from `~/.tmux.conf`. Leaves `~/.claude-tmux/` in place. Delete that yourself if you want a full wipe.
