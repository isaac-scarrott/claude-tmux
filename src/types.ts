export type Status = "needs-input" | "working" | "error" | "idle";

export const ALL_STATUSES: readonly Status[] = ["needs-input", "working", "error", "idle"] as const;

export type EventBase = {
    ts: number;
    pane_id: string;
    session_id: string;
    cwd: string;
};

export type SessionStartEvent = EventBase & { kind: "session-start"; source?: string };
export type UserPromptEvent = EventBase & { kind: "user-prompt" };
export type PreToolUseEvent = EventBase & { kind: "pre-tool-use"; tool_name?: string };
export type PostToolUseEvent = EventBase & { kind: "post-tool-use"; tool_name?: string };
export type StopEvent = EventBase & { kind: "stop" };
export type StopFailureEvent = EventBase & { kind: "stop-failure"; reason?: string };
export type NotificationEvent = EventBase & { kind: "notification"; notification_type?: string; message?: string };
export type SessionEndEvent = EventBase & { kind: "session-end"; reason?: string };

export type Event =
    | SessionStartEvent
    | UserPromptEvent
    | PreToolUseEvent
    | PostToolUseEvent
    | StopEvent
    | StopFailureEvent
    | NotificationEvent
    | SessionEndEvent;

export type Row = {
    pane_id: string;
    session_id: string;
    cwd: string;
    status: Status;
    last_event_ts: number;
    last_user_prompt_ts: number;
    last_notification?: { message: string; ts: number };
};
