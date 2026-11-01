import { describe, expect, test } from "bun:test";
import {
  assistantTaskSchema,
  projectAssistantTask,
} from "../../lib/assistant/task-policy";
import type { AssistantTaskInput, TaskEvent } from "../../lib/assistant/types";

const draft = {
  summary: "Synthetic private planning hold",
  description: "A fictional approval test",
  start: "2099-11-02T10:00:00-05:00",
  end: "2099-11-02T10:30:00-05:00",
  timeZone: "America/Toronto",
};

function runCalendarAction(
  actions: string[],
  provider: "created" | "reused" | "error" = "created",
) {
  const code = `
    import {mock} from "bun:test";
    const events=[];const writes=[];const providerActors=[];let step=0;let command=0;let failure;
    const actions=${JSON.stringify(actions)};
    const hook={async getConflict(){return null},[Symbol.asyncIterator](){return this},async next(){
      if(writes.length)throw new Error("Provider was called before the owner decision");
      let action=actions.shift();if(!action)throw new Error("Missing test decision");const stale=action==="stale-approve";if(stale)action="approve";
      return {done:false,value:{action,requestId:"decision_"+(++command),checkpointId:stale?"step_stale":events.filter(event=>event.status).at(-1)?.id}};
    }};
    mock.module("workflow",()=>({FatalError:class extends Error{},getStepMetadata:()=>({stepId:"step_"+(++step)}),getWritable:()=>({getWriter:()=>({async write(line){events.push(JSON.parse(line))},releaseLock(){}}),async close(){}}),createHook:()=>hook,sleep:()=>new Promise(()=>{})}));
    mock.module("./lib/assistant/calendar.ts",()=>({createManagedCalendarEvent:async(actor,draft,actionId)=>{
      providerActors.push(actor);writes.push({draft,actionId});if(${JSON.stringify(provider)}==="error")throw new Error("Private provider diagnostics");
      return {id:"synthetic-managed-event",title:draft.summary,start:draft.start,end:draft.end,timeZone:draft.timeZone,allDay:false,htmlUrl:"https://calendar.google.com/calendar/event?eid=synthetic-managed-event",managed:true,reused:${JSON.stringify(provider)}==="reused"};
    }}));
    const {assistantTaskWorkflow}=await import("./workflows/assistant-task.ts");
    try{await assistantTaskWorkflow({owner:{id:"google:synthetic-alice",email:"alice@agiventures.ca"},taskId:"synthetic-action-identity",kind:"calendar_event",eventDraft:${JSON.stringify(draft)},title:"Create calendar event",prompt:"Create after owner approval",mode:"calendar",approvalRequired:false,delaySeconds:0,manualStart:false,sourceVersion:1,maxChecks:1,preference:{bulletCount:3,includeLinks:true}})}catch(error){failure=error.message}
    console.log(JSON.stringify({events,writes,failure,providerActors}));
  `;
  const result = Bun.spawnSync([process.execPath, "-e", code], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout)) as {
    events: TaskEvent[];
    writes: Array<{ draft: typeof draft; actionId: string }>;
    failure?: string;
    providerActors: Array<{ id: string; email: string }>;
  };
}

