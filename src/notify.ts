import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { repoInfo, formatRepoBranch } from "./git";
import { truncate } from "./summary";
import { displayMessage } from "./tmux";

const exec = promisify(execFile);

export type NotificationInput = {
    pane_id: string;
    cwd: string;
    message?: string;
    notification_type?: string;
};

type AttachedClient = {
    active_pane: string;
    session: string;
};

async function listAttachedClients(): Promise<AttachedClient[]> {
    try {
        const { stdout } = await exec("tmux", ["list-clients", "-F", "#{pane_id}\t#{client_session}"]);
        return stdout
            .split("\n")
            .filter(Boolean)
            .map((l) => {
                const [active_pane, session] = l.split("\t");
                return { active_pane: active_pane ?? "", session: session ?? "" };
            });
    } catch {
        return [];
    }
}

async function desktopNotify(title: string, message: string): Promise<void> {
    try {
        await exec("terminal-notifier", ["-title", title, "-message", message, "-sender", "com.apple.Terminal"]);
    } catch {
        try {
            const escapedMessage = message.replace(/"/g, '\\"');
            const escapedTitle = title.replace(/"/g, '\\"');
            await exec("osascript", ["-e", `display notification "${escapedMessage}" with title "${escapedTitle}"`]);
        } catch {
            // give up
        }
    }
}

async function refreshStatus(): Promise<void> {
    try {
        await exec("tmux", ["refresh-client", "-S"]);
    } catch {
        // ignore
    }
}

export async function dispatchNotification(input: NotificationInput): Promise<void> {
    const info = await repoInfo(input.cwd);
    const label = formatRepoBranch(info);
    const msg = truncate(input.message ?? "Claude needs input", 80);
    const clients = await listAttachedClients();

    await refreshStatus();

    if (clients.length === 0) {
        await desktopNotify(`Claude: ${label}`, msg);
        return;
    }

    const focusedHere = clients.length === 1 && clients[0]?.active_pane === input.pane_id;
    if (focusedHere) return;

    await displayMessage(`[claude] ${label}: ${msg}`);
}
