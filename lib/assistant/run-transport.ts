import type { AssistantDemoStop, AssistantTask, TaskAction } from "./types";

const stopLabels: Record<AssistantDemoStop, string> = {
  read: "Read",
  prepare: "Prepare",
  review: "Review",
  deliver: "Deliver",
  watch: "Watch",
};

export interface TransportControl {
  action: TaskAction;
  label: string;
}

export type LiveTone = "live" | "waiting" | "idle" | "ended" | "failed";

export interface RunTransport {
  /** Play/pause toggle. Its action always comes from the server's allowed actions. */
  toggle?: TransportControl & { kind: "play" | "pause" };
  next?: TransportControl;
  stop?: TransportControl;
  live: { label: string; tone: LiveTone };
}

/** Maps the server's allowed actions onto media-style controls. It never invents an action. */
export function runTransport(task: AssistantTask): RunTransport {
  const allowed = new Set(task.allowedActions);
  const guided = Boolean(task.demo?.waitingForStep);
  const toggle: RunTransport["toggle"] = allowed.has("pause")
    ? {
        action: "pause",
        kind: "pause",
        label: guided ? "Pause" : "Pause monitoring",
      }
    : allowed.has("play")
      ? { action: "play", kind: "play", label: "Play" }
      : allowed.has("resume")
        ? { action: "resume", kind: "play", label: "Resume" }
        : allowed.has("start")
          ? { action: "start", kind: "play", label: "Start" }
          : undefined;
  const next: RunTransport["next"] = allowed.has("advance")
    ? { action: "advance", label: "Next step" }
    : allowed.has("wake")
      ? { action: "wake", label: "Check now" }
      : undefined;
  return {
    toggle,
    next,
    stop: allowed.has("cancel")
      ? { action: "cancel", label: "Stop run" }
      : undefined,
    live: liveStatus(task),
  };
}

function liveStatus(task: AssistantTask): RunTransport["live"] {
  switch (task.status) {
    case "completed":
      return { label: "Finished", tone: "ended" };
    case "cancelled":
      return { label: "Stopped", tone: "ended" };
    case "failed":
      return { label: "Failed", tone: "failed" };
  }
  if (task.demo?.waitingForStep)
    return task.demo.playback === "play"
      ? {
          label: task.demo.stopAt
            ? `Playing · pauses before ${stopLabels[task.demo.stopAt]}`
            : "Playing",
          tone: "live",
        }
      : { label: "Paused · press Next step to continue", tone: "waiting" };
  switch (task.status) {
    case "running":
      return { label: "Working on the server", tone: "live" };
    case "awaiting_approval":
      return { label: "Waiting for your decision", tone: "waiting" };
    case "sleeping": {
      const nextCheck = task.events.findLast((event) => event.nextCheck)?.nextCheck;
      return {
        label: nextCheck ? `Asleep until ${nextCheck.label}` : "Asleep · waiting for a trigger",
        tone: "idle",
      };
    }
    case "paused":
      return { label: "Paused", tone: "waiting" };
    default:
      return { label: "Ready to start", tone: "waiting" };
  }
}

export type RunShortcut =
  | "toggle"
  | "next"
  | "previous-step"
  | "next-step"
  | "live";

/** Presenter shortcuts. Modified keys stay with the browser. */
export function runShortcut(event: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): RunShortcut | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  switch (event.key) {
    case " ":
    case "k":
    case "K":
      return "toggle";
    case "n":
    case "N":
      return "next";
    case "ArrowLeft":
      return "previous-step";
    case "ArrowRight":
      return "next-step";
    case "l":
    case "L":
      return "live";
  }
  return undefined;
}

/** Text fields, dialogs, and native key behavior of the focused control win. */
export function shortcutTargetAllowed(
  target: EventTarget | null,
  key: string,
): boolean {
  if (!target || typeof (target as Element).closest !== "function") return true;
  const element = target as Element;
  if (
    element.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog']",
    )
  )
    return false;
  if (key === " " && element.closest("button, a, summary, [role='button']"))
    return false;
  if (
    key.startsWith("Arrow") &&
    element.closest(
      "[role='tablist'], [role='radiogroup'], [role='slider'], [role='menu'], [role='listbox']",
    )
  )
    return false;
  return true;
}
