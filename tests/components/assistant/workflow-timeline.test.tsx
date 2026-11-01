import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowTimeline } from "@/components/assistant/workflow-timeline";
import type { AssistantTask } from "@/lib/assistant/types";

function task(overrides: Partial<AssistantTask> = {}): AssistantTask {
  return {
    runId: "wrun_synthetic_timeline",
    title: "Synthetic timeline",
    prompt: "Inspect a fictional checkpoint.",
    mode: "rehearsal",
    kind: "meeting_prep",
    status: "queued",
    workflowStatus: "running",
    createdAt: "2026-10-30T18:00:00Z",
    updatedAt: "2026-10-30T18:00:00Z",
    events: [],
    allowedActions: ["start", "cancel"],
    notificationCount: 0,
    sourceVersion: 1,
    preference: { bulletCount: 3, includeLinks: true },
    ...overrides,
  };
}

describe("workflow timeline", () => {
  test("preserves provider evidence on result steps without calling it a new source read", () => {
    const html = renderToStaticMarkup(
      <WorkflowTimeline
        task={task({
          status: "completed",
          events: [
            {
              id: "synthetic_provider_result",
              occurredAt: "2026-10-30T18:00:01Z",
              type: "calendar_event",
              title: "Fictional provider confirmation",
              detail: "Synthetic result retained for inspection.",
              sources: [
                {
                  id: "synthetic_source",
                  title: "Synthetic event",
                  url: "https://example.test/synthetic-event",
                  version: "created",
                },
              ],
            },
          ],
        })}
      />,
    );
    expect(html).toContain('href="https://example.test/synthetic-event"');
    expect(html).toContain("Provider confirmation");
    expect(html).toContain("Fictional provider confirmation");
    expect(html).not.toContain("First read");
    expect(html).toContain('aria-label="Step 1: Result recorded"');
  });

  test("shows an empty trace truthfully and keeps the compact card to status and a link", () => {
    const empty = renderToStaticMarkup(<WorkflowTimeline task={task()} />);
    expect(empty).toContain("No recorded steps yet");
    expect(empty).not.toContain("Next recorded step");
    const compact = renderToStaticMarkup(
      <WorkflowTimeline
        compact
        onOpenDetails={() => {}}
        task={task({
          events: Array.from({ length: 6 }, (_, index) => ({
            id: `synthetic_${index}`,
            occurredAt: `2026-10-30T18:00:0${index}Z`,
            type: "source" as const,
            title: `Synthetic source read ${index + 1}`,
            detail: "Fictional source checkpoint.",
            sources: [],
          })),
        })}
      />,
    );
    expect(compact).toContain('aria-label="Agent loop stages"');
    expect(compact).not.toContain('aria-label="Recorded workflow steps"');
    expect(compact).toContain("View full flow");
  });
});
