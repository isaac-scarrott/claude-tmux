import { stat, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Summary = {
    text: string;
    source: "ai-title" | "user-prompt" | "none";
};

type CacheEntry = { mtimeMs: number; summary: Summary };
const cache = new Map<string, CacheEntry>();

export function projectDirFromCwd(cwd: string): string {
    return cwd.replace(/\//g, "-");
}

export function jsonlPathFor(sessionId: string, cwd: string, root = join(homedir(), ".claude", "projects")): string {
    return join(root, projectDirFromCwd(cwd), `${sessionId}.jsonl`);
}

export function extractSummaryFromJsonl(text: string): Summary {
    const lines = text.split("\n");
    let latestTitle: string | undefined;
    let latestPrompt: string | undefined;

    for (let i = lines.length - 1; i >= 0; i--) {
        const raw = lines[i]?.trim();
        if (!raw) continue;
        let obj: { type?: string; aiTitle?: string; message?: { role?: string; content?: unknown } };
        try {
            obj = JSON.parse(raw);
        } catch {
            continue;
        }
        if (!latestTitle && obj.type === "ai-title" && typeof obj.aiTitle === "string") {
            latestTitle = obj.aiTitle;
            break;
        }
        if (!latestPrompt && obj.type === "user" && obj.message?.role === "user" && typeof obj.message.content === "string") {
            const clean = cleanUserPrompt(obj.message.content);
            if (clean.length >= 3) latestPrompt = clean;
        }
    }

    if (latestTitle) return { text: latestTitle, source: "ai-title" };
    if (latestPrompt) return { text: latestPrompt, source: "user-prompt" };
    return { text: "(no summary yet)", source: "none" };
}

export async function loadSummary(sessionId: string, cwd: string): Promise<Summary> {
    const path = jsonlPathFor(sessionId, cwd);
    let mtimeMs: number;
    try {
        const st = await stat(path);
        mtimeMs = st.mtimeMs;
    } catch {
        return { text: "(no summary yet)", source: "none" };
    }
    const cached = cache.get(path);
    if (cached && cached.mtimeMs === mtimeMs) return cached.summary;

    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch {
        return { text: "(no summary yet)", source: "none" };
    }
    const summary = extractSummaryFromJsonl(text);
    cache.set(path, { mtimeMs, summary });
    return summary;
}

export function truncate(s: string, max = 60): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
}

export function cleanUserPrompt(raw: string): string {
    return raw
        .replace(/<command-[a-z-]+>[^<]*<\/command-[a-z-]+>/g, "")
        .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
