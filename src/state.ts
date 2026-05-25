import { readFile } from "node:fs/promises";

import type { Event, Row } from "./types";

export function applyEvent(rows: Map<string, Row>, ev: Event): Map<string, Row> {
    const existing = rows.get(ev.pane_id);
    const base: Row = existing ?? {
        pane_id: ev.pane_id,
        session_id: ev.session_id,
        cwd: ev.cwd,
        status: "idle",
        last_event_ts: ev.ts,
        last_user_prompt_ts: 0,
    };
    const next: Row = { ...base, session_id: ev.session_id, cwd: ev.cwd, last_event_ts: ev.ts };

    switch (ev.kind) {
        case "session-start":
            next.status = "idle";
            next.last_notification = undefined;
            break;
        case "user-prompt":
            next.status = "working";
            next.last_notification = undefined;
            next.last_user_prompt_ts = ev.ts;
            break;
        case "pre-tool-use":
            if (ev.tool_name === "AskUserQuestion") {
                next.status = "needs-input";
                next.last_notification = { message: "question pending", ts: ev.ts };
            } else {
                next.status = "working";
            }
            break;
        case "post-tool-use":
            // Tool finished (including AskUserQuestion answered/declined).
            // Clear needs-input back to working; next Stop event will flip to idle.
            next.status = "working";
            next.last_notification = undefined;
            break;
        case "stop":
            next.status = "idle";
            break;
        case "stop-failure":
            next.status = "error";
            break;
        case "notification":
            if (ev.notification_type === "idle_prompt") {
                next.status = "idle";
            } else {
                next.status = "needs-input";
                if (ev.message) next.last_notification = { message: ev.message, ts: ev.ts };
            }
            break;
        case "session-end":
            rows.delete(ev.pane_id);
            return rows;
    }

    rows.set(ev.pane_id, next);
    return rows;
}

export function deriveState(events: Event[]): Map<string, Row> {
    const rows = new Map<string, Row>();
    for (const ev of events) applyEvent(rows, ev);
    return rows;
}

export function parseEventsJsonl(text: string): Event[] {
    const out: Event[] = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            out.push(JSON.parse(trimmed) as Event);
        } catch {
            // tolerate corrupt lines; the hook log catches actual failures
        }
    }
    return out;
}

export async function loadStateFromFile(path: string): Promise<Map<string, Row>> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
        throw err;
    }
    return deriveState(parseEventsJsonl(text));
}

export function filterRowsByLivePanes(rows: Map<string, Row>, livePaneIds: Set<string>): Row[] {
    const out: Row[] = [];
    for (const r of rows.values()) if (livePaneIds.has(r.pane_id)) out.push(r);
    return out;
}
