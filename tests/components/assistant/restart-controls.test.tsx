import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowTimeline, shouldScrollWorkflowStep } from "@/components/assistant/workflow-timeline";
import { taskStatusLabel } from "@/components/assistant/task-detail";
import {
  beginTaskRestart,
  settleTaskRestart,
  taskRestartNotice,
} from "@/lib/assistant/restart-controls";
import type { AssistantTask } from "@/lib/assistant/types";
import { taskExecutionSettings } from "@/lib/assistant/task-form";

describe("real workflow restart controls", () => {
  test("registers synchronously so a double click cannot create two forks", () => {
    let allocated = 0;
    const first = beginTaskRestart({}, "wrun_synthetic_source", "synthetic_read", () => `request_${++allocated}`)!;
    expect(beginTaskRestart(first.requests, "wrun_synthetic_source", "synthetic_read", () => `request_${++allocated}`)).toBeUndefined();
    expect(beginTaskRestart(first.requests, "wrun_synthetic_source", "synthetic_prepare", () => `request_${++allocated}`)).toBeUndefined();
    expect(allocated).toBe(1);
  });

  test("a lost response retries the exact source, step and request ID across reopening", () => {
    const first = beginTaskRestart({}, "wrun_synthetic_source", "synthetic_read", () => "synthetic_request_1")!;
    const uncertain = settleTaskRestart(first.requests, first.request, { phase: "uncertain", error: "Synthetic response lost" });
    expect(beginTaskRestart(uncertain, "wrun_synthetic_source", "beginning", () => "must-not-allocate")).toBeUndefined();
    const retried = beginTaskRestart(uncertain, "wrun_synthetic_source", "synthetic_read", () => "must-not-allocate")!;
    expect(retried.request).toMatchObject({ sourceRunId: first.request.sourceRunId, eventId: first.request.eventId, requestId: first.request.requestId, phase: "submitting" });
    expect(retried.request.error).toBeUndefined();
  });

  test("reset uses the reserved beginning sentinel, independently of a fork's first recorded event", () => {
    const reset = beginTaskRestart({}, "wrun_synthetic_fork_at_prepare", "beginning", () => "synthetic_reset_1")!;
    expect(reset.request.eventId).toBe("beginning");
    const accepted = settleTaskRestart(reset.requests, reset.request, { phase: "accepted", result: { runId: "wrun_synthetic_new", parentStopped: true } });
    const repeated = beginTaskRestart(accepted, "wrun_synthetic_fork_at_prepare", "beginning", () => "synthetic_reset_2")!;
    expect(repeated.request.requestId).toBe("synthetic_reset_2");
  });

  test("late responses do not overwrite a newer restart, and another source stays independent", () => {
    const first = beginTaskRestart({}, "wrun_synthetic_source", "synthetic_read", () => "synthetic_request_1")!;
    const accepted = settleTaskRestart(first.requests, first.request, { phase: "accepted", result: { runId: "wrun_synthetic_child", parentStopped: true } });
    const newer = beginTaskRestart(accepted, "wrun_synthetic_source", "synthetic_prepare", () => "synthetic_request_2")!;
    expect(settleTaskRestart(newer.requests, first.request, { phase: "uncertain", error: "Stale response" })).toEqual(newer.requests);
    const other = beginTaskRestart(newer.requests, "wrun_other_synthetic_source", "run-status:wrun_other_synthetic_source:cancelled", () => "synthetic_request_3")!;
    expect(other.requests.wrun_synthetic_source).toEqual(newer.request);
  });

  test("receipts distinguish stopping a synthetic parent from preserving a live parent", () => {
    expect(taskRestartNotice({ runId: "wrun_synthetic_child", parentStopped: true })).toContain("original run stopped");
    expect(taskRestartNotice({ runId: "wrun_synthetic_child", parentStopped: false })).toContain("may still be running");
    expect(taskRestartNotice({ runId: "wrun_synthetic_child", parentStopped: false, notice: "Fresh owner approval required." })).toBe("Fresh owner approval required.");
  });

  const task: AssistantTask = {
    runId: "wrun_synthetic_ui_source", title: "Synthetic walkthrough", prompt: "Fictional preparation",
    mode: "rehearsal", kind: "meeting_prep", status: "completed", workflowStatus: "completed",
    createdAt: "2026-10-30T14:00:00Z", updatedAt: "2026-10-30T14:00:02Z",
    notificationCount: 0, sourceVersion: 1, preference: { bulletCount: 3, includeLinks: true }, allowedActions: [],
    events: [
      { id: "synthetic_read", type: "source", title: "Context read", detail: "Fictional source", occurredAt: "2026-10-30T14:00:00Z", sources: [{ id: "synthetic_source", title: "Fictional meeting", version: "v1" }] },
      { id: "synthetic_brief", type: "brief", title: "Brief prepared", detail: "Fictional brief", content: "Synthetic selected output", occurredAt: "2026-10-30T14:00:01Z" },
    ],
  };

  test("inspecting a checkpoint offers restart without changing the recorded history", () => {
    const original = JSON.stringify(task);
    const html = renderToStaticMarkup(<WorkflowTimeline task={task} initialStepId="synthetic_brief" onRestart={() => { throw new Error("Rendering cannot execute a restart"); }} />);
    expect(html).toContain("Step 2 of 3");
    expect(html).toContain("Fictional brief");
    expect(html).toContain("Restart here: Brief ready");
    expect(JSON.stringify(task)).toBe(original);
  });

  test("canonical terminal rows can restart, and an in-flight fork disables the action", () => {
    const html = renderToStaticMarkup(<WorkflowTimeline task={{ ...task, events: [], status: "failed", workflowStatus: "failed" }} onRestart={() => {}} restartDisabled />);
    expect(html).toContain("Restart here: Failed");
    expect(html).toContain("disabled");
  });

  test("manual gates and paced playback have distinct labels from an explicit pause", () => {
    const demo = { stage: "prepare" as const, waitingForStep: true, playback: "step" as const };
    expect(taskStatusLabel({ ...task, status: "paused", demo })).toBe("Ready for next step");
    expect(taskStatusLabel({ ...task, status: "paused", demo: { ...demo, playback: "play" } })).toBe("Playing");
    expect(taskStatusLabel({ ...task, status: "paused", demo: { ...demo, waitingForStep: false } })).toBe("Paused");
    expect(taskStatusLabel({ ...task, status: "running", demo: { ...demo, playback: "play" } })).toBe("Playing");
    expect(taskStatusLabel({ ...task, status: "running", demo: { ...demo, playback: "play", waitingForStep: false } })).toBe("Working");
    expect(taskStatusLabel({ ...task, status: "awaiting_approval", demo: { ...demo, playback: "play" } })).toBe("Needs your decision");
  });

  test("guided form payload ignores invalid hidden delay and incompatible manual/approval values", () => {
    for (const delay of ["not-a-number", "900000", "-10"])
      expect(taskExecutionSettings("rehearsal", true, { delay, manualStart: true, approvalRequired: false }))
        .toEqual({ delaySeconds: 0, manualStart: false, approvalRequired: true });
  });

  test("automatic and live form modes keep their visible execution settings", () => {
    const settings = { delay: "60", manualStart: true, approvalRequired: false };
    const expected = { delaySeconds: 60, manualStart: true, approvalRequired: false };
    expect(taskExecutionSettings("rehearsal", false, settings)).toEqual(expected);
    expect(taskExecutionSettings("calendar", true, settings)).toEqual(expected);
  });

  test("guided follow scrolls only after the first observed step, while Calendar first load stays put", () => {
    const base = { compact: false, inspected: false, followGuided: true };
    expect(shouldScrollWorkflowStep({ ...base, selectedId: "first" })).toBe(false);
    expect(shouldScrollWorkflowStep({ ...base, previousId: "first", selectedId: "first" })).toBe(false);
    expect(shouldScrollWorkflowStep({ ...base, previousId: "first", selectedId: "second" })).toBe(true);
    expect(shouldScrollWorkflowStep({ ...base, previousId: "first", selectedId: "second", followGuided: false })).toBe(false);
    expect(shouldScrollWorkflowStep({ ...base, previousId: "first", selectedId: "second", compact: true })).toBe(false);
    expect(shouldScrollWorkflowStep({ ...base, previousId: "first", selectedId: "chosen", followGuided: false, inspected: true })).toBe(true);
  });
});
