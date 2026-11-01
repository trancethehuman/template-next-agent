import type { CalendarEvent } from "./calendar";
import type { CalendarCallout, NextCheck } from "./calendar-callouts";
import type { CalendarEventDraft } from "./calendar-event-schema";
import type { AssistantActor } from "@/lib/auth/actor";
import type { AssistantModelId } from "./models";

export type AssistantMode = "rehearsal" | "calendar";
export type AssistantTaskKind = "meeting_prep" | "calendar_event" | "calendar_watch";
export type TaskStatus =
  | "queued"
  | "running"
  | "sleeping"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "cancelled"
  | "failed";

export interface AssistantPreference {
  bulletCount: 3 | 5;
  includeLinks: boolean;
}

export type AssistantDemoStage =
  | "read"
  | "prepare"
  | "review"
  | "deliver"
  | "watch"
  | "complete";
export type TaskRestartPhase = AssistantDemoStage | "calendar_review";
/** Stages a guided demo's playback can pause before. */
export type AssistantDemoStop = Exclude<AssistantDemoStage, "complete">;
export const assistantDemoStops = [
  "read",
  "prepare",
  "review",
  "deliver",
  "watch",
] as const satisfies readonly AssistantDemoStop[];

export interface TaskRestartState {
  version: 1;
  sourceRunId: string;
  sourceEventId: string;
  sourceTitle: string;
  phase: TaskRestartPhase;
  sourceVersion: 1 | 2;
  previousKey: string;
  prepared?: { content: string; sources: TaskSource[]; key: string };
  calendarWriteActionId?: string;
}

export interface AssistantTaskInput {
  owner?: AssistantActor;
  taskId: string;
  title: string;
  prompt: string;
  mode: AssistantMode;
  delaySeconds: number;
  manualStart: boolean;
  approvalRequired: boolean;
  sourceVersion: 1 | 2;
  maxChecks: number;
  preference: AssistantPreference;
  calendarEventId?: string;
  timeMin?: string;
  timeMax?: string;
  kind?: AssistantTaskKind;
  /** The model that writes live briefs. Only allow-listed IDs reach a task. */
  model?: AssistantModelId;
  eventDraft?: CalendarEventDraft;
  demoMode?: boolean;
  /** Server-reconstructed restart state; never accepted from create-task JSON. */
  restart?: TaskRestartState;
}

export interface TaskSource {
  id: string;
  title: string;
  url?: string;
  version: string;
}

export interface TaskEvent {
  id: string;
  occurredAt: string;
  type:
    | "status"
    | "source"
    | "brief"
    | "notification"
    | "deduplicated"
    | "approval"
    | "calendar_event"
    | "restart"
    | "notice"
    | "error";
  status?: TaskStatus;
  title: string;
  detail: string;
  content?: string;
  sources?: TaskSource[];
  /** Full server-side comparison key for safe checkpoint restoration. */
  sourceKey?: string;
  input?: AssistantTaskInput;
  calendarEvent?: CalendarEvent & { managed: true; reused: boolean };
  calendarDecision?: "approved" | "denied" | "cancelled";
  demoStage?: AssistantDemoStage;
  demoGate?: boolean;
  demoPlayback?: "step" | "play";
  /** While playing, the stage this playback pauses before. */
  demoStopAt?: AssistantDemoStop;
  /** A calendar watch: how much of the calendar one check read. */
  scan?: { events: number; days: number; timeZone: string };
  /** A calendar watch: everything flagged at this check, and which is new. */
  callouts?: Array<CalendarCallout & { fresh: boolean }>;
  /** A calendar watch: the check it scheduled for itself. */
  nextCheck?: NextCheck;
}

export type TaskAction =
  | "start"
  | "wake"
  | "pause"
  | "resume"
  | "approve"
  | "deny"
  | "cancel"
  | "replay"
  | "update-source"
  | "finish"
  | "advance"
  | "play";

export interface TaskControl {
  action: TaskAction;
  requestId: string;
  checkpointId: string;
  /** Play only: pause before this stage instead of at the next owner decision. */
  stopAt?: AssistantDemoStop;
}

export interface AssistantTask {
  runId: string;
  title: string;
  prompt: string;
  mode: AssistantMode;
  status: TaskStatus;
  workflowStatus: string;
  createdAt: string;
  updatedAt: string;
  events: TaskEvent[];
  brief?: string;
  error?: string;
  notificationCount: number;
  sourceVersion: number;
  preference: AssistantPreference;
  allowedActions: TaskAction[];
  checkpointId?: string;
  kind: AssistantTaskKind;
  eventDraft?: CalendarEventDraft;
  calendarEvent?: CalendarEvent & { managed: true; reused: boolean };
  restart?: TaskRestartState;
  briefReused?: boolean;
  demo?: {
    stage: AssistantDemoStage;
    waitingForStep: boolean;
    playback: "step" | "play";
    stopAt?: AssistantDemoStop;
  };
}
