import { describe, expect, it } from "bun:test";

import { formatPct, formatResetIn } from "./usage";

describe("formatPct", () => {
    it("formats utilization as a percent integer", () => {
        expect(formatPct({ utilization: 58.3, resets_at: null })).toBe("58%");
    });
    it("returns dash for missing data", () => {
        expect(formatPct(undefined)).toBe("—");
    });
});

describe("formatResetIn", () => {
    const now = Date.parse("2026-05-25T12:00:00Z");
    it("formats minutes for sub-hour", () => {
        expect(formatResetIn({ utilization: 1, resets_at: "2026-05-25T12:42:00Z" }, now)).toBe("42m");
    });
    it("formats hours when over an hour", () => {
        expect(formatResetIn({ utilization: 1, resets_at: "2026-05-25T15:30:00Z" }, now)).toBe("3h30m");
    });
    it("formats days when over a day", () => {
        expect(formatResetIn({ utilization: 1, resets_at: "2026-05-27T16:00:00Z" }, now)).toBe("2d4h");
    });
    it("returns empty string for no reset", () => {
        expect(formatResetIn({ utilization: 1, resets_at: null }, now)).toBe("");
        expect(formatResetIn(undefined, now)).toBe("");
    });
});
