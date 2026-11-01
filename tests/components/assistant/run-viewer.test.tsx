import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunViewer } from "@/components/assistant/run-viewer";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AssistantTask, TaskEvent } from "@/lib/assistant/types";

const input = {
  taskId: "synthetic-run-viewer",
  title: "Synthetic run viewer",
  prompt: "Fictional teaching run",
  mode: "rehearsal" as const,
  kind: "meeting_prep" as const,
  demoMode: true,
  delaySeconds: 0,
  manualStart: false,
  approvalRequired: true,
  sourceVersion: 1 as const,
  maxChecks: 3,
  preference: { bulletCount: 3 as const, includeLinks: true },
};

const events: TaskEvent[] = [
  { id: "ready", type: "status", status: "running", input, title: "Classroom demo ready", detail: "Fictional meeting.", occurredAt: "2026-10-30T10:00:01Z" },
  { id: "read", type: "source", demoStage: "read", title: "Read rehearsal fixtures", detail: "Read two fictional source records.", occurredAt: "2026-10-30T10:00:02Z", sources: [{ id: "synthetic-design-review", title: "Product design review", version: "1" }] },
  { id: "brief", type: "brief", demoStage: "prepare", title: "Meeting brief prepared", detail: "Deterministic template.", content: "- Synthetic brief bullet", occurredAt: "2026-10-30T10:00:03Z" },
  { id: "await", type: "status", status: "awaiting_approval", demoStage: "review", title: "Review before delivery", detail: "Publish this exact brief?", occurredAt: "2026-10-30T10:00:04Z" },
];

function task(fields: Partial<AssistantTask> = {}): AssistantTask {
  return {
    runId: "wrun_synthetic_viewer",
    title: "Classroom walkthrough",
    prompt: "Fictional teaching run",
    mode: "rehearsal",
    kind: "meeting_prep",
    status: "awaiting_approval",
    workflowStatus: "running",
    createdAt: "2026-10-30T10:00:00Z",
    updatedAt: "2026-10-30T10:00:04Z",
    events,
    brief: "- Synthetic brief bullet",
    notificationCount: 0,
    sourceVersion: 1,
    preference: { bulletCount: 3, includeLinks: true },
    allowedActions: ["approve", "deny", "cancel"],
    checkpointId: "await",
    demo: { stage: "review", waitingForStep: false, playback: "step" },
    ...fields,
  };
}

function render(value: AssistantTask, offline = false) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <RunViewer
        task={value}
        active={false}
        loading={false}
        onRetry={() => {}}
        onAction={() => {
          throw new Error("Rendering cannot send an action");
        }}
        onRestart={() => {}}
        pending={false}
        offline={offline}
        onOfflineChange={() => {}}
      />
    </TooltipProvider>,
  );
}

