import { execFile } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type RepoInfo = { repo: string; branch: string };

const cache = new Map<string, RepoInfo>();

async function detectRepoName(cwd: string): Promise<string> {
    try {
        const { stdout } = await exec("git", ["-C", cwd, "rev-parse", "--git-common-dir"]);
        const commonDir = resolve(cwd, stdout.trim());
        return basename(dirname(commonDir));
    } catch {
        return basename(cwd);
    }
}

async function detectBranch(cwd: string): Promise<string> {
    try {
        const { stdout } = await exec("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
        return stdout.trim();
    } catch {
        return "";
    }
}

export async function repoInfo(cwd: string): Promise<RepoInfo> {
    const cached = cache.get(cwd);
    if (cached) return cached;
    const [repo, branch] = await Promise.all([detectRepoName(cwd), detectBranch(cwd)]);
    const result: RepoInfo = { repo, branch };
    cache.set(cwd, result);
    return result;
}

export function formatRepoBranch({ repo, branch }: RepoInfo, maxBranch = 14): string {
    if (!branch) return repo;
    const b = branch.length > maxBranch ? branch.slice(0, maxBranch - 1) + "…" : branch;
    return `${repo}/${b}`;
}
