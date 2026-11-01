import { describe, expect, test } from "bun:test";
import {
  beginTaskControl,
  settleTaskControl,
  taskControlView,
} from "@/lib/assistant/task-controls";
import type { AssistantTask } from "@/lib/assistant/types";

const proposal: AssistantTask = {
  runId: "wrun_synthetic_calendar_proposal",
  title: "Synthetic event",
  prompt: "Create one private test event after owner approval.",
  kind: "calendar_event",
  mode: "calendar",
  status: "awaiting_approval",
  workflowStatus: "running",
  createdAt: "2026-10-30T20:00:00Z",
  updatedAt: "2026-10-30T20:00:01Z",
  events: [],
  notificationCount: 0,
  sourceVersion: 1,
  preference: { bulletCount: 3, includeLinks: true },
  checkpointId: "step_synthetic_owner_review",
  allowedActions: ["approve", "deny", "cancel"],
};

describe("task action acceptance", () => {
  test("HTTP acceptance keeps old checkpoint controls pending across stale refreshes and reopen", () => {
    const started = beginTaskControl({}, proposal, "approve", () => "synthetic-approval-1")!;
    const accepted = settleTaskControl(started.requests, started.request, "accepted");
    // An immediate API refresh can legitimately return the same old state.
    const staleRead = { ...proposal, allowedActions: [...proposal.allowedActions] };
    expect(taskControlView(accepted, staleRead).pending).toBe(true);
    expect(taskControlView(accepted, staleRead).notice).toContain("Waiting for the workflow");
    expect(taskControlView(accepted, staleRead).notice).toContain("Google Calendar result");
    expect(beginTaskControl(accepted, staleRead, "approve", () => "must-not-send")).toBeUndefined();
    expect(beginTaskControl(accepted, staleRead, "deny", () => "must-not-send")).toBeUndefined();
    // Closing the sheet is presentation-only. Reopening uses the retained map.
    expect(taskControlView(accepted).pending).toBe(false);
    expect(taskControlView(accepted, staleRead).pending).toBe(true);
    expect(staleRead.status).toBe("awaiting_approval");
    expect(staleRead.calendarEvent).toBeUndefined();
  });

  test("a new server checkpoint releases the old decision but an out-of-order old read stays guarded", () => {
    const started = beginTaskControl({}, proposal, "approve", () => "synthetic-approval-2")!;
    const accepted = settleTaskControl(started.requests, started.request, "accepted");
    const advanced: AssistantTask = {
      ...proposal, status: "running", checkpointId: "step_synthetic_creating", allowedActions: [],
    };
    expect(taskControlView(accepted, advanced).pending).toBe(false);
    expect(taskControlView(accepted, advanced).notice).toBeUndefined();
    expect(taskControlView(accepted, proposal).pending).toBe(true);
    expect(taskControlView(accepted, { ...advanced, status: "completed" }).pending).toBe(false);
  });

  test("an unconfirmed response only permits the same action with its original request and checkpoint", () => {
    const started = beginTaskControl({}, proposal, "approve", () => "synthetic-approval-3")!;
    const uncertain = settleTaskControl(started.requests, started.request, "uncertain", "Network interrupted.");
    const retryView = taskControlView(uncertain, proposal);
    expect(retryView.pending).toBe(false);
    expect(retryView.task?.allowedActions).toEqual(["approve"]);
    expect(retryView.error).toBe("Network interrupted.");
    expect(beginTaskControl(uncertain, proposal, "deny", () => "must-not-send")).toBeUndefined();
    const retry = beginTaskControl(uncertain, proposal, "approve", () => "must-not-replace-id")!;
    expect(retry.request.requestId).toBe(started.request.requestId);
    expect(retry.request.checkpointId).toBe(proposal.checkpointId);
    expect(retry.request.action).toBe("approve");
    expect(taskControlView(retry.requests, proposal).pending).toBe(true);
  });

  test("a stop point travels with Play only and a retry keeps the original one", () => {
    const gate: AssistantTask = {
      ...proposal,
      kind: "meeting_prep",
      mode: "rehearsal",
      status: "paused",
      checkpointId: "step_synthetic_read_gate",
      allowedActions: ["advance", "play", "cancel"],
      demo: { stage: "read", waitingForStep: true, playback: "step" },
    };
    const started = beginTaskControl({}, gate, "play", () => "synthetic-play-1", "prepare")!;
    expect(started.request.stopAt).toBe("prepare");
    const uncertain = settleTaskControl(started.requests, started.request, "uncertain", "Network interrupted.");
    const retry = beginTaskControl(uncertain, gate, "play", () => "must-not-replace-id", "review")!;
    expect(retry.request).toMatchObject({ requestId: "synthetic-play-1", stopAt: "prepare" });
    expect(beginTaskControl({}, gate, "advance", () => "synthetic-advance-1", "prepare")!.request.stopAt)
      .toBeUndefined();
  });

  test("synchronous registration prevents two requests before a pending render", () => {
    const started = beginTaskControl({}, proposal, "deny", () => "synthetic-decline-1")!;
    expect(beginTaskControl(started.requests, proposal, "deny", () => "duplicate")).toBeUndefined();
    expect(beginTaskControl(started.requests, proposal, "approve", () => "opposite")).toBeUndefined();
  });

  test("a stop stays pending across intermediate checkpoints until the server reports a terminal state", () => {
    const started = beginTaskControl({}, proposal, "cancel", () => "synthetic-stop-1")!;
    const accepted = settleTaskControl(started.requests, started.request, "accepted");
    const intermediate: AssistantTask = {
      ...proposal, checkpointId: "step_synthetic_later", status: "running", allowedActions: [],
    };
    expect(taskControlView(accepted, intermediate).pending).toBe(true);
    expect(taskControlView(accepted, intermediate).notice).toContain("Stop request accepted");
    expect(taskControlView(accepted, { ...intermediate, status: "cancelled" }).pending).toBe(false);
    expect(taskControlView(accepted, { ...intermediate, status: "completed" }).pending).toBe(false);
  });

  test("a decision on another run never disables the selected task", () => {
    const started = beginTaskControl({}, proposal, "approve", () => "synthetic-approval-4")!;
    const accepted = settleTaskControl(started.requests, started.request, "accepted");
    const other = { ...proposal, runId: "wrun_synthetic_other_proposal" };
    expect(taskControlView(accepted, other).pending).toBe(false);
    expect(taskControlView(accepted, other).task?.allowedActions).toEqual(proposal.allowedActions);
  });
});
