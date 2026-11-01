import type {
  StageId,
  StageMapView,
  StageState,
  StageView,
} from "./stage-map";

/**
 * A scripted week in the life of an always-on agent. Everything here is
 * mocked: the people, email, calendar, and times are fictional, and nothing
 * is read or sent. It shows behaviour the guided run doesn't cover yet: a
 * schedule the agent sets itself, blind spots, and follow-ups on open loops.
 */

export type StoryStage = Extract<
  StageId,
  "start" | "read" | "notice" | "prepare" | "review" | "deliver" | "watch" | "finish"
>;
export type StoryDecision = "approved" | "declined";

export interface StoryPass {
  /** Simulated time the check starts. */
  at: string;
  trigger: "request" | "schedule" | "event";
  /** What started the check, in plain words. */
  label: string;
  text: string;
  /** Stages this check doesn't need, with the reason shown on them. */
  skips?: Partial<Record<StoryStage, string>>;
}

export interface StoryInsight {
  kind: "blind_spot" | "open_loop";
  title: string;
  status: "new" | "still_open" | "resolved";
}

export interface StoryCheck {
  at: string;
  /** The same time as a cron expression, for engineers. */
  cron: string;
  reason: string;
  change?: "new" | "moved" | "removed";
}

export interface StoryMessage {
  /** The other person: who sent it, or who a draft is for. */
  person: string;
  body: string;
}

interface StoryCopy {
  title: string;
  detail: string;
  /** Shown on the stage once this step has run. */
  fact: string;
}

export interface StoryStep extends StoryCopy {
  id: string;
  pass: number;
  stage: StoryStage;
  lesson?: { concept: string; text: string };
  sources?: string[];
  insights?: StoryInsight[];
  email?: StoryMessage;
  draft?: StoryMessage;
  brief?: string[];
  schedule?: StoryCheck[];
  decision?: { question: string; approve: string; decline: string };
  /** A step that reports a decision: its copy when the owner declined. */
  ifDeclined?: { decisionId: string } & StoryCopy;
  /** What a task agent, stopped after its first answer, would have missed. */
  missed?: string;
}

export const storyStages: {
  id: StoryStage;
  label: string;
  concept: string;
  summary: string;
}[] = [
  { id: "start", label: "Trigger", concept: "Trigger", summary: "Something starts a check" },
  { id: "read", label: "Read", concept: "Read-only tools", summary: "Calendar, notes and inbox" },
  { id: "notice", label: "Notice", concept: "Blind spots and open loops", summary: "Looks for what you didn’t ask" },
  { id: "prepare", label: "Prepare", concept: "Drafts, never sends", summary: "A brief and reply drafts" },
  { id: "review", label: "Review", concept: "Approval boundary", summary: "Waits for your OK" },
  { id: "deliver", label: "Deliver", concept: "One update", summary: "Sends only what you approved" },
  { id: "watch", label: "Schedule", concept: "Its own schedule", summary: "Plans its next check, then sleeps" },
  { id: "finish", label: "Finish", concept: "Stop condition", summary: "Ends when the goal is done" },
];

const quiet = "Nothing new, nothing sent";
const done = "Goal done";

export const storyPasses: StoryPass[] = [
  { at: "Mon 4:00 PM", trigger: "request", label: "Your request", text: "Prepare me for Thursday’s product design review." },
  { at: "Tue 9:00 AM", trigger: "schedule", label: "Woke itself", text: "Its own 9:00 AM check: did Sam reply?" },
  { at: "Tue 2:14 PM", trigger: "event", label: "New email", text: "Sam replied to “Launch checklist owner?”" },
  {
    at: "Wed 10:00 AM",
    trigger: "schedule",
    label: "Woke itself",
    text: "Its own reminder: the final copy is due to Sam at noon.",
    skips: { prepare: "Just a reminder to you", review: "Nothing to approve" },
  },
  { at: "Wed 6:00 PM", trigger: "schedule", label: "Woke itself", text: "Its own evening-before check of the meeting." },
  {
    at: "Thu 1:00 PM",
    trigger: "schedule",
    label: "Woke itself",
    text: "Its own last check, 1 hour before the review.",
    skips: { prepare: quiet, review: quiet, deliver: quiet },
  },
  {
    at: "Thu 3:00 PM",
    trigger: "schedule",
    label: "Woke itself",
    text: "The review has ended.",
    skips: { read: done, notice: done, prepare: done, review: done, deliver: done, watch: done },
  },
];

