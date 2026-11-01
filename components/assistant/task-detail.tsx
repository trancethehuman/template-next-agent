import type { AssistantTask, TaskStatus } from "@/lib/assistant/types";
import { eventBoundaryLabel } from "@/lib/assistant/presentation";

export const statusLabels: Record<TaskStatus, string> = {
  queued: "Ready to start",
  running: "Working",
  sleeping: "Waiting for trigger",
  paused: "Paused",
  awaiting_approval: "Needs your decision",
  completed: "Complete",
  cancelled: "Stopped",
  failed: "Failed",
};

export function taskStatusLabel(task: AssistantTask): string {
  if (task.demo?.waitingForStep) {
    if (task.demo.playback === "play" && (task.status === "paused" || task.status === "running"))
      return "Playing";
    if (task.status === "paused") return "Ready for next step";
  }
  return statusLabels[task.status];
}

export function CalendarDraft({ task }: { task: AssistantTask }) {
  if (!task.eventDraft) return null;
  return (
    <section
      className="flex flex-col gap-4 border-l-2 border-primary/20 pl-4"
      aria-label="Exact calendar event draft"
    >
      <h3 className="text-sm font-semibold">
        {task.calendarEvent
          ? "Recorded calendar event"
          : "Proposed calendar event"}
      </h3>
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Title</dt>
          <dd className="mt-1 font-medium break-words">
            {task.eventDraft.summary}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Starts</dt>
          <dd className="mt-1">
            {eventBoundaryLabel(
              task.eventDraft.start,
              task.eventDraft.timeZone,
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Ends</dt>
          <dd className="mt-1">
            {eventBoundaryLabel(task.eventDraft.end, task.eventDraft.timeZone)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Time zone</dt>
          <dd className="mt-1">{task.eventDraft.timeZone}</dd>
        </div>
        {task.eventDraft.description && (
          <div>
            <dt className="text-xs text-muted-foreground">Notes</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words">
              {task.eventDraft.description}
            </dd>
          </div>
        )}
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">
        A private event on the configured primary calendar. No attendees,
        invites, or reminders.
      </p>
      {task.calendarEvent?.htmlUrl && (
        <a
          className="text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          href={task.calendarEvent.htmlUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open the created Google Calendar event
        </a>
      )}
    </section>
  );
}
