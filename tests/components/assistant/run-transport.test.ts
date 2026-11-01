import { describe, expect, test } from "bun:test";
import {
  runShortcut,
  runTransport,
  shortcutTargetAllowed,
} from "../../../lib/assistant/run-transport";
import type { AssistantTask } from "../../../lib/assistant/types";

function task(fields: Partial<AssistantTask>): AssistantTask {
  return {
    runId: "wrun_synthetic_transport",
    title: "Synthetic transport",
    prompt: "Fictional controls",
    mode: "rehearsal",
    kind: "meeting_prep",
    status: "paused",
    workflowStatus: "running",
    createdAt: "2026-10-30T10:00:00.000Z",
    updatedAt: "2026-10-30T10:00:01.000Z",
    events: [],
    notificationCount: 0,
    sourceVersion: 1,
    preference: { bulletCount: 3, includeLinks: true },
    allowedActions: [],
    ...fields,
  };
}

function target(selector: string | undefined) {
  return {
    closest: (query: string) =>
      selector && query.split(",").some((part) => part.trim() === selector) ? {} : null,
  } as unknown as EventTarget;
}

describe("run transport", () => {
  test("a guided gate offers play, next step, and stop from the server's allowed actions", () => {
    const transport = runTransport(
      task({
        allowedActions: ["advance", "play", "cancel"],
        demo: { stage: "read", waitingForStep: true, playback: "step" },
      }),
    );
    expect(transport.toggle).toEqual({ action: "play", kind: "play", label: "Play" });
    expect(transport.next).toEqual({ action: "advance", label: "Next step" });
    expect(transport.stop?.action).toBe("cancel");
    expect(transport.live.tone).toBe("waiting");
  });

  test("playback turns the toggle into pause and reports live work", () => {
    const transport = runTransport(
      task({
        status: "running",
        allowedActions: ["pause", "cancel"],
        demo: { stage: "prepare", waitingForStep: true, playback: "play" },
      }),
    );
    expect(transport.toggle).toMatchObject({ action: "pause", kind: "pause", label: "Pause" });
    expect(transport.next).toBeUndefined();
    expect(transport.live).toMatchObject({ tone: "live" });
    expect(
      runTransport(
        task({
          status: "running",
          allowedActions: ["pause", "cancel"],
          demo: { stage: "read", waitingForStep: true, playback: "play", stopAt: "prepare" },
        }),
      ).live.label,
    ).toBe("Playing · pauses before Prepare");
  });

  test("monitoring maps pause and wake onto the same controls", () => {
    const transport = runTransport(
      task({
        status: "sleeping",
        allowedActions: ["wake", "pause", "replay", "update-source", "finish", "cancel"],
      }),
    );
    expect(transport.toggle).toMatchObject({ action: "pause", label: "Pause monitoring" });
    expect(transport.next).toEqual({ action: "wake", label: "Check now" });
    expect(transport.live.label).toBe("Asleep · waiting for a trigger");
  });

  test("an approval wait offers no play or next step; the decision stays explicit", () => {
    const transport = runTransport(
      task({ status: "awaiting_approval", allowedActions: ["approve", "deny", "cancel"] }),
    );
    expect(transport.toggle).toBeUndefined();
    expect(transport.next).toBeUndefined();
    expect(transport.stop?.action).toBe("cancel");
  });

  test("an ended run has no controls", () => {
    const transport = runTransport(task({ status: "completed" }));
    expect(transport).toMatchObject({ toggle: undefined, next: undefined, stop: undefined });
    expect(transport.live).toEqual({ label: "Finished", tone: "ended" });
  });

  test("presenter shortcuts ignore modified keys and text entry", () => {
    expect(runShortcut({ key: " " })).toBe("toggle");
    expect(runShortcut({ key: "N" })).toBe("next");
    expect(runShortcut({ key: "ArrowLeft" })).toBe("previous-step");
    expect(runShortcut({ key: "l" })).toBe("live");
    expect(runShortcut({ key: "n", metaKey: true })).toBeUndefined();
    expect(runShortcut({ key: "x" })).toBeUndefined();
    expect(shortcutTargetAllowed(target("textarea"), "n")).toBe(false);
    expect(shortcutTargetAllowed(target("[role='dialog']"), "n")).toBe(false);
    expect(shortcutTargetAllowed(target("button"), " ")).toBe(false);
    expect(shortcutTargetAllowed(target("button"), "n")).toBe(true);
    expect(shortcutTargetAllowed(target("[role='tablist']"), "ArrowRight")).toBe(false);
    expect(shortcutTargetAllowed(target(undefined), " ")).toBe(true);
  });
});
