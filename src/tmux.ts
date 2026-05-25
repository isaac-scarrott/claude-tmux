import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type PaneRef = {
    pane_id: string;
    session: string;
    window: string;
    window_name: string;
    pane_index: string;
    pane_pid: string;
    pane_current_path: string;
};

export type ClientInfo = {
    client_session: string;
    client_active_pane: string;
};

export function isInsideTmux(): boolean {
    return Boolean(process.env.TMUX);
}

export async function listPanes(): Promise<PaneRef[]> {
    const fmt = "#{pane_id}\t#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_pid}\t#{pane_current_path}";
    try {
        const { stdout } = await exec("tmux", ["list-panes", "-a", "-F", fmt]);
        return stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                const [pane_id, session, window, window_name, pane_index, pane_pid, pane_current_path] = line.split("\t");
                return {
                    pane_id: pane_id ?? "",
                    session: session ?? "",
                    window: window ?? "",
                    window_name: window_name ?? "",
                    pane_index: pane_index ?? "",
                    pane_pid: pane_pid ?? "",
                    pane_current_path: pane_current_path ?? "",
                };
            });
    } catch {
        return [];
    }
}

export async function livePaneIds(): Promise<Set<string>> {
    const panes = await listPanes();
    return new Set(panes.map((p) => p.pane_id));
}

export async function activeClient(): Promise<ClientInfo | undefined> {
    try {
        const { stdout } = await exec("tmux", ["display-message", "-p", "#{client_session}\t#{pane_id}"]);
        const [client_session, client_active_pane] = stdout.trim().split("\t");
        if (!client_session) return undefined;
        return { client_session, client_active_pane: client_active_pane ?? "" };
    } catch {
        return undefined;
    }
}

export async function switchToPane(paneId: string): Promise<boolean> {
    try {
        await exec("tmux", ["switch-client", "-t", paneId]);
        return true;
    } catch {
        try {
            await exec("tmux", ["select-pane", "-t", paneId]);
            return true;
        } catch {
            return false;
        }
    }
}

export async function displayMessage(message: string): Promise<void> {
    try {
        await exec("tmux", ["display-message", "-d", "5000", message]);
    } catch {
        // ignore
    }
}
