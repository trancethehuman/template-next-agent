import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createCalendarEventProposal } from "../../agent/lib/calendar-proposal";
import { createTaskBackend } from "../../agent/lib/task-backend";
import controlTask from "../../agent/tools/control_task";
import { CalendarIntegrationError } from "../../lib/assistant/calendar";

const actor = { id: "google:synthetic-owner", email: "synthetic@agiventures.ca" };
const now = () => new Date("2026-10-30T16:00:00Z");
const draft = {
  summary: "Synthetic calendar write rehearsal",
  description: "Fictional event for a protected proposal test.",
  start: "2026-10-31T10:00:00-04:00",
  end: "2026-10-31T10:30:00-04:00",
  timeZone: "America/Toronto",
};
const connected = async () => ({
  state: "connected", message: "Connected", writeEnabled: true,
  capabilities: { createEvent: true },
});

describe("agent calendar proposal boundary", () => {
  test("read-only mode refuses a proposal without calling provider or task service", async () => {
    let reads = 0;
    const propose = createCalendarEventProposal({
      writeEnabled: () => false,
      connection: async () => { reads++; return connected(); },
      now,
    });
    const result = await propose(actor, draft, "synthetic:call_001");
    expect(result.proposed).toBe(false);
    expect(result).toMatchObject({ error: "calendar_writes_disabled" });
    expect(result.message).toContain("ASSISTANT_CALENDAR_WRITE_ENABLED");
    expect(reads).toBe(0);
  });

  test("a read connection does not count as permission to create events", async () => {
    let checkedAvailability = false;
    const propose = createCalendarEventProposal({
      writeEnabled: () => true,
      connection: async () => ({ state: "connected", message: "Read access only", writeEnabled: false, capabilities: { createEvent: false } }),
      availability: async () => { checkedAvailability = true; return { slots: [], timeZone: "UTC" }; },
      now,
    });
    expect(await propose(actor, draft, "synthetic:call_002")).toMatchObject({
      proposed: false, error: "calendar_write_permission_required",
    });
    expect(checkedAvailability).toBe(false);
  });

  test("invalid dates and extra outbound fields never reach a connection", async () => {
    let reads = 0;
    const propose = createCalendarEventProposal({
      writeEnabled: () => true,
      connection: async () => { reads++; return connected(); },
      now,
    });
    for (const raw of [
      { ...draft, attendees: [{ email: "fictional@example.test" }] },
      { ...draft, conferenceData: {} },
      { ...draft, calendarId: "other-calendar" },
      { ...draft, start: "2026-10-31T10:00:00" },
      { ...draft, start: "2026-10-29T10:00:00-04:00" },
      { ...draft, end: "2026-10-31T10:30:30-04:00" },
      { ...draft, timeZone: "Invalid/Zone" },
    ]) expect(await propose(actor, raw, "synthetic:call_003")).toMatchObject({ proposed: false, error: "invalid_event_draft" });
    expect(reads).toBe(0);
  });

  test("queues only the exact normalized draft through the protected Next bridge", async () => {
    const requests: Array<{url: string; options: RequestInit}> = [];
    const backend = createTaskBackend(() => ({
      ASSISTANT_APP_ORIGIN: "https://owner.example",
    }), async (url, options) => {
      requests.push({ url, options });
      return Response.json({ runId: "wrun_synthetic_proposal_001" }, { status: 202 });
    }, async (signedActor) => { expect(signedActor).toEqual(actor); return "synthetic-service-token"; });
    const propose = createCalendarEventProposal({
      writeEnabled: () => true,
      connection: connected,
      availability: async (calendarActor, query) => {
        expect(calendarActor).toEqual(actor);
        expect(query).toEqual({ timeMin: "2026-10-31T14:00:00.000Z", timeMax: "2026-10-31T14:30:00.000Z", durationMinutes: 30, timeZone: "America/Toronto" });
        return { slots: [{start: query.timeMin, end: query.timeMax}], timeZone: query.timeZone! };
      },
      backend,
      now,
    });
    const result = await propose(actor, draft, "synthetic-session:call_004");
    expect(result.proposed).toBe(true);
    expect(result).toMatchObject({ kind: "calendar_event", runId: "wrun_synthetic_proposal_001", availability: { state: "free" } });
    expect(result.message).toContain("does not confirm a Google Calendar write");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://owner.example/api/assistant/tasks");
    expect(requests[0].options.method).toBe("POST");
    expect(new Headers(requests[0].options.headers).get("x-assistant-idempotency-key")).toBe("synthetic-session:call_004");
    expect(JSON.parse(String(requests[0].options.body))).toEqual({
      kind: "calendar_event",
      eventDraft: { ...draft, start: "2026-10-31T14:00:00.000Z", end: "2026-10-31T14:30:00.000Z" },
    });
    expect("calendarEvent" in result).toBe(false);
  });

  test("returns the actual availability permission error without queuing a draft", async () => {
    const propose = createCalendarEventProposal({
      writeEnabled: () => true,
      connection: connected,
      availability: async () => { throw new CalendarIntegrationError("permission_denied", "Reconnect Calendar with the configured scope."); },
      now,
    });
    expect(await propose(actor, draft, "synthetic:call_005")).toMatchObject({
      proposed: false, error: "permission_denied", message: "Reconnect Calendar with the configured scope.",
    });
  });

  test("the model cannot approve or deny its own calendar proposal", () => {
    const schema = controlTask.inputSchema as z.ZodType;
    for (const action of ["approve", "deny"])
      expect(schema.safeParse({ runId: "wrun_synthetic_proposal_001", action }).success).toBe(false);
    expect(schema.safeParse({ runId: "wrun_synthetic_proposal_001", action: "cancel" }).success).toBe(true);
  });
});
