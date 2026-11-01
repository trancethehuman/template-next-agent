import type { AssistantDemoStop, AssistantTask, TaskAction } from "./types";

export interface TaskControlRequest {
  runId: string;
  checkpointId?: string;
  action: TaskAction;
  /** Play only: the stage this playback pauses before. */
  stopAt?: AssistantDemoStop;
  requestId: string;
  phase: "submitting" | "accepted" | "uncertain";
  error?: string;
}

export type TaskControlRequests = Readonly<Record<string, TaskControlRequest>>;
const terminal = new Set(["completed", "cancelled", "failed"]);
const requestKey = (runId: string, checkpointId?: string) =>
  `${runId}:${checkpointId ?? "unregistered"}`;

/** A stop targets the whole run; other decisions target one exact checkpoint. */
export function taskControlRequestFor(
  requests: TaskControlRequests,
  task?: AssistantTask,
): TaskControlRequest | undefined {
  if (!task || terminal.has(task.status)) return undefined;
  const stopping = Object.values(requests).find(
    (request) => request.runId === task.runId && request.action === "cancel",
  );
  return stopping ?? requests[requestKey(task.runId, task.checkpointId)];
}

/** Synchronous registration closes the gap before React applies pending state. */
export function beginTaskControl(
  requests: TaskControlRequests,
  task: AssistantTask,
  action: TaskAction,
  createId: () => string,
  stopAt?: AssistantDemoStop,
): { requests: TaskControlRequests; request: TaskControlRequest } | undefined {
  if (terminal.has(task.status) || !task.allowedActions.includes(action))
    return undefined;
  const previous = taskControlRequestFor(requests, task);
  if (previous && (previous.phase !== "uncertain" || previous.action !== action))
    return undefined;
  const request: TaskControlRequest = previous
    ? { ...previous, phase: "submitting", error: undefined }
    : {
        runId: task.runId,
        checkpointId: task.checkpointId,
        action,
        ...(action === "play" && stopAt ? { stopAt } : {}),
        requestId: createId(),
        phase: "submitting",
      };
  return {
    request,
    requests: { ...requests, [requestKey(request.runId, request.checkpointId)]: request },
  };
}

export function settleTaskControl(
  requests: TaskControlRequests,
  request: TaskControlRequest,
  phase: "accepted" | "uncertain",
  error?: string,
): TaskControlRequests {
  const key = requestKey(request.runId, request.checkpointId);
  if (requests[key]?.requestId !== request.requestId) return requests;
  return { ...requests, [key]: { ...request, phase, error } };
}

/** Retrying an ambiguous response must never turn into the opposite decision. */
export function taskWithControlGuard(
  task: AssistantTask | undefined,
  request: TaskControlRequest | undefined,
): AssistantTask | undefined {
  if (!task || !request) return task;
  return {
    ...task,
    allowedActions: request.phase === "uncertain"
      ? task.allowedActions.filter((action) => action === request.action)
      : task.allowedActions,
  };
}

export function taskControlNotice(
  request: TaskControlRequest | undefined,
  task: AssistantTask | undefined,
): string | undefined {
  if (!request) return undefined;
  if (request.phase === "submitting") return "Sending your action to the workflow…";
  if (request.phase === "uncertain")
    return "This action has not been confirmed. Retrying the same action uses its original request ID. Other actions stay unavailable until the workflow advances.";
  if (request.action === "approve" && task?.kind === "calendar_event")
    return "Creation approval accepted. Waiting for the workflow to confirm the Google Calendar result.";
  if (request.action === "cancel")
    return "Stop request accepted. Waiting for the workflow to confirm its final state.";
  return "Action accepted. Waiting for the workflow to advance to its next checkpoint.";
}

export function taskControlView(requests: TaskControlRequests, task?: AssistantTask) {
  const request = taskControlRequestFor(requests, task);
  return {
    task: taskWithControlGuard(task, request),
    pending: Boolean(request && request.phase !== "uncertain"),
    error: request?.error,
    notice: taskControlNotice(request, task),
  };
}
