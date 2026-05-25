import { dispatchNotification } from "./notify";

type Event = {
    pane_id?: string;
    cwd?: string;
    kind?: string;
    tool_name?: string;
    notification_type?: string;
    message?: string;
    reason?: string;
};

function pickMessage(ev: Event): string {
    switch (ev.kind) {
        case "stop":
            return "Done";
        case "stop-failure":
            return ev.reason ? `Errored: ${ev.reason}` : "Errored";
        case "pre-tool-use":
            if (ev.tool_name === "AskUserQuestion") return "Question pending";
            return ev.message ?? "Needs input";
        case "notification":
            return ev.message ?? "Needs input";
        default:
            return ev.message ?? "Needs input";
    }
}

const raw = process.argv[2];
if (!raw) {
    process.stderr.write("usage: cct-notify <event-json>\n");
    process.exit(0);
}

try {
    const event = JSON.parse(raw) as Event;
    if (!event.pane_id || !event.cwd) process.exit(0);
    await dispatchNotification({
        pane_id: event.pane_id,
        cwd: event.cwd,
        message: pickMessage(event),
        notification_type: event.notification_type,
    });
} catch (err) {
    process.stderr.write(`cct-notify error: ${String(err)}\n`);
    process.exit(0);
}
