import { describe, expect, it } from "bun:test";

import { cleanUserPrompt, extractSummaryFromJsonl, projectDirFromCwd, truncate } from "./summary";

describe("projectDirFromCwd", () => {
    it("encodes slashes as dashes", () => {
        expect(projectDirFromCwd("/Users/isaac/git/holibob")).toBe("-Users-isaac-git-holibob");
    });
});

describe("extractSummaryFromJsonl", () => {
    it("prefers ai-title over user prompt", () => {
        const jsonl = [
            '{"type":"user","message":{"role":"user","content":"first prompt"}}',
            '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"reply"}]}}',
            '{"type":"ai-title","aiTitle":"Fix the login bug","sessionId":"abc"}',
            '{"type":"user","message":{"role":"user","content":"follow-up prompt"}}',
        ].join("\n");
        const r = extractSummaryFromJsonl(jsonl);
        expect(r.source).toBe("ai-title");
        expect(r.text).toBe("Fix the login bug");
    });

    it("falls back to most recent user prompt when no title", () => {
        const jsonl = [
            '{"type":"user","message":{"role":"user","content":"first"}}',
            '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"x"}]}}',
            '{"type":"user","message":{"role":"user","content":"last user text"}}',
        ].join("\n");
        const r = extractSummaryFromJsonl(jsonl);
        expect(r.source).toBe("user-prompt");
        expect(r.text).toBe("last user text");
    });

    it("ignores tool_result content blocks", () => {
        const jsonl = '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"x"}]}}';
        const r = extractSummaryFromJsonl(jsonl);
        expect(r.source).toBe("none");
    });

    it("tolerates corrupt lines", () => {
        const jsonl = [
            "not json",
            '{"type":"ai-title","aiTitle":"My title","sessionId":"a"}',
            "",
            "garbage{{",
        ].join("\n");
        const r = extractSummaryFromJsonl(jsonl);
        expect(r.text).toBe("My title");
    });

    it("returns none for empty content", () => {
        expect(extractSummaryFromJsonl("").source).toBe("none");
    });
});

describe("cleanUserPrompt", () => {
    it("strips command-name and local-command-stdout markup", () => {
        const raw = `<command-name>/clear</command-name>\n<command-message>clear</command-message>`;
        expect(cleanUserPrompt(raw)).toBe("");
    });
    it("collapses whitespace", () => {
        expect(cleanUserPrompt("  fix    the  bug  \n\n ")).toBe("fix the bug");
    });
});

describe("extractSummaryFromJsonl with command markup", () => {
    it("skips user prompts that are just command markup", () => {
        const jsonl = [
            '{"type":"user","message":{"role":"user","content":"<command-name>/clear</command-name><command-message>clear</command-message>"}}',
            '{"type":"user","message":{"role":"user","content":"actual question here"}}',
        ].join("\n");
        const r = extractSummaryFromJsonl(jsonl);
        expect(r.text).toBe("actual question here");
    });
});

describe("truncate", () => {
    it("returns short strings unchanged", () => {
        expect(truncate("short", 10)).toBe("short");
    });
    it("adds an ellipsis when too long", () => {
        expect(truncate("a very long sentence", 10)).toBe("a very lo…");
    });
});
