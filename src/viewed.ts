import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = process.env.CLAUDE_TMUX_STATE_DIR ?? join(homedir(), ".claude-tmux");
const VIEWED_FILE = join(STATE_DIR, "viewed.jsonl");

export async function loadViewedMap(): Promise<Map<string, number>> {
    let text: string;
    try {
        text = await readFile(VIEWED_FILE, "utf8");
    } catch {
        return new Map();
    }
    const out = new Map<string, number>();
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const obj = JSON.parse(trimmed) as { ts?: number; pane_id?: string };
            if (!obj.pane_id || typeof obj.ts !== "number") continue;
            const existing = out.get(obj.pane_id) ?? 0;
            if (obj.ts > existing) out.set(obj.pane_id, obj.ts);
        } catch {
            // skip corrupt lines
        }
    }
    return out;
}