describe("live run viewer", () => {
  test("an approval wait shows the loop, the teaching note, and an explicit decision", () => {
    const html = render(task());
    expect(html).toContain('aria-label="Agent loop stages"');
    expect(html).toContain("4. Review: Your turn");
    expect(html).toContain("Approval boundary.");
    expect(html).toContain("The agent can’t approve its own work.");
    expect(html).toContain("Publish this exact brief?");
    expect(html).toContain("Approve delivery");
    expect(html).toContain("Decline");
    expect(html).toContain("Waiting for your decision");
    expect(html).toContain("Disconnect viewer");
    expect(html).toContain("Waiting for approval</h3>");
    expect(html).not.toContain('aria-label="Recorded steps"');
    // Controls the server doesn't offer right now are hidden, not shown disabled.
    expect(html).not.toContain("Next step");
    expect(html).toContain("Stop");
  });

  test("a guided gate keeps its controls in the transport bar only", () => {
    const gate: TaskEvent = {
      id: "gate",
      type: "status",
      status: "paused",
      demoStage: "deliver",
      demoGate: true,
      title: "Ready to deliver to inbox",
      detail: "Run next step executes this stage.",
      occurredAt: "2026-10-30T10:00:05Z",
    };
    const html = render(
      task({
        status: "paused",
        allowedActions: ["advance", "play", "cancel"],
        demo: { stage: "deliver", waitingForStep: true, playback: "step" },
        events: [...events.slice(0, 3), gate],
      }),
    );
    expect(html).not.toContain('aria-label="Your move"');
    expect(html.match(/Next step<\/button>/g)).toHaveLength(1);
    expect(html).toContain("Paused · press Next step to continue");
    // The gate's recorded detail repeats the status line.
    expect(html).not.toContain("Run next step executes this stage.");
  });

  test("history stays folded away until asked for", () => {
    const html = render(task());
    expect(html).toContain("Show all steps and memory");
    expect(html).not.toContain('aria-label="Recorded workflow steps"');
  });

  test("an asleep run offers Check now once, in the controls", () => {
    const html = render(
      task({
        status: "sleeping",
        allowedActions: ["pause", "wake", "replay", "update-source", "finish", "cancel"],
        demo: undefined,
        events: [
          ...events,
          { id: "sleep", type: "status", status: "sleeping", title: "Waiting for the next check", detail: "Asleep.", occurredAt: "2026-10-30T10:00:05Z" },
        ],
      }),
    );
    expect(html.match(/Check now/g)).toHaveLength(1);
    expect(html).toContain("Replay the same event");
  });

  test("a disconnected viewer disables every control and says the server keeps working", () => {
    const html = render(task(), true);
    expect(html).toContain("Disconnected · the run keeps going on the server");
    expect(html).toContain("Reconnect");
    expect(html).not.toContain("Your move");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Stop<\/button>/);
  });

  test("an ended run offers a fresh run instead of playback", () => {
    const html = render(
      task({
        status: "completed",
        workflowStatus: "completed",
        allowedActions: [],
        demo: undefined,
        events: [
          ...events,
          { id: "deny", type: "approval", demoStage: "review", title: "Delivery declined", detail: "No notification was delivered.", occurredAt: "2026-10-30T10:00:05Z" },
          { id: "done", type: "status", status: "completed", demoStage: "complete", title: "Proposal declined", detail: "Ended.", occurredAt: "2026-10-30T10:00:06Z" },
        ],
      }),
    );
    expect(html).toContain("Finished");
    expect(html).toContain("Run it again");
    expect(html).toContain("Ended after a decline");
    // A completed run has nothing to retry from its last step, only from a stage.
    expect(html).not.toContain('aria-label="Start from here: Proposal declined"');
    expect(html).toContain('aria-label="Start from here: Read"');
  });

  test("a stopped run can start again from its last recorded step", () => {
    const html = render(task({ status: "cancelled", workflowStatus: "cancelled", allowedActions: [], demo: undefined }));
    expect(html).toContain("Run it again");
    expect(html).toMatch(/aria-label="Start from here: [^"]+"/);
  });

  test("a fresh demo shows the request, how to begin, and where Play can stop", () => {
    const gate: TaskEvent = {
      id: "gate-read",
      type: "status",
      status: "paused",
      demoStage: "read",
      demoGate: true,
      title: "Ready to read context",
      detail: "Run next step executes this stage.",
      occurredAt: "2026-10-30T10:00:02Z",
    };
    const html = render(
      task({
        prompt: "Prepare me for tomorrow’s product design review.",
        status: "paused",
        allowedActions: ["advance", "play", "cancel"],
        demo: { stage: "read", waitingForStep: true, playback: "step" },
        events: [events[0], gate],
        brief: undefined,
      }),
    );
    expect(html).toContain("Prepare me for tomorrow’s product design review.");
    expect(html).toContain("The request is in.");
    expect(html).toContain('aria-label="Play to here: Prepare"');
    expect(html).toContain('aria-label="Play to here: Review"');
    expect(html).not.toContain('aria-label="Play to here: Deliver"');
    // Nothing has run yet, so there is no earlier stage to start from except the beginning.
    expect(html).not.toContain('aria-label="Start from here: Read"');
  });

  test("while playing to a stage, the diagram marks where playback pauses", () => {
    const gate: TaskEvent = {
      id: "gate-read",
      type: "status",
      status: "running",
      demoStage: "read",
      demoGate: true,
      demoPlayback: "play",
      demoStopAt: "prepare",
      title: "Ready to read context",
      detail: "Demo playback advances this stage after one durable second.",
      occurredAt: "2026-10-30T10:00:02Z",
    };
    const html = render(
      task({
        status: "running",
        allowedActions: ["pause", "cancel"],
        demo: { stage: "read", waitingForStep: true, playback: "play", stopAt: "prepare" },
        events: [events[0], gate],
        brief: undefined,
      }),
    );
    expect(html).toContain("Playing · pauses before Prepare");
    expect(html).toContain("Playback pauses here");
  });
});