const approval = {
  concept: "Approval boundary",
  text: "It drafts, but it can’t send anything to another person without your OK. Saying no is a normal outcome.",
};

export const storySteps: StoryStep[] = [
  // Mon 4:00 PM: the only time anyone asks it anything.
  {
    id: "request",
    pass: 0,
    stage: "start",
    title: "Request received",
    detail: "You asked once. A task agent would answer and stop. This agent keeps the goal until the review is over.",
    fact: "Your request · Mon 4:00 PM",
    lesson: {
      concept: "Trigger",
      text: "A task agent starts only when you ask. This one starts with your request, then starts itself whenever its own schedule or a new email says so.",
    },
  },
  {
    id: "read-1",
    pass: 0,
    stage: "read",
    title: "Read calendar, notes and inbox",
    detail: "It looked at the review, the events around it, your project notes, and email about the launch.",
    fact: "5 sources",
    sources: [
      "Calendar · Product design review, Thu 10:00 AM",
      "Calendar · 1:1 with Alex, Thu 9:30–10:15 AM",
      "Notes · Launch decisions",
      "Email · “Launch checklist owner?” from you to Sam, Sat",
      "Email · “Accessibility audit timing” from Priya, Mon 11:20 AM",
    ],
    lesson: {
      concept: "Read-only tools",
      text: "It can look, not touch. Every source keeps a version, so the next check can tell what changed.",
    },
  },
  {
    id: "notice-1",
    pass: 0,
    stage: "notice",
    title: "Found 3 blind spots and 2 open loops",
    detail: "Things you didn’t ask about, but would want to know before Thursday.",
    fact: "3 blind spots · 2 open loops",
    insights: [
      { kind: "blind_spot", status: "new", title: "Your 1:1 with Alex overlaps the review" },
      { kind: "blind_spot", status: "new", title: "Priya declined" },
      { kind: "blind_spot", status: "new", title: "“Ship compact navigation” has no owner" },
      { kind: "open_loop", status: "new", title: "Waiting on Sam · 2 days" },
      { kind: "open_loop", status: "new", title: "Priya is waiting on you" },
    ],
    lesson: {
      concept: "Blind spots and open loops",
      text: "A task agent answers the question you asked. An always-on agent also looks for what you didn’t ask: clashes, missing people, and threads still waiting on someone.",
    },
  },
  {
    id: "prepare-1",
    pass: 0,
    stage: "prepare",
    title: "Brief and a reply drafted",
    detail: "A short brief with the blind spots up front, and a reply to Priya. Nothing is sent yet.",
    fact: "Brief · 1 draft",
    brief: [
      "**Thu 10:00 AM · Product design review.** Agree on the onboarding flow and the launch checklist.",
      "**Heads-up:** your 1:1 with Alex overlaps the first 15 minutes. Priya declined. Compact navigation has no owner.",
      "**Open:** Sam hasn’t confirmed the checklist owner. Priya asked about the audit.",
    ],
    draft: {
      person: "Priya",
      body: "Yes, let’s run the audit before launch. You can’t make Thursday’s review, so I’ll raise it there and send you the notes.",
    },
    lesson: {
      concept: "Drafts, never sends",
      text: "It writes the reply for you but can’t send it. Anything that goes to another person waits for your OK.",
    },
  },
  {
    id: "review-1",
    pass: 0,
    stage: "review",
    title: "Send the reply to Priya?",
    detail: "The brief goes to your inbox either way. The reply needs your OK.",
    fact: "Approved",
    decision: { question: "Send this reply to Priya?", approve: "Approve and send", decline: "Keep as draft" },
    lesson: approval,
  },
  {
    id: "deliver-1",
    pass: 0,
    stage: "deliver",
    title: "Brief delivered, reply sent",
    detail: "The brief is in your inbox and the reply went to Priya.",
    fact: "Brief · reply sent",
    ifDeclined: {
      decisionId: "review-1",
      title: "Brief delivered, reply kept as a draft",
      detail: "The brief is in your inbox. The reply to Priya stays in your drafts.",
      fact: "Brief · draft kept",
    },
  },
  {
    id: "watch-1",
    pass: 0,
    stage: "watch",
    title: "Planned its own checks",
    detail: "Nobody asked it to check again. It picked three times from the meeting and the open threads, then went to sleep.",
    fact: "Asleep until Tue 9:00 AM",
    schedule: [
      { at: "Tue 9:00 AM", cron: "0 9 * * TUE", reason: "See if Sam replied; nudge him if not", change: "new" },
      { at: "Wed 6:00 PM", cron: "0 18 * * WED", reason: "Evening before: re-check the meeting", change: "new" },
      { at: "Thu 9:00 AM", cron: "0 9 * * THU", reason: "1 hour before: last check", change: "new" },
    ],
    lesson: {
      concept: "Its own schedule",
      text: "Like writing its own cron jobs: it picks when to wake from your calendar and open threads. A new email can still wake it early.",
    },
  },

  // Tue 9:00 AM: it wakes itself.
  {
    id: "read-2",
    pass: 1,
    stage: "read",
    title: "Checked the thread with Sam",
    detail: "Its own 9:00 AM check. It only re-read the thread it was waiting on.",
    fact: "No reply from Sam",
    sources: ["Email · “Launch checklist owner?” · no new messages"],
    missed: "Sam’s silence",
  },
  {
    id: "notice-2",
    pass: 1,
    stage: "notice",
    title: "Still waiting on Sam · 3 days",
    detail: "The review is in two days and the checklist still has no owner.",
    fact: "1 loop overdue",
    insights: [
      { kind: "open_loop", status: "still_open", title: "Waiting on Sam · 3 days" },
    ],
  },
  {
    id: "prepare-2",
    pass: 1,
    stage: "prepare",
    title: "Drafted a nudge to Sam",
    detail: "Short and specific, with a deadline that works for Thursday.",
    fact: "1 draft",
    draft: {
      person: "Sam",
      body: "Hi Sam, quick nudge: could you confirm by Wednesday whether you can own the launch checklist? We review it Thursday.",
    },
  },
  {
    id: "review-2",
    pass: 1,
    stage: "review",
    title: "Send the nudge to Sam?",
    detail: "It never chases people for you without asking first.",
    fact: "Approved",
    decision: { question: "Send this nudge to Sam?", approve: "Approve and send", decline: "Don’t send" },
    lesson: approval,
  },
  {
    id: "deliver-2",
    pass: 1,
    stage: "deliver",
    title: "Nudge sent",
    detail: "Sent to Sam.",
    fact: "Nudge sent",
    ifDeclined: {
      decisionId: "review-2",
      title: "Nudge not sent",
      detail: "Nothing went to Sam. It keeps watching the thread.",
      fact: "Not sent",
    },
    missed: "A nudge to Sam",
  },
  {
    id: "watch-2",
    pass: 1,
    stage: "watch",
    title: "Back to sleep",
    detail: "Same plan as before. If Sam replies first, the email wakes it early.",
    fact: "Asleep until Wed 6:00 PM",
    schedule: [
      { at: "Wed 6:00 PM", cron: "0 18 * * WED", reason: "Evening before: re-check the meeting" },
      { at: "Thu 9:00 AM", cron: "0 9 * * THU", reason: "1 hour before: last check" },
    ],
  },

  // Tue 2:14 PM: a reply wakes it early.
  {
    id: "read-3",
    pass: 2,
    stage: "read",
    title: "Read Sam’s reply",
    detail: "The new email woke it before its next planned check.",
    fact: "1 new email",
    email: {
      person: "Sam",
      body: "Happy to own the checklist, as long as I get the final copy by Wednesday noon.",
    },
    lesson: {
      concept: "Event trigger",
      text: "It wakes for two reasons: its own schedule, and events like a new email. A task agent wakes for neither.",
    },
    missed: "Sam’s reply",
  },
  {
    id: "notice-3",
    pass: 2,
    stage: "notice",
    title: "One loop closed, one opened",
    detail: "Sam answered, but now Sam is waiting on you.",
    fact: "1 closed · 1 new",
    insights: [
      { kind: "open_loop", status: "resolved", title: "Waiting on Sam" },
      { kind: "open_loop", status: "new", title: "Sam needs the final copy by Wed noon" },
    ],
  },
  {
    id: "prepare-3",
    pass: 2,
    stage: "prepare",
    title: "Drafted a reply and a reminder",
    detail: "A reply to Sam, and a reminder for you before the deadline.",
    fact: "1 draft · 1 reminder",
    draft: {
      person: "Sam",
      body: "Thanks Sam, that works. You’ll have the final copy by Wednesday 11 AM.",
    },
  },
  {
    id: "review-3",
    pass: 2,
    stage: "review",
    title: "Send the reply to Sam?",
    detail: "The reminder is just for you, so only the reply needs your OK.",
    fact: "Approved",
    decision: { question: "Send this reply to Sam?", approve: "Approve and send", decline: "Keep as draft" },
    lesson: approval,
  },
  {
    id: "deliver-3",
    pass: 2,
    stage: "deliver",
    title: "Reply sent",
    detail: "Sent to Sam.",
    fact: "Reply sent",
    ifDeclined: {
      decisionId: "review-3",
      title: "Reply kept as a draft",
      detail: "Nothing went to Sam. The deadline still stands, so the reminder stays.",
      fact: "Draft kept",
    },
  },
  {
    id: "watch-3",
    pass: 2,
    stage: "watch",
    title: "Added a check of its own",
    detail: "Your promise to Sam has a deadline, so it scheduled a reminder before it.",
    fact: "Asleep until Wed 10:00 AM",
    schedule: [
      { at: "Wed 10:00 AM", cron: "0 10 * * WED", reason: "Remind you: final copy due to Sam at noon", change: "new" },
      { at: "Wed 6:00 PM", cron: "0 18 * * WED", reason: "Evening before: re-check the meeting" },
      { at: "Thu 9:00 AM", cron: "0 9 * * THU", reason: "1 hour before: last check" },
    ],
    missed: "Your promise to send Sam the copy",
  },

  // Wed 10:00 AM: a reminder only for you.
  {
    id: "read-4",
    pass: 3,
    stage: "read",
    title: "Checked your sent mail",
    detail: "It looked for the final copy going to Sam.",
    fact: "No copy sent yet",
    sources: ["Email · sent to Sam since Tuesday · nothing yet"],
  },
  {
    id: "notice-4",
    pass: 3,
    stage: "notice",
    title: "Copy due in 2 hours",
    detail: "You promised Sam the final copy by noon and haven’t sent it.",
    fact: "1 deadline",
    insights: [
      { kind: "open_loop", status: "still_open", title: "Final copy due to Sam at noon" },
    ],
  },
  {
    id: "deliver-4",
    pass: 3,
    stage: "deliver",
    title: "Reminded you",
    detail: "A reminder to you, not a message to anyone else, so it didn’t need your OK.",
    fact: "Reminder to you",
    lesson: {
      concept: "Approval boundary",
      text: "It only asks before acting for you. Reminding you is safe, so it just does it.",
    },
    missed: "The copy deadline",
  },
  {
    id: "watch-4",
    pass: 3,
    stage: "watch",
    title: "Back to sleep",
    detail: "Its next check is the evening before the review.",
    fact: "Asleep until Wed 6:00 PM",
    schedule: [
      { at: "Wed 6:00 PM", cron: "0 18 * * WED", reason: "Evening before: re-check the meeting" },
      { at: "Thu 9:00 AM", cron: "0 9 * * THU", reason: "1 hour before: last check" },
    ],
  },

  // Wed 6:00 PM: the meeting moved.
  {
    id: "read-5",
    pass: 4,
    stage: "read",
    title: "Re-read the meeting",
    detail: "The organizer moved the review.",
    fact: "Meeting moved",
    sources: ["Calendar · Product design review, now Thu 2:00 PM (was 10:00 AM)"],
    missed: "The meeting moving to 2:00 PM",
  },
  {
    id: "notice-5",
    pass: 4,
    stage: "notice",
    title: "The move fixed one blind spot",
    detail: "The clash with Alex is gone. Priya declined the old time, so she might make the new one.",
    fact: "1 resolved · 1 changed",
    insights: [
      { kind: "blind_spot", status: "resolved", title: "1:1 with Alex overlaps the review" },
      { kind: "blind_spot", status: "new", title: "Priya might make 2:00 PM" },
      { kind: "blind_spot", status: "still_open", title: "Compact navigation has no owner" },
    ],
  },
  {
    id: "prepare-5",
    pass: 4,
    stage: "prepare",
    title: "Updated the brief and drafted a note",
    detail: "The new time goes in the brief, with a note asking Priya to join.",
    fact: "Updated brief · 1 draft",
    brief: [
      "**Now Thu 2:00 PM** (moved from 10:00 AM).",
      "**Resolved:** no clash with your 1:1 with Alex.",
      "**Still open:** compact navigation has no owner.",
    ],
    draft: {
      person: "Priya",
      body: "The review moved to Thursday 2:00 PM. Could you join for the audit item?",
    },
  },
  {
    id: "review-5",
    pass: 4,
    stage: "review",
    title: "Send the note to Priya?",
    detail: "The updated brief goes to your inbox either way.",
    fact: "Approved",
    decision: { question: "Send this note to Priya?", approve: "Approve and send", decline: "Keep as draft" },
    lesson: approval,
  },
  {
    id: "deliver-5",
    pass: 4,
    stage: "deliver",
    title: "Updated brief delivered, note sent",
    detail: "The new brief is in your inbox and Priya has the note.",
    fact: "Brief · note sent",
    ifDeclined: {
      decisionId: "review-5",
      title: "Updated brief delivered, note kept as a draft",
      detail: "The new brief is in your inbox. The note to Priya stays in your drafts.",
      fact: "Brief · draft kept",
    },
  },
  {
    id: "watch-5",
    pass: 4,
    stage: "watch",
    title: "Re-planned its own schedule",
    detail: "The meeting moved, so its last check moved with it.",
    fact: "Asleep until Thu 1:00 PM",
    schedule: [
      { at: "Thu 9:00 AM", cron: "0 9 * * THU", reason: "1 hour before the old time", change: "removed" },
      { at: "Thu 1:00 PM", cron: "0 13 * * THU", reason: "1 hour before the new time", change: "moved" },
      { at: "Thu 3:00 PM", cron: "0 15 * * THU", reason: "Meeting ends: wrap up", change: "new" },
    ],
    lesson: {
      concept: "Its own schedule",
      text: "When the calendar changes, it rewrites its own schedule. A fixed cron job would still fire at the old time.",
    },
    missed: "The new time for the last check",
  },

  // Thu 1:00 PM: nothing new, so it stays quiet.
  {
    id: "read-6",
    pass: 5,
    stage: "read",
    title: "Last check before the review",
    detail: "Same meeting and same threads as last night.",
    fact: "Nothing changed",
  },
  {
    id: "notice-6",
    pass: 5,
    stage: "notice",
    title: "Nothing new",
    detail: "No new blind spots or replies since last night, so there’s nothing to send.",
    fact: "Nothing new",
    lesson: {
      concept: "Quiet by default",
      text: "Always-on doesn’t mean always pinging. Nothing changed, so it sends nothing.",
    },
  },
  {
    id: "watch-6",
    pass: 5,
    stage: "watch",
    title: "Sleeping until the review ends",
    detail: "One check left: the end of the meeting.",
    fact: "Asleep until Thu 3:00 PM",
    schedule: [{ at: "Thu 3:00 PM", cron: "0 15 * * THU", reason: "Meeting ends: wrap up" }],
  },

  // Thu 3:00 PM: the goal is done.
  {
    id: "finish",
    pass: 6,
    stage: "finish",
    title: "Goal done, so it stopped",
    detail: "The review is over. It cancelled its remaining checks and closed the run.",
    fact: "Stopped Thu 3:00 PM",
    lesson: {
      concept: "Stop condition",
      text: "An always-on agent still needs an end: the goal is done, its checks run out, or you stop it.",
    },
  },
];

