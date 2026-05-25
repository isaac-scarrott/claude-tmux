# claude-tmux

A tmux popup picker for the Claude Code sessions you have running across your machine. Bound to `<prefix>+a`. Shows what's working, errored, waiting on you, or idle. Grouped by repo, sorted by recency.

Built because I kept losing track of which Claude session was blocked on a permission prompt while I was off in another pane. Sometimes for hours.

## Install

```bash
git clone https://github.com/isaac-scarrott/claude-tmux ~/git/claude-tmux
cd ~/git/claude-tmux
./install.sh
```

`install.sh` is idempotent. It symlinks the binaries into `~/.local/bin`, merges hook entries into `~/.claude/settings.json` (with a timestamped backup), appends a `source-file` line to `~/.tmux.conf`, and reloads the running tmux server.

Requires `bun`, `jq`, `tmux`. Optional: `terminal-notifier` for desktop notifications.

macOS only for now.

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
!    errored — red.
›    working — blue.
●    idle with unread output — green.
     idle, read — nothing.
```

A row is "unread" if a Claude event has fired for it since the last time the pane was focused. Read state updates via tmux's `pane-focus-in` hook, so it works whether you opened the pane via this picker or via tmux directly.

## How it works

Three pieces. A hook script subscribed to every Claude Code event, writing one line per event into an append-only log. A picker that reads that log, derives current status per pane, enriches with repo + branch + last activity, and renders into a tmux popup. A notify dispatcher that fires on completions, errors, questions, and permission prompts — silent if you're already focused on the target pane, tmux toast if you're elsewhere in tmux, desktop notification if you're not in tmux.

## State files

Everything lives under `~/.claude-tmux/`. Nothing in there is sensitive beyond what's already in your Claude transcripts under `~/.claude/projects/`.

## Tests

```bash
bun test
```

Covers state derivation across every event kind, the hook script end-to-end against fake payloads, summary extraction, and the picker's render logic. UI itself is exercised manually with `CLAUDE_TMUX_DEMO=1`, which ships rich fake data.

## Gotchas

- Italic text in terminals is the least portable text attribute. Terminal.app and some font configurations render it as reverse-video, painting a white background where you wanted italic. claude-tmux uses colour and weight instead.
- Claude's "are you still there?" idle nudge does not count as needs-input. Only real permission prompts and AskUserQuestion flip a row to `?`.
- Sessions stuck in `working` after a hard interrupt time out after 5 minutes and silently downgrade to idle. `needs-input` rows time out after 30 minutes for the same reason.
- A worktree is grouped under its parent repo. Broken or prunable worktrees fall back to their directory name.
- The Anthropic usage endpoint rate-limits. If it's unavailable the usage strip just goes blank until it recovers.

## Uninstall

```bash
./uninstall.sh
```

Removes the symlinks, prunes the hook entries from `~/.claude/settings.json`, removes the `source-file` line from `~/.tmux.conf`. Leaves `~/.claude-tmux/` in place. Delete that yourself if you want a full wipe.
