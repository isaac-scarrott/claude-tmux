import { type RepoInfo } from "./git";
import { type Summary } from "./summary";
import type { Row, Status } from "./types";

export type DisplayRow = {
    row: Row;
    repo: RepoInfo;
    summary: Summary;
    unread: boolean;
};

export type GroupBrightness = "bright" | "mid" | "dim";

export type Item =
    | { kind: "header"; repo: string; count: number; brightness: GroupBrightness }
    | { kind: "row"; row: DisplayRow };

const STATUS_PRIORITY: Record<Status, number> = {
    "needs-input": 0,
    error: 1,
    working: 2,
    idle: 3,
};

export const STATUS_GLYPH: Record<Status, string> = {
    "needs-input": "?",
    error: "!",
    working: "›",
    idle: " ",
};

function groupUrgency(rows: DisplayRow[]): number {
    let min = 99;
    for (const dr of rows) {
        const p = STATUS_PRIORITY[dr.row.status];
        if (p < min) min = p;
    }
    return min;
}

function brightnessFor(urgency: number): GroupBrightness {
    if (urgency <= 1) return "bright";
    if (urgency === 2) return "mid";
    return "dim";
}

function mostRecent(list: DisplayRow[]): number {
    let max = 0;
    for (const dr of list) if (dr.row.last_event_ts > max) max = dr.row.last_event_ts;
    return max;
}

export function buildItems(rows: DisplayRow[]): Item[] {
    const byRepo = new Map<string, DisplayRow[]>();
    for (const dr of rows) {
        const list = byRepo.get(dr.repo.repo) ?? [];
        list.push(dr);
        byRepo.set(dr.repo.repo, list);
    }

    for (const list of byRepo.values()) {
        list.sort((a, b) => {
            const pa = STATUS_PRIORITY[a.row.status];
            const pb = STATUS_PRIORITY[b.row.status];
            if (pa !== pb) return pa - pb;
            return b.row.last_user_prompt_ts - a.row.last_user_prompt_ts;
        });
    }

    const sortedRepos = Array.from(byRepo.entries()).sort(([nA, lA], [nB, lB]) => {
        const rA = mostRecent(lA);
        const rB = mostRecent(lB);
        if (rA !== rB) return rB - rA;
        return nA.localeCompare(nB);
    });

    const out: Item[] = [];
    for (const [repo, list] of sortedRepos) {
        out.push({ kind: "header", repo, count: list.length, brightness: brightnessFor(groupUrgency(list)) });
        for (const dr of list) out.push({ kind: "row", row: dr });
    }
    return out;
}

export function rowIndices(items: Item[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < items.length; i++) if (items[i]?.kind === "row") out.push(i);
    return out;
}

export function formatAge(ts: number, now = Date.now()): string {
    const sec = Math.max(0, Math.floor((now - ts) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) {
        const rem = min - hr * 60;
        return rem ? `${hr}h${String(rem).padStart(2, "0")}m` : `${hr}h`;
    }
    return `${Math.floor(hr / 24)}d`;
}

export function formatAbsoluteTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
