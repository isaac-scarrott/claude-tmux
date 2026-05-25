import { describe, expect, it } from "bun:test";

import { buildItems, formatAbsoluteTime, formatAge, rowIndices } from "./render";
import type { DisplayRow } from "./render";
import type { Status } from "./types";

function dr(opts: { repo?: string; branch?: string; status?: Status; ts?: number; promptTs?: number; pane?: string } = {}): DisplayRow {
    return {
        row: {
            pane_id: opts.pane ?? "%1",
            session_id: "s",
            cwd: "/r/" + (opts.repo ?? "alpha"),
            status: opts.status ?? "idle",
            last_event_ts: opts.ts ?? 0,
            last_user_prompt_ts: opts.promptTs ?? opts.ts ?? 0,
        },
        repo: { repo: opts.repo ?? "alpha", branch: opts.branch ?? "main" },
        summary: { text: "did a thing", source: "ai-title" },
        unread: false,
    };
}

describe("buildItems", () => {
    it("groups rows by repo", () => {
        const items = buildItems([
            dr({ repo: "alpha", branch: "main" }),
            dr({ repo: "beta", branch: "main" }),
            dr({ repo: "alpha", branch: "feature" }),
        ]);
        const headers = items.filter((i) => i.kind === "header");
        expect(headers.length).toBe(2);
    });

    it("sorts groups by most recent activity", () => {
        const items = buildItems([
            dr({ repo: "old", ts: 100 }),
            dr({ repo: "newest", ts: 700 }),
            dr({ repo: "mid", ts: 300 }),
        ]);
        const headers = items.filter((i) => i.kind === "header").map((h) => h.kind === "header" ? h.repo : "");
        expect(headers).toEqual(["newest", "mid", "old"]);
    });

    it("within a group: status priority first, then by last user prompt", () => {
        const items = buildItems([
            dr({ repo: "alpha", branch: "old-prompt", status: "working", ts: 999, promptTs: 100 }),
            dr({ repo: "alpha", branch: "idle-row", status: "idle", ts: 500, promptTs: 500 }),
            dr({ repo: "alpha", branch: "needs-input-row", status: "needs-input", ts: 200, promptTs: 200 }),
            dr({ repo: "alpha", branch: "fresh-prompt", status: "working", ts: 100, promptTs: 800 }),
        ]);
        const branches = items
            .filter((i) => i.kind === "row")
            .map((i) => (i.kind === "row" ? i.row.repo.branch : ""));
        expect(branches).toEqual(["needs-input-row", "fresh-prompt", "old-prompt", "idle-row"]);
    });

    it("brightness reflects most-urgent row in group", () => {
        const items = buildItems([
            dr({ repo: "hot", status: "needs-input" }),
            dr({ repo: "work", status: "working" }),
            dr({ repo: "cold", status: "idle" }),
        ]);
        const byRepo = Object.fromEntries(
            items
                .filter((i) => i.kind === "header")
                .map((i) => (i.kind === "header" ? [i.repo, i.brightness] : ["", ""]))
        );
        expect(byRepo.hot).toBe("bright");
        expect(byRepo.work).toBe("mid");
        expect(byRepo.cold).toBe("dim");
    });
});

describe("rowIndices", () => {
    it("returns only row indices", () => {
        const items = buildItems([dr({ repo: "a" }), dr({ repo: "b" })]);
        const idx = rowIndices(items);
        expect(idx.length).toBe(2);
        for (const i of idx) expect(items[i]?.kind).toBe("row");
    });
});

describe("formatAge", () => {
    const now = 1_000_000_000_000;
    it("seconds", () => expect(formatAge(now - 12_000, now)).toBe("12s"));
    it("minutes", () => expect(formatAge(now - 4 * 60_000, now)).toBe("4m"));
    it("hours and minutes", () => expect(formatAge(now - (2 * 3600_000 + 5 * 60_000), now)).toBe("2h05m"));
    it("days", () => expect(formatAge(now - 26 * 3600_000, now)).toBe("1d"));
});

describe("formatAbsoluteTime", () => {
    it("renders HH:MM:SS", () => {
        const ts = new Date(2026, 4, 25, 14, 32, 7).getTime();
        expect(formatAbsoluteTime(ts)).toBe("14:32:07");
    });
});
