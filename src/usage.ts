import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type Quota = {
    utilization: number;
    resets_at: string | null;
};

export type Usage = {
    five_hour?: Quota;
    seven_day?: Quota;
    fetched_at: number;
    error?: string;
};

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const CACHE_TTL_MS = 120_000;
const STATE_DIR = process.env.CLAUDE_TMUX_STATE_DIR ?? join(homedir(), ".claude-tmux");
const CACHE_FILE = join(STATE_DIR, "usage-cache.json");

let memCache: Usage | undefined;

async function readDiskCache(): Promise<Usage | undefined> {
    try {
        const text = await readFile(CACHE_FILE, "utf8");
        return JSON.parse(text) as Usage;
    } catch {
        return undefined;
    }
}

async function writeDiskCache(usage: Usage): Promise<void> {
    try {
        await mkdir(dirname(CACHE_FILE), { recursive: true });
        await writeFile(CACHE_FILE, JSON.stringify(usage));
    } catch {
        // best-effort; don't break the picker if cache write fails
    }
}

export async function readKeychainToken(): Promise<string | undefined> {
    try {
        const { stdout } = await exec("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
        const parsed = JSON.parse(stdout.trim()) as { claudeAiOauth?: { accessToken?: string } };
        return parsed.claudeAiOauth?.accessToken;
    } catch {
        return undefined;
    }
}

export async function fetchUsage(opts?: { token?: string; force?: boolean }): Promise<Usage> {
    const now = Date.now();
    if (!opts?.force) {
        if (memCache && now - memCache.fetched_at < CACHE_TTL_MS) return memCache;
        const disk = await readDiskCache();
        if (disk && !disk.error && now - disk.fetched_at < CACHE_TTL_MS) {
            memCache = disk;
            return disk;
        }
    }

    const token = opts?.token ?? (await readKeychainToken());
    if (!token) {
        const result: Usage = { fetched_at: now, error: "no-oauth-token" };
        memCache = result;
        return result;
    }

    try {
        const resp = await fetch(ENDPOINT, {
            headers: {
                Authorization: `Bearer ${token}`,
                "anthropic-beta": "oauth-2025-04-20",
            },
        });
        if (!resp.ok) {
            const result: Usage = { fetched_at: now, error: `http-${resp.status}` };
            memCache = result;
            return result;
        }
        const data = (await resp.json()) as { five_hour?: Quota; seven_day?: Quota };
        const result: Usage = {
            five_hour: data.five_hour,
            seven_day: data.seven_day,
            fetched_at: now,
        };
        memCache = result;
        await writeDiskCache(result);
        return result;
    } catch (err) {
        const result: Usage = { fetched_at: now, error: String(err) };
        memCache = result;
        return result;
    }
}

export function formatPct(q: Quota | undefined): string {
    if (!q) return "—";
    return `${q.utilization.toFixed(0)}%`;
}

export function formatResetIn(q: Quota | undefined, now = Date.now()): string {
    if (!q?.resets_at) return "";
    const ms = new Date(q.resets_at).getTime() - now;
    if (ms <= 0) return "resetting";
    const mins = Math.round(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    if (hrs < 24) return rem ? `${hrs}h${rem}m` : `${hrs}h`;
    const days = Math.floor(hrs / 24);
    const remH = hrs % 24;
    return remH ? `${days}d${remH}h` : `${days}d`;
}

