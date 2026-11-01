export interface TaskRestartResult {
  runId: string;
  parentStopped: boolean;
  notice?: string;
}

export interface TaskRestartRequest {
  sourceRunId: string;
  eventId: string;
  requestId: string;
  phase: "submitting" | "uncertain" | "accepted";
  error?: string;
  result?: TaskRestartResult;
}

export type TaskRestartRequests = Readonly<Record<string, TaskRestartRequest>>;

/** Register before React renders so two clicks cannot create two forks. */
export function beginTaskRestart(
  requests: TaskRestartRequests,
  sourceRunId: string,
  eventId: string,
  createId: () => string,
): { requests: TaskRestartRequests; request: TaskRestartRequest } | undefined {
  if (!sourceRunId || !eventId) return undefined;
  const previous = requests[sourceRunId];
  if (previous?.phase === "submitting" ||
    (previous?.phase === "uncertain" && previous.eventId !== eventId)) return undefined;
  const request: TaskRestartRequest = previous?.phase === "uncertain"
    ? { ...previous, phase: "submitting", error: undefined }
    : { sourceRunId, eventId, requestId: createId(), phase: "submitting" };
  return { request, requests: { ...requests, [sourceRunId]: request } };
}

export function settleTaskRestart(
  requests: TaskRestartRequests,
  request: TaskRestartRequest,
  outcome: { phase: "accepted"; result: TaskRestartResult } | { phase: "uncertain"; error: string },
): TaskRestartRequests {
  if (requests[request.sourceRunId]?.requestId !== request.requestId) return requests;
  return { ...requests, [request.sourceRunId]: { ...request, ...outcome } };
}

export function taskRestartNotice(result: TaskRestartResult): string {
  return result.notice ?? (result.parentStopped
    ? "New run created. The original run stopped; its history is kept."
    : "New run created. The original run is unchanged and may still be running.");
}