describe("calendar event owner approval", () => {
  test("proposal creation normalizes the exact draft and forces the owner gate; disabled and past proposals never start a workflow", () => {
    const code = `
      import {mock} from "bun:test";
      const started=[];const errors=[];
      mock.module("workflow/api",()=>({start:async(_workflow,args)=>{started.push(args[0]);return {runId:"wrun_synthetic_event_proposal"}},getHookByToken:async()=>null,getRun:()=>null,resumeHook:async()=>null}));
      mock.module("workflow/runtime",()=>({getWorld:async()=>({runs:{list:async()=>({data:[]})}})}));
      const {createAssistantTask}=await import("./lib/assistant/tasks.ts");
      const start=Date.now()+86400000;const draft={summary:"  Synthetic private event  ",description:" Exact reviewed description ",start:new Date(start).toISOString(),end:new Date(start+1800000).toISOString(),timeZone:"America/Toronto"};
      process.env.ASSISTANT_CALENDAR_WRITE_ENABLED="true";
      await createAssistantTask({id:"google:synthetic-alice",email:"alice@agiventures.ca"},{kind:"calendar_event",eventDraft:draft,mode:"rehearsal",approvalRequired:false,manualStart:true,delaySeconds:3600,maxChecks:5});
      process.env.ASSISTANT_CALENDAR_WRITE_ENABLED="false";
      try{await createAssistantTask({id:"google:synthetic-alice",email:"alice@agiventures.ca"},{kind:"calendar_event",eventDraft:draft})}catch(error){errors.push(error.status)}
      process.env.ASSISTANT_CALENDAR_WRITE_ENABLED="true";
      try{await createAssistantTask({id:"google:synthetic-alice",email:"alice@agiventures.ca"},{kind:"calendar_event",eventDraft:{...draft,start:"2000-01-01T10:00:00Z",end:"2000-01-01T11:00:00Z"}})}catch(error){errors.push(error.status)}
      console.log(JSON.stringify({started,errors}));
    `;
    const result = Bun.spawnSync([process.execPath, "-e", code], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0)
      throw new Error(new TextDecoder().decode(result.stderr));
    const value = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(value.started).toHaveLength(1);
    expect(value.started[0]).toMatchObject({
      kind: "calendar_event",
      mode: "calendar",
      approvalRequired: true,
      manualStart: false,
      delaySeconds: 0,
      maxChecks: 1,
      eventDraft: {
        summary: "Synthetic private event",
        description: "Exact reviewed description",
      },
    });
    expect(value.errors).toEqual([403, 400]);
  });

  test("a write requires an exact draft; attendees, calendar selection, invalid dates, and mixed preparation writes are rejected", () => {
    expect(
      assistantTaskSchema.safeParse({ kind: "calendar_event" }).success,
    ).toBe(false);
    expect(
      assistantTaskSchema.safeParse({
        kind: "calendar_event",
        eventDraft: { ...draft, attendees: ["fictional@example.com"] },
      }).success,
    ).toBe(false);
    expect(
      assistantTaskSchema.safeParse({
        kind: "calendar_event",
        eventDraft: { ...draft, calendarId: "other-calendar" },
      }).success,
    ).toBe(false);
    expect(
      assistantTaskSchema.safeParse({
        kind: "calendar_event",
        eventDraft: { ...draft, start: "2099-11-02T10:00:00" },
      }).success,
    ).toBe(false);
    expect(
      assistantTaskSchema.safeParse({ kind: "meeting_prep", eventDraft: draft })
        .success,
    ).toBe(false);
  });

  test("denial performs no provider write even if the proposed input tries to disable approval", () => {
    const result = runCalendarAction(["deny"]);
    expect(result.writes).toHaveLength(0);
    expect(result.events[0].status).toBe("awaiting_approval");
    expect(
      result.events.some((event) => event.calendarDecision === "denied"),
    ).toBe(true);
    expect(result.events.at(-1)?.status).toBe("completed");
  });

  test("stop before approval is terminal and performs no provider write", () => {
    const result = runCalendarAction(["cancel"]);
    expect(result.writes).toHaveLength(0);
    expect(result.events.at(-1)?.status).toBe("cancelled");
    const projected = projectAssistantTask(
      { runId: "wrun_synthetic", status: "completed", createdAt: new Date() },
      result.events,
    );
    expect(projected.status).toBe("cancelled");
    expect(projected.allowedActions).toEqual([]);
  });

  test("an old checkpoint approval cannot authorize the current draft", () => {
    const result = runCalendarAction(["stale-approve", "deny"]);
    expect(result.writes).toHaveLength(0);
    expect(
      result.events.some((event) => event.calendarDecision === "approved"),
    ).toBe(false);
  });

  test("one matching owner approval writes the immutable draft with a stable action identity and records the provider result", () => {
    const result = runCalendarAction(["approve", "approve"]);
    expect(result.writes).toEqual([
      { draft, actionId: "synthetic-action-identity" },
    ]);
    expect(result.providerActors).toEqual([
      { id: "google:synthetic-alice", email: "alice@agiventures.ca" },
    ]);
    const approvedIndex = result.events.findIndex(
      (event) => event.calendarDecision === "approved",
    );
    const writeIndex = result.events.findIndex(
      (event) => event.type === "calendar_event",
    );
    expect(approvedIndex).toBeGreaterThan(0);
    expect(writeIndex).toBeGreaterThan(approvedIndex);
    expect(result.events[writeIndex].calendarEvent?.id).toBe(
      "synthetic-managed-event",
    );
    expect(result.events.at(-1)?.status).toBe("completed");
  });

  test("a confirmed retry reports the same managed event rather than a second event", () => {
    const result = runCalendarAction(["approve"], "reused");
    expect(result.writes).toHaveLength(1);
    expect(
      result.events.find((event) => event.type === "calendar_event")
        ?.calendarEvent?.reused,
    ).toBe(true);
    expect(
      result.events.find((event) => event.type === "calendar_event")?.title,
    ).toBe("Calendar event confirmed");
  });

  test("failed provider confirmation remains uncertain and does not report creation success", () => {
    const result = runCalendarAction(["approve"], "error");
    expect(result.writes).toHaveLength(1);
    expect(result.events.some((event) => event.type === "calendar_event")).toBe(
      false,
    );
    expect(result.events.at(-1)?.status).toBe("failed");
    expect(result.failure).toContain("may have reached Google");
    expect(result.failure).not.toContain("Private provider diagnostics");
  });

  test("approval acceptance removes cancellation before the provider step begins", () => {
    const input: AssistantTaskInput = {
      ...assistantTaskSchema.parse({
        kind: "calendar_event",
        eventDraft: draft,
      }),
      taskId: "synthetic-action",
    };
    const events: TaskEvent[] = [
      {
        id: "gate",
        type: "status",
        status: "awaiting_approval",
        title: "Review event",
        detail: "",
        occurredAt: new Date().toISOString(),
        input,
      },
      {
        id: "approved",
        type: "approval",
        calendarDecision: "approved",
        title: "Approved",
        detail: "",
        occurredAt: new Date().toISOString(),
      },
    ];
    const projected = projectAssistantTask(
      { runId: "wrun_synthetic", status: "running", createdAt: new Date() },
      events,
    );
    expect(projected.allowedActions).toEqual([]);
    expect(projected.kind).toBe("calendar_event");
    expect(projected.eventDraft).toEqual(draft);
  });
});