const stageOrder = storyStages.map((stage) => stage.id);

/** A step's copy after the owner's decision, if it reports one. */
export function storyCopy(
  step: StoryStep,
  decisions: Readonly<Record<string, StoryDecision>>,
): StoryCopy {
  if (step.ifDeclined && decisions[step.ifDeclined.decisionId] === "declined")
    return step.ifDeclined;
  if (step.decision && decisions[step.id] === "declined")
    return { ...step, fact: "Declined" };
  return step;
}

/** The next step, or nothing while a decision waits or the story has ended. */
export function storyNext(
  index: number,
  decisions: Readonly<Record<string, StoryDecision>>,
): number | undefined {
  const step = storySteps[index];
  if (!step || (step.decision && !decisions[step.id])) return undefined;
  return index + 1 < storySteps.length ? index + 1 : undefined;
}

/** Moving forward stops at the first decision still waiting for you. */
export function storySeek(
  target: number,
  decisions: Readonly<Record<string, StoryDecision>>,
): number {
  const bounded = Math.max(0, Math.min(target, storySteps.length - 1));
  for (let index = 0; index < bounded; index++) {
    const step = storySteps[index];
    if (step.decision && !decisions[step.id]) return index;
  }
  return bounded;
}

/** The first step of a stage in the current check, if that check has one. */
export function storyStageStep(index: number, stage: StoryStage): number | undefined {
  const pass = storySteps[index]?.pass;
  const found = storySteps.findIndex((step) => step.pass === pass && step.stage === stage);
  return found >= 0 ? found : undefined;
}

