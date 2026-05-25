import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { loadStateFromFile } from "./state";

const HOOK = join(import.meta.dir, "..", "hooks", "claude-tmux-hook.sh");
let stateDir: string;

beforeAll(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "cct-hook-"));
});

afterAll(async () => {
    await rm(stateDir, { recursive: true, force: true });
});

async function fire(event: string, payload: Record<string, unknown>, pane = "%99") {
    const proc = Bun.spawn([HOOK], {
        env: { ...process.env, CLAUDE_TMUX_STATE_DIR: stateDir, TMUX_PANE: pane, CLAUDE_HOOK_EVENT_NAME: event },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    proc.stdin.write(JSON.stringify({ ...payload, hook_event_name: event }));
    await proc.stdin.end();
    await proc.exited;
}

describe("hook script", () => {
    it("end-to-end: hook payloads produce a derivable state", async () => {
        await fire("SessionStart", { session_id: "s1", cwd: "/r/a", source: "startup" }, "%10");
        await fire("UserPromptSubmit", { session_id: "s1", cwd: "/r/a" }, "%10");
        await fire("PreToolUse", { session_id: "s1", cwd: "/r/a", tool_name: "Bash" }, "%10");
        await fire("Notification", { session_id: "s1", cwd: "/r/a", message: "need approval" }, "%10");
        await fire("SessionStart", { session_id: "s2", cwd: "/r/b" }, "%11");
        await fire("Stop", { session_id: "s2", cwd: "/r/b" }, "%11");

        const eventsPath = join(stateDir, "events.jsonl");
        const raw = await readFile(eventsPath, "utf8");
        expect(raw.split("\n").filter(Boolean).length).toBe(6);

        const state = await loadStateFromFile(eventsPath);
        expect(state.get("%10")?.status).toBe("needs-input");
        expect(state.get("%10")?.last_notification?.message).toBe("need approval");
        expect(state.get("%11")?.status).toBe("idle");
    });

    it("skips events without a TMUX_PANE", async () => {
        const before = (await readFile(join(stateDir, "events.jsonl"), "utf8")).length;
        const env: Record<string, string | undefined> = {
            ...process.env,
            CLAUDE_TMUX_STATE_DIR: stateDir,
            CLAUDE_HOOK_EVENT_NAME: "SessionStart",
        };
        delete env.TMUX_PANE;
        const proc = Bun.spawn([HOOK], { env, stdin: "pipe" });
        proc.stdin.write(JSON.stringify({ session_id: "s9", cwd: "/r/x", hook_event_name: "SessionStart" }));
        await proc.stdin.end();
        await proc.exited;
        const after = (await readFile(join(stateDir, "events.jsonl"), "utf8")).length;
        expect(after).toBe(before);
    });
});