describe("calendar watch in the run viewer", () => {
  const watchInput = { ...input, taskId: "synthetic-watch", mode: "calendar" as const, kind: "calendar_watch" as const, demoMode: false, approvalRequired: false, maxChecks: 5 };
  const nextCheck = { at: "2026-10-30T14:45:00.000Z", label: "9:45 AM", reason: "15 minutes before “Fictional review”", cron: "45 9 30 10 *" };
  const watchEvents: TaskEvent[] = [
    { id: "w-start", type: "status", status: "running", input: watchInput, title: "Watching your calendar", detail: "Read-only.", occurredAt: "2026-10-30T10:00:01Z" },
    { id: "w-read", type: "source", sources: [], scan: { events: 9, days: 7, timeZone: "America/Toronto" }, title: "Read your calendar", detail: "Read 9 events in the next 7 days.", occurredAt: "2026-10-30T10:00:02Z" },
    { id: "w-notice", type: "notice", title: "Found 1 thing to flag", detail: "Clashes and changes.", callouts: [{ key: "conflict:a:b", kind: "conflict", text: "“Fictional review” overlaps “Fictional 1:1”", when: "Fri, Oct 30, 10:30–11:00 AM", start: "2026-10-30T14:30:00.000Z", fresh: true }], occurredAt: "2026-10-30T10:00:03Z" },
    { id: "w-message", type: "notification", title: "Messaged you", detail: "Only you got this.", content: "1 thing on your calendar needs a look:", occurredAt: "2026-10-30T10:00:04Z" },
    { id: "w-sleep", type: "status", status: "sleeping", title: "Next check: 9:45 AM", detail: "It picked this time itself.", nextCheck, occurredAt: "2026-10-30T10:00:05Z" },
  ];
  const watchTask = (fields: Partial<AssistantTask> = {}) =>
    task({ title: "Watch my calendar", mode: "calendar", kind: "calendar_watch", status: "sleeping", demo: undefined, brief: undefined, events: watchEvents, notificationCount: 1, allowedActions: ["wake", "pause", "finish", "cancel"], checkpointId: "w-sleep", ...fields });

  test("an asleep watch names the time it picked, with Check now, and no replay", () => {
    const html = render(watchTask());
    expect(html).toContain("Your Google Calendar · read-only");
    expect(html).toContain("Asleep until 9:45 AM");
    expect(html).toContain("cron 45 9 30 10 *");
    expect(html).toContain("Check now");
    expect(html).not.toContain("Replay the same event");
    expect(html).not.toContain("Finish monitoring");
    expect(html).toContain("Message");
  });

  test("its notice lists what it flagged, and its message is shown as one to you", () => {
    const notice = render(watchTask({ events: watchEvents.slice(0, 3), status: "running", allowedActions: ["cancel"], checkpointId: "w-start" }));
    expect(notice).toContain('aria-label="What it flagged"');
    expect(notice).toContain("“Fictional review” overlaps “Fictional 1:1”");
    const message = render(watchTask({ events: watchEvents.slice(0, 4), status: "running", allowedActions: ["cancel"], checkpointId: "w-start" }));
    expect(message).toContain('aria-label="Message to you"');
    expect(message).toContain("From your assistant");
  });
});
