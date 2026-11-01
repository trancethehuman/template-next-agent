import { syntheticMeeting } from "./task-policy";
import type {
  AssistantDemoStage,
  AssistantPreference,
  TaskSource,
} from "./types";

export const demonstrationStageLabels: Record<AssistantDemoStage, string> = {
  read: "Read context",
  prepare: "Prepare brief",
  review: "Review delivery",
  deliver: "Deliver to inbox",
  watch: "Wait for a trigger",
  complete: "Finish run",
};

export interface RehearsalContext {
  key: string;
  meeting: ReturnType<typeof syntheticMeeting>;
  sources: TaskSource[];
}

export function rehearsalContext(version: 1 | 2): RehearsalContext {
  const meeting = syntheticMeeting(version);
  return {
    key: `${meeting.id}:${version}`,
    meeting,
    sources: [
      { id: meeting.id, title: meeting.title, version: String(version) },
      {
        id: "synthetic-project-notes",
        title: "Fictional project notes",
        version: "1",
      },
    ],
  };
}

export function rehearsalBrief(
  context: RehearsalContext,
  preference: AssistantPreference,
): string {
  const { meeting } = context;
  const points = [
    `**${meeting.title}** — ${meeting.start} (${meeting.timeZone}). ${meeting.agenda}`,
    `**Context:** ${meeting.notes}`,
    "**Prepare:** Bring the proposed navigation, an onboarding walkthrough, and the open launch decisions.",
    ...(preference.bulletCount === 5
      ? [
          "**Question:** Which onboarding step is most likely to block a first-time user?",
          "**Next step:** Record an owner and due date for each agreed launch action.",
        ]
      : []),
  ];
  return `${points.map((point) => `- ${point}`).join("\n")}\n\n${preference.includeLinks ? "Sources: synthetic calendar record `synthetic-design-review`; fictional project notes `synthetic-project-notes`. These are rehearsal fixtures." : "Based on fictional rehearsal fixtures."}`;
}
