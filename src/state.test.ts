import { describe, expect, it } from "bun:test";

import { applyEvent, deriveState, filterRowsByLivePanes, parseEventsJsonl } from "./state";
import type { Event, Row } from "./types";

function ev(partial: Partial<Event> & { kind: Event["kind"] }, idx: number): Event {
    return {
        ts: idx,
        pane_id: "%1",
        session_id: "sess-a",
        cwd: "/repo",
        ...partial,
    } as Event;
}

describe("applyEvent", () => {
    it("session-start creates an idle row", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "session-start" }, 1));
        expect(rows.get("%1")?.status).toBe("idle");
    });

    it("user-prompt flips to working", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "session-start" }, 1));
        applyEvent(rows, ev({ kind: "user-prompt" }, 2));
        expect(rows.get("%1")?.status).toBe("working");
    });

    it("pre-tool-use keeps working state", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "user-prompt" }, 1));
        applyEvent(rows, ev({ kind: "pre-tool-use" }, 2));
        expect(rows.get("%1")?.status).toBe("working");
    });

    it("pre-tool-use clears needs-input back to working (next tool ran)", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "notification", message: "approve?" }, 1));
        applyEvent(rows, ev({ kind: "pre-tool-use", tool_name: "Bash" }, 2));
        expect(rows.get("%1")?.status).toBe("working");
    });

    it("pre-tool-use AskUserQuestion sets needs-input", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "user-prompt" }, 1));
        applyEvent(rows, ev({ kind: "pre-tool-use", tool_name: "AskUserQuestion" }, 2));
        expect(rows.get("%1")?.status).toBe("needs-input");
    });

    it("pre-tool-use AskUserQuestion → next tool clears back to working", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "pre-tool-use", tool_name: "AskUserQuestion" }, 1));
        applyEvent(rows, ev({ kind: "pre-tool-use", tool_name: "Bash" }, 2));
        expect(rows.get("%1")?.status).toBe("working");
    });

    it("post-tool-use clears needs-input (declined/answered question)", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "pre-tool-use", tool_name: "AskUserQuestion" }, 1));
        expect(rows.get("%1")?.status).toBe("needs-input");
        applyEvent(rows, ev({ kind: "post-tool-use", tool_name: "AskUserQuestion" }, 2));
        expect(rows.get("%1")?.status).toBe("working");
        expect(rows.get("%1")?.last_notification).toBeUndefined();
    });

    it("stop returns to idle", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "user-prompt" }, 1));
        applyEvent(rows, ev({ kind: "stop" }, 2));
        expect(rows.get("%1")?.status).toBe("idle");
    });

    it("stop-failure flips to error", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "user-prompt" }, 1));
        applyEvent(rows, ev({ kind: "stop-failure", reason: "rate_limit" }, 2));
        expect(rows.get("%1")?.status).toBe("error");
    });

    it("notification (permission_prompt) overrides working", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "user-prompt" }, 1));
        applyEvent(rows, ev({ kind: "notification", notification_type: "permission_prompt", message: "needs input" }, 2));
        expect(rows.get("%1")?.status).toBe("needs-input");
        expect(rows.get("%1")?.last_notification?.message).toBe("needs input");
    });

    it("notification (idle_prompt) sets idle, not needs-input", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "user-prompt" }, 1));
        applyEvent(rows, ev({ kind: "stop" }, 2));
        applyEvent(rows, ev({ kind: "notification", notification_type: "idle_prompt", message: "Claude is waiting for your input" }, 3));
        expect(rows.get("%1")?.status).toBe("idle");
        expect(rows.get("%1")?.last_notification).toBeUndefined();
    });

    it("next user-prompt clears needs-input back to working", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "notification", message: "x" }, 1));
        applyEvent(rows, ev({ kind: "user-prompt" }, 2));
        expect(rows.get("%1")?.status).toBe("working");
        expect(rows.get("%1")?.last_notification).toBeUndefined();
    });

    it("session-end removes the row", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "session-start" }, 1));
        applyEvent(rows, ev({ kind: "session-end" }, 2));
        expect(rows.has("%1")).toBe(false);
    });

    it("each pane is tracked independently", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "user-prompt", pane_id: "%1" }, 1));
        applyEvent(rows, ev({ kind: "notification", pane_id: "%2", message: "x" }, 2));
        expect(rows.get("%1")?.status).toBe("working");
        expect(rows.get("%2")?.status).toBe("needs-input");
    });
});

describe("parseEventsJsonl", () => {
    it("skips blank and corrupt lines", () => {
        const text = `{"ts":1,"pane_id":"%1","session_id":"a","cwd":"/x","kind":"session-start"}
not-json

{"ts":2,"pane_id":"%1","session_id":"a","cwd":"/x","kind":"user-prompt"}`;
        const events = parseEventsJsonl(text);
        expect(events.length).toBe(2);
        expect(events[1]?.kind).toBe("user-prompt");
    });
});

describe("deriveState end-to-end", () => {
    it("replays a full lifecycle correctly", () => {
        const events: Event[] = [
            ev({ kind: "session-start" }, 1),
            ev({ kind: "user-prompt" }, 2),
            ev({ kind: "pre-tool-use", tool_name: "Bash" }, 3),
            ev({ kind: "stop" }, 4),
            ev({ kind: "notification", message: "are you still there?" }, 5),
        ];
        const rows = deriveState(events);
        expect(rows.get("%1")?.status).toBe("needs-input");
        expect(rows.get("%1")?.last_event_ts).toBe(5);
    });
});

describe("filterRowsByLivePanes", () => {
    it("drops rows whose pane is no longer alive", () => {
        const rows = new Map<string, Row>();
        applyEvent(rows, ev({ kind: "user-prompt", pane_id: "%1" }, 1));
        applyEvent(rows, ev({ kind: "user-prompt", pane_id: "%2" }, 2));
        const filtered = filterRowsByLivePanes(rows, new Set(["%1"]));
        expect(filtered.length).toBe(1);
        expect(filtered[0]?.pane_id).toBe("%1");
    });
});