/** What a task agent that answered once on Monday would have missed so far. */
export function storyMissed(index: number): string[] {
  return storySteps
    .slice(0, index + 1)
    .flatMap((step) => (step.missed ? [step.missed] : []));
}

/** Projects the story onto the same stage diagram the live run uses. */
export function storyStageMap(
  index: number,
  decisions: Readonly<Record<string, StoryDecision>>,
  playing: boolean,
): StageMapView {
  const current = storySteps[index];
  const pass = storyPasses[current.pass];
  const currentOrder = stageOrder.indexOf(current.stage);
  const seen = storySteps.slice(0, index + 1);
  const stages = storyStages.map((definition, order): StageView => {
    const latest = seen.findLast((step) => step.stage === definition.id);
    const visits = new Set(
      seen.filter((step) => step.stage === definition.id).map((step) => step.pass),
    ).size;
    const base = {
      ...definition,
      visits,
      lastStepId: latest?.id,
    };
    if (definition.id === current.stage) {
      const copy = storyCopy(current, decisions);
      let state: StageState = playing ? "active" : "paused";
      let stateLabel = copy.fact;
      if (current.decision && !decisions[current.id]) {
        state = "waiting";
        stateLabel = "Your turn";
      } else if (current.stage === "watch") state = "sleeping";
      else if (current.stage === "finish") state = "done";
      return { ...base, state, stateLabel, fact: copy.fact };
    }
    const skip = pass.skips?.[definition.id];
    if (order > currentOrder)
      return { ...base, state: "upcoming", stateLabel: "Not yet", fact: undefined };
    if (skip) return { ...base, state: "skipped", stateLabel: "Skipped", fact: skip };
    if (!latest)
      return { ...base, state: "upcoming", stateLabel: "Not yet", fact: undefined };
    const copy = storyCopy(latest, decisions);
    const declined = latest.decision && decisions[latest.id] === "declined";
    return {
      ...base,
      state: declined ? "declined" : "done",
      stateLabel: declined ? "Declined" : "Done",
      fact: copy.fact,
    };
  });
  return {
    kind: "meeting_prep",
    stages,
    currentStageId: current.stage,
    checks: current.pass + 1,
    looping: current.pass > 0 && current.stage === "read",
    stepStages: {},
  };
}

