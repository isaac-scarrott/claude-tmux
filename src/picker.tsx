import { watch } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { For, Show, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";

import { repoInfo } from "./git";
import { buildItems, formatAbsoluteTime, formatAge, rowIndices, type DisplayRow, type GroupBrightness } from "./render";
import { filterRowsByLivePanes, loadStateFromFile } from "./state";
import { loadSummary, truncate } from "./summary";
import { isInsideTmux, livePaneIds, switchToPane } from "./tmux";
import { fetchUsage, formatPct, formatResetIn, type Usage } from "./usage";
import type { Status } from "./types";
import { loadViewedMap } from "./viewed";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const STATE_DIR = process.env.CLAUDE_TMUX_STATE_DIR ?? join(homedir(), ".claude-tmux");
const EVENTS_FILE = join(STATE_DIR, "events.jsonl");
const FIXTURE = process.env.CLAUDE_TMUX_FIXTURE;
const DEMO = process.env.CLAUDE_TMUX_DEMO === "1";

const BRANCH_WIDTH = 30;
const AGE_WIDTH = 6;
const STALE_WORKING_MS = 5 * 60_000;
const STALE_NEEDS_INPUT_MS = 30 * 60_000;

const C = {
    bg: "#0a0a0c",
    selBg: "#14141a",
    bright: "#e6e6ea",
    body: "#c8c8cc",
    mid: "#8a8a92",
    dim: "#5a5a64",
    dimmer: "#3a3a44",
    amber: "#ffb000",
    red: "#ff3b30",
};

const BRIGHTNESS_COLOR: Record<GroupBrightness, string> = {
    bright: C.body,
    mid: C.mid,
    dim: C.dim,
};

async function loadDisplayRows(): Promise<DisplayRow[]> {
    if (DEMO) return loadDemoRows();
    const sourceFile = FIXTURE ?? EVENTS_FILE;
    const rows = await loadStateFromFile(sourceFile);
    const filtered = FIXTURE ? Array.from(rows.values()) : filterRowsByLivePanes(rows, await livePaneIds());
    const viewed = await loadViewedMap();
    const now = Date.now();
    const out: DisplayRow[] = [];
    for (const row of filtered) {
        const [repo, summary] = await Promise.all([repoInfo(row.cwd), loadSummary(row.session_id, row.cwd)]);
        const age = now - row.last_event_ts;
        const effectiveRow =
            row.status === "working" && age > STALE_WORKING_MS
                ? { ...row, status: "idle" as const }
                : row.status === "needs-input" && age > STALE_NEEDS_INPUT_MS
                  ? { ...row, status: "idle" as const }
                  : row;
        const lastViewedTs = viewed.get(row.pane_id) ?? 0;
        const unread = row.last_event_ts > lastViewedTs;
        out.push({ row: effectiveRow, repo, summary, unread });
    }
    return out;
}

function loadDemoRows(): DisplayRow[] {
    const now = Date.now();
    const ago = (ms: number) => now - ms;
    function make(opts: { pane: string; repo: string; branch: string; status: Status; summary: string; ago: number; unread?: boolean }): DisplayRow {
        return {
            row: {
                pane_id: opts.pane,
                session_id: `sess-${opts.pane}`,
                cwd: `/Users/isaac/git/${opts.repo}`,
                status: opts.status,
                last_event_ts: ago(opts.ago),
                last_user_prompt_ts: ago(opts.ago + 2_000),
            },
            repo: { repo: opts.repo, branch: opts.branch },
            summary: { text: opts.summary, source: "ai-title" },
            unread: opts.unread ?? (opts.status === "idle" && opts.ago < 30 * 60_000),
        };
    }
    return [
        make({ pane: "%1", repo: "holibob", branch: "hol-237-handoff", status: "needs-input", summary: "Approve dropping the legacy partner table?", ago: 12_000 }),
        make({ pane: "%2", repo: "holibob", branch: "master", status: "idle", summary: "Reviewed PR 5894", ago: 22 * 60_000 }),
        make({ pane: "%3", repo: "payments-mobile", branch: "auth-refactor-v2", status: "needs-input", summary: "Run `pnpm remove @holibob/legacy-auth`?", ago: 38_000 }),
        make({ pane: "%4", repo: "payments-mobile", branch: "auth-refactor-real-this-time", status: "working", summary: "Patched OAuth callback race", ago: 41_000 }),
        make({ pane: "%5", repo: "payments-mobile", branch: "feat-categ", status: "working", summary: "Added merchant categorization heuristics", ago: 19_000 }),
        make({ pane: "%6", repo: "RepDaily", branch: "main", status: "error", summary: "rate limited mid-stream — retry in 28m", ago: 2 * 60_000 }),
        make({ pane: "%7", repo: "claude-tmux", branch: "master", status: "working", summary: "Wrote src/picker.tsx (114 lines)", ago: 4_000 }),
        make({ pane: "%8", repo: "dev-files", branch: "master", status: "idle", summary: "Updated tmux keybindings", ago: 31 * 60_000 }),
        make({ pane: "%9", repo: "notes", branch: "main", status: "idle", summary: "Drafted Q2 planning doc", ago: 2 * 3600_000 + 5 * 60_000 }),
    ];
}

function countWaiting(rows: DisplayRow[]): number {
    return rows.filter((r) => r.row.status === "needs-input").length;
}

function HeaderBar(props: { rows: DisplayRow[]; usage: Usage | undefined; width: number }) {
    const sessions = () => `${props.rows.length} session${props.rows.length === 1 ? "" : "s"}`;
    const waiting = () => countWaiting(props.rows);
    const left = () => {
        return waiting() > 0 ? ` ${sessions()}  ·  ${waiting()} waiting ` : ` ${sessions()} `;
    };
    const usageWidth = () => {
        const u = props.usage;
        if (!u || u.error || !u.five_hour) return 0;
        const reset = formatResetIn(u.five_hour);
        const fivePct = formatPct(u.five_hour);
        const fiveBlock = 3 + 8 + 2 + fivePct.length;
        const resetText = reset ? ` · resets ${reset}`.length : 0;
        const showWeek = (u.seven_day?.utilization ?? 0) >= 90;
        const weekBlock = showWeek ? `       ·       7d ${formatPct(u.seven_day)}`.length : 0;
        return fiveBlock + resetText + weekBlock;
    };
    const leadingCols = 2;
    const padCount = () => Math.max(1, props.width - leadingCols - left().length - usageWidth());

    return (
        <text>
            <span>{"  "}</span>
            <span style={{ fg: C.body }}>{sessions()}</span>
            <Show when={waiting() > 0}>
                <span style={{ fg: C.dim }}>{"  ·  "}</span>
                <span style={{ fg: C.amber }}>{waiting()} waiting</span>
            </Show>
            <span>{" ".repeat(padCount())}</span>
            <Show when={props.usage && !props.usage.error && props.usage.five_hour}>
                <UsageInline usage={props.usage!} />
            </Show>
        </text>
    );
}

function miniBar(pct: number | undefined, width = 8): { filled: string; empty: string } {
    const v = Math.max(0, Math.min(100, pct ?? 0));
    const filled = Math.round((v / 100) * width);
    return { filled: "▰".repeat(filled), empty: "▱".repeat(width - filled) };
}

function UsageInline(props: { usage: Usage }) {
    const reset = () => formatResetIn(props.usage.five_hour);
    const fiveBar = () => miniBar(props.usage.five_hour?.utilization);
    const showWeek = () => (props.usage.seven_day?.utilization ?? 0) >= 90;
    const weekIsHot = () => (props.usage.seven_day?.utilization ?? 0) >= 95;
    return (
        <>
            <span style={{ fg: C.dim }}>5h </span>
            <span style={{ fg: C.amber }}>{fiveBar().filled}</span>
            <span style={{ fg: C.dimmer }}>{fiveBar().empty}</span>
            <span>{"  "}</span>
            <span style={{ fg: C.amber }}>{formatPct(props.usage.five_hour)}</span>
            <Show when={reset()}>
                <span style={{ fg: C.dimmer }}>{" · "}</span>
                <span style={{ fg: C.dim }}>resets {reset()}</span>
            </Show>
            <Show when={showWeek()}>
                <span style={{ fg: C.dimmer }}>{"       ·       "}</span>
                <span style={{ fg: C.dim }}>7d </span>
                <span style={{ fg: weekIsHot() ? C.red : C.amber }}>{formatPct(props.usage.seven_day)}</span>
            </Show>
        </>
    );
}

function GroupHeader(props: { repo: string; count: number; brightness: GroupBrightness; isFirst: boolean }) {
    return (
        <>
            <Show when={!props.isFirst}>
                <text> </text>
            </Show>
            <text>
                <span>{"  "}</span>
                <span style={{ fg: BRIGHTNESS_COLOR[props.brightness] }}>{props.repo}</span>
                <span style={{ fg: C.dimmer }}>
                    {"  "}
                    {props.count} session{props.count === 1 ? "" : "s"}
                </span>
            </text>
        </>
    );
}

type RowKind = Status | "idle-unread";

const ROW_PALETTE: Record<RowKind, { glyph: string; glyphFg: string; branch: string; summary: string; age: string }> = {
    "needs-input": { glyph: "?", glyphFg: C.amber, branch: C.bright, summary: C.bright, age: C.amber },
    error: { glyph: "!", glyphFg: C.red, branch: C.bright, summary: C.body, age: C.red },
    working: { glyph: "›", glyphFg: "#5bc0eb", branch: C.body, summary: C.mid, age: C.dim },
    "idle-unread": { glyph: "●", glyphFg: "#5ce86c", branch: C.body, summary: C.mid, age: C.dim },
    idle: { glyph: " ", glyphFg: C.dim, branch: C.mid, summary: C.dim, age: C.dimmer },
};

function SessionRow(props: { row: DisplayRow; selected: boolean; width: number; now: number }) {
    const status = props.row.row.status;
    const kind: RowKind = status === "idle" && props.row.unread ? "idle-unread" : status;
    const p = ROW_PALETTE[kind];
    const branch = props.row.repo.branch || "—";
    const branchPadded = truncate(branch, BRANCH_WIDTH).padEnd(BRANCH_WIDTH);
    const age = formatAge(props.row.row.last_event_ts, props.now).padStart(AGE_WIDTH);
    const activityWidth = Math.max(8, props.width - (4 + BRANCH_WIDTH + 4 + AGE_WIDTH) - 2);
    const activity = truncate(props.row.summary.text, activityWidth).padEnd(activityWidth);
    return (
        <text style={{ bg: props.selected ? C.selBg : "transparent" }}>
            <span style={{ fg: C.amber }}>{props.selected ? "▸" : " "}</span>
            <span> </span>
            <span style={{ fg: p.glyphFg }}>{p.glyph}</span>
            <span> </span>
            <span style={{ fg: p.branch }}>{branchPadded}</span>
            <span>{"    "}</span>
            <span style={{ fg: p.summary }}>{activity}</span>
            <span> </span>
            <span style={{ fg: p.age }}>{age}</span>
        </text>
    );
}

const FOOTER_HINTS = "type to filter  ·  ↵ jump  ·  esc";
const FOOTER_PADDING = 4; // 2 leading + 2 trailing
const FOOTER_MIN_GAP = 2;

function focusedBranchDisplay(focused: DisplayRow, width: number): string {
    const branch = focused.repo.branch || "—";
    const time = `${formatAbsoluteTime(focused.row.last_event_ts)} local`;
    const fixed = FOOTER_PADDING + focused.repo.repo.length + 6 + time.length + FOOTER_HINTS.length + FOOTER_MIN_GAP;
    const budget = Math.max(4, width - fixed);
    if (branch.length <= budget) return branch;
    return budget <= 1 ? branch.slice(0, budget) : branch.slice(0, budget - 1) + "…";
}

function FooterBar(props: { focused: DisplayRow | undefined; filter: string; width: number }) {
    const leftLength = () => {
        if (props.filter) return 1 + props.filter.length;
        if (!props.focused) return 0;
        const branch = focusedBranchDisplay(props.focused, props.width);
        const time = `${formatAbsoluteTime(props.focused.row.last_event_ts)} local`;
        return props.focused.repo.repo.length + 3 + branch.length + 3 + time.length;
    };
    const padCount = () => Math.max(FOOTER_MIN_GAP, props.width - FOOTER_PADDING - leftLength() - FOOTER_HINTS.length);
    return (
        <text>
            <span>{"  "}</span>
            <Show
                when={props.filter}
                fallback={
                    <Show when={props.focused}>
                        <span style={{ fg: C.dim }}>{props.focused?.repo.repo} · </span>
                        <span style={{ fg: C.body }}>
                            {props.focused ? focusedBranchDisplay(props.focused, props.width) : ""}
                        </span>
                        <span style={{ fg: C.dim }}>
                            {" · "}
                            {formatAbsoluteTime(props.focused?.row.last_event_ts ?? 0)} local
                        </span>
                    </Show>
                }
            >
                <span style={{ fg: C.amber }}>/</span>
                <span style={{ fg: C.bright }}>{props.filter}</span>
            </Show>
            <span>{" ".repeat(padCount())}</span>
            <span style={{ fg: C.dim }}>{FOOTER_HINTS}</span>
            <span>{"  "}</span>
        </text>
    );
}

function App() {
    const [rows, { refetch: refetchRows }] = createResource(loadDisplayRows, { initialValue: [] });
    const [usage, { refetch: refetchUsage }] = createResource<Usage>(() => fetchUsage(), {
        initialValue: { fetched_at: 0 },
    });
    const [selected, setSelected] = createSignal(0);
    const [filter, setFilter] = createSignal("");

    const dims = useTerminalDimensions();
    const renderer = useRenderer();

    const [lastGoodUsage, setLastGoodUsage] = createSignal<Usage | undefined>(undefined);
    createMemo(() => {
        const u = usage();
        if (u && !u.error && u.five_hour) setLastGoodUsage(u);
    });

    const filteredRows = createMemo(() => {
        const f = filter().toLowerCase();
        if (!f) return rows();
        return rows().filter((r) => {
            const hay = `${r.repo.repo} ${r.repo.branch} ${r.summary.text}`.toLowerCase();
            return hay.includes(f);
        });
    });

    const items = createMemo(() => buildItems(filteredRows()));
    const rowIdx = createMemo(() => rowIndices(items()));

    const focused = createMemo<DisplayRow | undefined>(() => {
        const i = rowIdx()[selected()];
        if (i === undefined) return undefined;
        const it = items()[i];
        return it?.kind === "row" ? it.row : undefined;
    });

    // Initial placement: always select the first row. Filter changes also reset to 0.
    createMemo(() => {
        filter();
        setSelected(0);
    });

    const move = (delta: number) => {
        const total = rowIdx().length;
        if (total === 0) return;
        setSelected((s) => (s + delta + total) % total);
    };

    useKeyboard((key) => {
        if ((key.name === "c" && key.ctrl) || key.name === "escape") {
            if (filter()) {
                setFilter("");
                return;
            }
            renderer.destroy();
            process.exit(0);
        }
        if (key.name === "q" && !filter()) {
            renderer.destroy();
            process.exit(0);
        }
        if (key.name === "j" || key.name === "down") {
            move(+1);
            return;
        }
        if (key.name === "k" || key.name === "up") {
            move(-1);
            return;
        }
        if (key.name === "return") {
            const f = focused();
            if (!f) return;
            renderer.destroy();
            (async () => {
                if (isInsideTmux()) {
                    await switchToPane(f.row.pane_id);
                    try {
                        await execFileAsync("cct-mark-viewed", [f.row.pane_id]);
                    } catch {
                        // best-effort
                    }
                }
                process.exit(0);
            })();
            return;
        }
        if (key.name === "backspace") {
            if (filter()) setFilter((s) => s.slice(0, -1));
            return;
        }
        // type-to-filter on any single printable character
        if (key.sequence && key.sequence.length === 1 && !key.ctrl) {
            const ch = key.sequence;
            if (ch >= " " && ch !== "\x7f") {
                setFilter((s) => s + ch);
            }
        }
    });

    onMount(() => {
        if (!FIXTURE) {
            try {
                const w = watch(EVENTS_FILE, { persistent: false }, () => {
                    void refetchRows();
                });
                onCleanup(() => w.close());
            } catch {
                // file doesn't exist yet; first hook fire will create it
            }
        }
        const usageTimer = setInterval(() => void refetchUsage(), 120_000);
        onCleanup(() => clearInterval(usageTimer));
    });

    const width = () => dims().width || 100;
    const now = () => Date.now();

    return (
        <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
            <HeaderBar rows={rows() ?? []} usage={lastGoodUsage()} width={width()} />
            <box style={{ flexDirection: "column", flexGrow: 1, paddingTop: 1 }}>
                <For each={items()}>
                    {(item, i) => {
                        if (item.kind === "header") {
                            const isFirst = items().findIndex((it) => it.kind === "header") === i();
                            return (
                                <GroupHeader
                                    repo={item.repo}
                                    count={item.count}
                                    brightness={item.brightness}
                                    isFirst={isFirst}
                                />
                            );
                        }
                        return (
                            <SessionRow
                                row={item.row}
                                selected={i() === rowIdx()[selected()]}
                                width={width()}
                                now={now()}
                            />
                        );
                    }}
                </For>
            </box>
            <FooterBar focused={focused()} filter={filter()} width={width()} />
        </box>
    );
}

if (process.argv.includes("--dump")) {
    // Solid bindings don't expose an easy headless render; fall back to a
    // textual dump for CI/quick inspection.
    const rows = await loadDisplayRows();
    const items = buildItems(rows);
    console.log(JSON.stringify({ rows: rows.length, items: items.length }));
    process.exit(0);
}

render(() => <App />);