export interface StoryScenario {
  id: string;
  label: string;
  /** One line on what to watch for. */
  summary: string;
  start: string;
  end: string;
}

/** Named parts of the week, for presenting one behaviour at a time. */
export const storyScenarios: StoryScenario[] = [
  { id: "week", label: "Whole week", summary: "One request, seven checks, Monday to Thursday.", start: "request", end: "finish" },
  { id: "blind-spots", label: "Spots blind spots", summary: "It finds a clash, a missing person, and an unowned decision you didn’t ask about.", start: "read-1", end: "notice-1" },
  { id: "schedule", label: "Schedules its own checks", summary: "It picks its own wake-up times, sleeps, then wakes itself on Tuesday.", start: "watch-1", end: "read-2" },
  { id: "nudge", label: "Nudges when nobody replies", summary: "Sam hasn’t answered in 3 days, so it drafts a nudge for your OK.", start: "read-2", end: "deliver-2" },
  { id: "follow-up", label: "Follows up on a reply", summary: "Sam’s reply wakes it early. It closes one loop and tracks the promise you made.", start: "read-3", end: "watch-3" },
  { id: "replan", label: "Re-plans when plans change", summary: "The meeting moves, so it updates the brief and moves its own checks.", start: "read-5", end: "watch-5" },
  { id: "quiet", label: "Stays quiet", summary: "Nothing changed, so it sends nothing.", start: "read-6", end: "watch-6" },
];

export function storyIndex(id: string): number {
  return storySteps.findIndex((step) => step.id === id);
}

/** Approves every decision before a step, so a scenario can start mid-week. */
export function storyApprovedBefore(
  index: number,
  decisions: Readonly<Record<string, StoryDecision>>,
): Record<string, StoryDecision> {
  const approved: Record<string, StoryDecision> = { ...decisions };
  for (const step of storySteps.slice(0, index))
    if (step.decision && !approved[step.id]) approved[step.id] = "approved";
  return approved;
}
