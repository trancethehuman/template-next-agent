import assert from "node:assert/strict";
import { test } from "node:test";
import { NoValidTokenError, UserAuthorizationRequiredError } from "@vercel/connect";
import {
  CALENDAR_READ_SCOPE,
  CALENDAR_OWNED_EVENTS_SCOPE,
  CalendarIntegrationError,
  createCalendarClient,
  createCalendarClientForActor,
  managedCalendarEventId,
  managedCalendarEventIdForActor,
} from "../../lib/assistant/calendar";
import { calendarEventDraftSchema, validateCalendarEventDraft } from "../../lib/assistant/calendar-event-schema";
import { calendarAuthorizationCallback, calendarReturnDestination } from "../../lib/assistant/calendar-callback";
import type { CalendarEventDraft } from "../../lib/assistant/calendar-event-schema";
import type { AssistantActor } from "../../lib/auth/actor";
import { GET } from "../../app/api/assistant/calendar/route";
import { POST as authorize } from "../../app/api/assistant/calendar/authorize/route";

const environment = () => ({
  ASSISTANT_GOOGLE_CONNECTOR: "google/synthetic-calendar",
  ASSISTANT_GOOGLE_SUBJECT_ID: "synthetic-owner",
  ASSISTANT_CALENDAR_ID: "synthetic/calendar@example.test",
});
const fixedNow = () => new Date("2026-11-02T14:00:00.000Z");
const eventFixture = {
  summary: "Synthetic teaching calendar",
  timeZone: "America/Toronto",
  items: [
    {id: "meeting", summary: "Synthetic planning meeting", start: {dateTime: "2026-11-02T10:00:00-05:00"}, end: {dateTime: "2026-11-02T11:00:00-05:00"}, htmlLink: "https://calendar.google.com/calendar/event?eid=synthetic", description: "Should never leave the provider boundary", attendees: [{email: "fictional@example.test"}]},
    {id: "all-day", summary: "Synthetic offsite", start: {date: "2026-11-03"}, end: {date: "2026-11-04"}},
    {id: "cancelled", status: "cancelled"},
    {id: "private", start: {dateTime: "2026-11-04T10:00:00Z"}, end: {dateTime: "2026-11-04T11:00:00Z"}, htmlLink: "javascript:alert(1)"},
  ],
  nextPageToken: "synthetic-page",
};

test("calendar requests only the configured owner and read-only Google scope; maps actual timed and all-day events", async () => {
  let calls = 0;
  const client = createCalendarClient({
    environment,
    now: fixedNow,
    getToken: async (connector, params) => {
      assert.equal(connector, "google/synthetic-calendar");
      assert.deepEqual(params, {subject: {type: "user", id: "synthetic-owner"}, scopes: [CALENDAR_READ_SCOPE]});
      return "synthetic-test-token";
    },
    fetch: (async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, "https://www.googleapis.com");
      assert.match(url.pathname, /calendars\/synthetic%2Fcalendar%40example.test\/events$/);
      assert.equal(url.searchParams.get("singleEvents"), "true");
      assert.equal(url.searchParams.get("orderBy"), "startTime");
      assert.equal(url.searchParams.get("maxResults"), "20");
      assert.equal(url.searchParams.get("timeMin"), fixedNow().toISOString());
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-test-token");
      return Response.json(eventFixture);
    }),
  });
  const result = await client.listEvents();
  assert.equal(calls, 1);
  assert.equal(result.calendarName, "Synthetic teaching calendar");
  assert.equal(result.timeZone, "America/Toronto");
  assert.equal(result.truncated, true);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0].allDay, false);
  assert.equal(result.events[1].allDay, true);
  assert.equal(result.events[1].end, "2026-11-04");
  assert.equal(result.events[2].title, "Untitled event");
  assert.equal(result.events[2].htmlUrl, undefined);
  assert.equal("description" in result.events[0], false);
  assert.equal("attendees" in result.events[0], false);
  assert.equal(JSON.stringify(result).includes("synthetic-test-token"), false);
});

test("the always-on watch reads seven days with replies and cancellations, keeping only first names and email hashes", async () => {
  const client = createCalendarClient({
    environment,
    now: fixedNow,
    getToken: async () => "synthetic-test-token",
    fetch: (async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("showDeleted"), "true");
      assert.equal(url.searchParams.get("timeMin"), fixedNow().toISOString());
      assert.equal(url.searchParams.get("timeMax"), "2026-11-09T14:00:00.000Z");
      assert.match(url.searchParams.get("fields") ?? "", /attendees\(email,displayName,responseStatus,self,resource\)/);
      return Response.json({
        timeZone: "America/Toronto",
        items: [
          {
            id: "review", summary: "Synthetic design review", updated: "2026-11-01T12:00:00Z",
            start: {dateTime: "2026-11-03T10:00:00-05:00"}, end: {dateTime: "2026-11-03T11:00:00-05:00"},
            organizer: {self: true},
            attendees: [
              {email: "owner@example.test", self: true, responseStatus: "accepted"},
              {email: "Priya.Fictional@example.test", displayName: "Priya Fictional", responseStatus: "declined"},
              {email: "room@resource.example.test", resource: true, responseStatus: "accepted"},
              {email: "sam@example.test", responseStatus: "surprise"},
            ],
          },
          {id: "lunch", summary: "Lunch hold", transparency: "transparent", start: {dateTime: "2026-11-03T12:00:00-05:00"}, end: {dateTime: "2026-11-03T13:00:00-05:00"}},
          {id: "office", summary: "Home", eventType: "workingLocation", start: {date: "2026-11-04"}, end: {date: "2026-11-05"}},
          {id: "gone", status: "cancelled", originalStartTime: {dateTime: "2026-11-05T09:00:00-05:00"}},
          {id: "no-time", status: "cancelled"},
        ],
      });
    }),
  });
  const scan = await client.scanEvents();
  assert.equal(scan.timeZone, "America/Toronto");
  assert.equal(scan.truncated, false);
  assert.deepEqual(scan.events.map((event) => event.id), ["review", "lunch", "office", "gone"]);
  const [review, lunch, office, gone] = scan.events;
  assert.equal(review.organizedByYou, true);
  assert.equal(review.yourResponse, "accepted");
  assert.deepEqual(review.guests.map((guest) => [guest.name, guest.response]), [["Priya", "declined"], ["sam", "needsAction"]]);
  assert.match(review.guests[0].key, /^[a-f0-9]{12}$/);
  assert.equal(JSON.stringify(scan).includes("@example.test"), false);
  assert.equal(lunch.free, true);
  assert.equal(office.marker, true);
  assert.equal(office.allDay, true);
  assert.equal(gone.cancelled, true);
  assert.equal(gone.start, "2026-11-05T09:00:00-05:00");
});

test("calendar status is not connected until Google responds successfully", async () => {
  const unconfigured = createCalendarClient({environment: () => ({})});
  const missing = await unconfigured.overview();
  assert.equal(missing.status.state, "not_configured");
  assert.match(missing.status.message, /ASSISTANT_GOOGLE_CONNECTOR/);
  assert.equal(missing.status.canAuthorize, false);
  assert.deepEqual(missing.events, []);

  for (const failure of [new UserAuthorizationRequiredError("sensitive vendor detail"), new NoValidTokenError("sensitive vendor detail"), new Error("sensitive provider error")]) {
    const client = createCalendarClient({environment, getToken: async () => {throw failure;}});
    const result = await client.overview();
    assert.notEqual(result.status.state, "connected");
    assert.equal(JSON.stringify(result).includes("sensitive"), false);
    assert.equal(result.status.canAuthorize, failure instanceof UserAuthorizationRequiredError || failure instanceof NoValidTokenError);
  }
});

test("revoked Google token evicts the SDK cache and requires new consent", async () => {
  let evicted = false;
  const client = createCalendarClient({
    environment,
    getToken: async () => "synthetic-token",
    fetch: (async () => Response.json({error: "private provider detail"}, {status: 401})),
    deleteTokenCacheEntry: (connector, params) => {
      evicted = true;
      assert.equal(connector, "google/synthetic-calendar");
      assert.deepEqual(params.scopes, [CALENDAR_READ_SCOPE]);
    },
  });
  const result = await client.overview();
  assert.equal(evicted, true);
  assert.equal(result.status.state, "authorization_required");
  assert.equal(result.status.canAuthorize, true);
  assert.equal(JSON.stringify(result).includes("private provider detail"), false);
});

test("provider failures never turn into a fabricated free calendar or leak raw errors", async () => {
  for (const response of [Response.json({error: "sensitive Google detail"}, {status: 403}), Response.json({error: "sensitive Google detail"}, {status: 429}), Response.json({error: "sensitive Google detail"}, {status: 500}), Response.json({unexpected: true})]) {
    const client = createCalendarClient({environment, getToken: async () => "synthetic-token", fetch: (async () => response)});
    const result = await client.overview();
    assert.equal(result.status.state, "unavailable");
    assert.equal(result.status.canAuthorize, false);
    assert.equal(JSON.stringify(result).includes("sensitive"), false);
  }
});

test("free/busy merges overlap, clips boundary events, and respects requested duration", async () => {
  const client = createCalendarClient({
    environment,
    getToken: async () => "synthetic-token",
    fetch: (async (input, init) => {
      assert.equal(String(input), "https://www.googleapis.com/calendar/v3/freeBusy");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.items, [{id: environment().ASSISTANT_CALENDAR_ID}]);
      return Response.json({calendars: {[environment().ASSISTANT_CALENDAR_ID]: {busy: [
        {start: "2026-11-02T10:00:00-05:00", end: "2026-11-02T11:00:00-05:00"},
        {start: "2026-11-02T10:30:00-05:00", end: "2026-11-02T11:30:00-05:00"},
        {start: "2026-11-02T08:00:00-05:00", end: "2026-11-02T09:30:00-05:00"},
      ]}}});
    }),
  });
  const result = await client.availability({timeMin: "2026-11-02T09:00:00-05:00", timeMax: "2026-11-02T13:00:00-05:00", durationMinutes: 60, timeZone: "America/Toronto"});
  assert.deepEqual(result.slots, [{start: "2026-11-02T16:30:00.000Z", end: "2026-11-02T17:30:00.000Z"}]);
  assert.equal(result.timeZone, "America/Toronto");
});

test("empty free/busy is available but partial or malformed responses fail closed", async () => {
  const query = {timeMin: "2026-11-02T14:00:00Z", timeMax: "2026-11-02T16:00:00Z", durationMinutes: 30};
  const calendarId = environment().ASSISTANT_CALENDAR_ID;
  const empty = createCalendarClient({environment, getToken: async () => "synthetic-token", fetch: (async () => Response.json({calendars: {[calendarId]: {busy: []}}}))});
  assert.deepEqual((await empty.availability(query)).slots, [{start: "2026-11-02T14:00:00.000Z", end: "2026-11-02T14:30:00.000Z"}]);
  for (const data of [{calendars: {}}, {calendars: {[calendarId]: {errors: [{reason: "notFound"}], busy: []}}}, {calendars: {[calendarId]: {busy: [{start: "bad", end: "bad"}]}}}]) {
    const client = createCalendarClient({environment, getToken: async () => "synthetic-token", fetch: (async () => Response.json(data))});
    await assert.rejects(client.availability(query), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "unavailable");
  }
});

test("calendar input limits reject ambiguous dates and oversized windows before provider I/O", async () => {
  const client = createCalendarClient({environment, getToken: async () => {assert.fail("No credential should be requested");}});
  for (const query of [{timeMin: "not-a-date"}, {timeMin: "2026-02-30T10:00:00Z"}, {timeMin: "2026-11-02T10:00:00"}, {timeMin: "2026-11-02T10:00:00Z", timeMax: "2026-11-02T09:00:00Z"}, {timeMin: "2026-11-02T10:00:00Z", timeMax: "2026-12-04T10:00:00Z"}, {limit: 51}, {limit: 1.5}]) {
    await assert.rejects(client.listEvents(query), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "invalid_query");
  }
  for (const query of [{durationMinutes: 0}, {durationMinutes: 481}, {durationMinutes: 30, timeZone: "Mars/Olympus"}]) {
    await assert.rejects(client.availability({timeMin: "2026-11-02T14:00:00Z", timeMax: "2026-11-02T16:00:00Z", ...query}), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "invalid_query");
  }
});

test("consent uses the configured owner and exposes only the consent URL", async () => {
  const client = createCalendarClient({environment, startAuthorization: async (connector, params, options) => {
    assert.equal(connector, "google/synthetic-calendar");
    assert.deepEqual(params.subject, {type: "user", id: "synthetic-owner"});
    assert.equal(options?.callbackUrl, "http://127.0.0.1:3000/assistant?calendar=connected");
    return {url: "https://vercel.com/connect/authorize/synthetic", verifier: "must-stay-private", request: "must-stay-private"};
  }});
  assert.equal(await client.authorizationUrl("http://127.0.0.1:3000/assistant?calendar=connected"), "https://vercel.com/connect/authorize/synthetic");
});

test("calendar status and consent endpoints reject unauthenticated remote requests", async () => {
  for (const response of [await GET(new Request("https://example.test/api/assistant/calendar")), await authorize(new Request("https://example.test/api/assistant/calendar/authorize", {method: "POST"}))]) {
    assert.ok(response.status === 401 || response.status === 503);
    const body = await response.text();
    assert.equal(body.includes("events"), false);
    assert.equal(body.includes("ASSISTANT_GOOGLE_CONNECTOR"), false);
  }
});

const eventDraft: CalendarEventDraft = {
  summary: "Synthetic assistant write test",
  description: "Fictional event used only by provider fixtures.",
  start: "2026-11-03T10:00:00-05:00",
  end: "2026-11-03T10:30:00-05:00",
  timeZone: "America/Toronto",
};
const writeEnvironment = () => ({...environment(), ASSISTANT_CALENDAR_ID: "primary", ASSISTANT_CALENDAR_WRITE_ENABLED: "true", ASSISTANT_CALENDAR_OWNER_EMAIL: "fictional-owner@example.test"});

test("write-disabled and non-primary installations cannot call Google mutation endpoints", async () => {
  let networkCalls = 0;
  for (const env of [environment(), {...writeEnvironment(), ASSISTANT_CALENDAR_ID: "another-calendar"}]) {
    const client = createCalendarClient({environment: () => env, now: fixedNow, getToken: async () => {networkCalls++; return "synthetic-token";}});
    await assert.rejects(client.createManagedEvent(eventDraft, "synthetic-action-id"), (error: unknown) => error instanceof CalendarIntegrationError && ["write_disabled", "primary_only"].includes(error.code));
    await assert.rejects(client.deleteManagedEvent("synthetic-action-id"), CalendarIntegrationError);
  }
  assert.equal(networkCalls, 0);
});

test("write mode requires a valid pinned owner before status, consent, reads, or writes can request a token", async () => {
  let tokenCalls = 0;
  let providerCalls = 0;
  let consentCalls = 0;
  for (const email of [undefined, "", "not-an-email"]) {
    const client = createCalendarClient({
      environment: () => ({...writeEnvironment(), ASSISTANT_CALENDAR_OWNER_EMAIL: email}), now: fixedNow,
      getToken: async () => {tokenCalls++; return "synthetic-token";},
      startAuthorization: async () => {consentCalls++; return {url: "https://vercel.com/synthetic", request: "synthetic", verifier: "synthetic"};},
      fetch: async () => {providerCalls++; return Response.json({});},
    });
    const state = await client.overview();
    assert.equal(state.status.state, "not_configured");
    assert.equal(state.status.writeEnabled, true);
    assert.equal(state.status.capabilities.createEvent, false);
    assert.match(state.status.message, /ASSISTANT_CALENDAR_OWNER_EMAIL/);
    await assert.rejects(client.authorizationUrl("http://localhost:3000/assistant"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "not_configured");
    await assert.rejects(client.createManagedEvent(eventDraft, "synthetic-action-id"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "not_configured");
    await assert.rejects(client.deleteManagedEvent("synthetic-action-id"), CalendarIntegrationError);
  }
  assert.equal(tokenCalls, 0);
  assert.equal(providerCalls, 0);
  assert.equal(consentCalls, 0);
});

test("drafts reject attendees, hidden calendar selectors, invalid zones, duration, and unsafe dates", async () => {
  const invalid = [
    {...eventDraft, attendees: [{email: "not-invited@example.test"}]},
    {...eventDraft, conferenceData: {createRequest: {requestId: "synthetic"}}},
    {...eventDraft, calendarId: "some-other-calendar"},
    {...eventDraft, summary: "x".repeat(161)},
    {...eventDraft, description: "x".repeat(2001)},
    {...eventDraft, start: "2026-11-03T10:00:00"},
    {...eventDraft, end: "2026-11-03T10:01:00-05:00"},
    {...eventDraft, end: "2026-11-03T10:30:30-05:00"},
    {...eventDraft, end: "2026-11-03T19:00:00-05:00"},
    {...eventDraft, timeZone: "Mars/Olympus"},
  ];
  let networkCalls = 0;
  const client = createCalendarClient({environment: writeEnvironment, now: fixedNow, getToken: async () => {networkCalls++; return "synthetic-token";}});
  for (const draft of invalid) {
    assert.equal(calendarEventDraftSchema.safeParse(draft).success, false);
    await assert.rejects(client.createManagedEvent(draft, "synthetic-action-id"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "invalid_draft");
  }
  for (const draft of [
    {...eventDraft, start: "2026-11-01T10:00:00Z", end: "2026-11-01T10:30:00Z"},
    {...eventDraft, start: "2027-11-04T10:00:00Z", end: "2027-11-04T10:30:00Z"},
  ]) assert.throws(() => validateCalendarEventDraft(draft, fixedNow()));
  assert.equal(networkCalls, 0);
});

test("a configured owner mismatch fails before reading event details or creating/deleting anything", async () => {
  const paths: string[] = [];
  const client = createCalendarClient({environment: writeEnvironment, now: fixedNow, getToken: async () => "synthetic-token", fetch: async input => {
    paths.push(new URL(String(input)).pathname);
    return Response.json({id: "different-owner@example.test"});
  }});
  const overview = await client.overview();
  assert.equal(overview.status.state, "authorization_required");
  assert.equal(overview.status.writeEnabled, true);
  assert.equal(overview.status.capabilities.createEvent, false);
  assert.equal(overview.status.ownerEmail, undefined);
  assert.equal(overview.events.length, 0);
  await assert.rejects(client.createManagedEvent(eventDraft, "synthetic-action-id"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "owner_mismatch");
  await assert.rejects(client.deleteManagedEvent("synthetic-action-id"), CalendarIntegrationError);
  assert.equal(paths.length, 3);
  assert.ok(paths.every(path => path.endsWith("/calendars/primary")));
  assert.equal(JSON.stringify(overview).includes("different-owner@example.test"), false);
});

test("creation uses private attendee-free payload, stable event ID, verified owner, and readback; 409 reuses only the same exact event", async () => {
  let persisted: Record<string, unknown> | undefined;
  let posts = 0;
  let reads = 0;
  const client = createCalendarClient({environment: writeEnvironment, now: fixedNow, getToken: async (_connector, params) => {
    assert.deepEqual(params.scopes, [CALENDAR_READ_SCOPE, CALENDAR_OWNED_EVENTS_SCOPE]);
    return "synthetic-token";
  }, fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/calendars/primary")) return Response.json({id: "fictional-owner@example.test"});
    if (init?.method === "POST") {
      posts++;
      assert.equal(url.searchParams.get("sendUpdates"), "none");
      assert.equal(url.searchParams.get("conferenceDataVersion"), "0");
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.id, managedCalendarEventId("synthetic-action-id", writeEnvironment()));
      assert.match(payload.id, /^[a-f0-9]{64}$/);
      assert.equal(payload.visibility, "private");
      assert.deepEqual(payload.reminders, {useDefault: false});
      assert.equal("attendees" in payload, false);
      assert.equal("conferenceData" in payload, false);
      assert.equal("calendarId" in payload, false);
      if (persisted) return Response.json({error: "already exists"}, {status: 409});
      persisted = {...payload, status: "confirmed", etag: '"synthetic-v1"', htmlLink: "https://calendar.google.com/calendar/event?eid=synthetic"};
      return Response.json(persisted, {status: 201});
    }
    reads++;
    assert.ok(url.pathname.endsWith(String(persisted?.id)));
    return Response.json(persisted);
  }});
  const first = await client.createManagedEvent(eventDraft, "synthetic-action-id");
  const repeated = await client.createManagedEvent(eventDraft, "synthetic-action-id");
  assert.equal(posts, 2);
  assert.equal(reads, 2);
  assert.equal(first.id, repeated.id);
  assert.equal(first.reused, false);
  assert.equal(repeated.reused, true);
  assert.equal(first.managed, true);
  assert.equal(first.start, "2026-11-03T15:00:00.000Z");
  assert.equal(JSON.stringify(first).includes("synthetic-token"), false);
  await assert.rejects(client.createManagedEvent({...eventDraft, summary: "A changed proposal"}, "synthetic-action-id"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "conflict");
  assert.equal(persisted?.summary, eventDraft.summary);
});

test("a forged or changed record cannot satisfy a retry or authorize managed cleanup", async () => {
  const eventId = managedCalendarEventId("synthetic-action-id", writeEnvironment());
  let deletions = 0;
  const client = createCalendarClient({environment: writeEnvironment, now: fixedNow, getToken: async () => "synthetic-token", fetch: async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("/calendars/primary")) return Response.json({id: "fictional-owner@example.test"});
    if (init?.method === "POST") return Response.json({}, {status: 409});
    if (init?.method === "DELETE") {deletions++; return new Response(null, {status: 204});}
    return Response.json({id: eventId, summary: eventDraft.summary, start: {dateTime: eventDraft.start, timeZone: eventDraft.timeZone}, end: {dateTime: eventDraft.end, timeZone: eventDraft.timeZone}, etag: '"synthetic-v1"', extendedProperties: {private: {assistantManaged: "v1", assistantOwner: "wrong-owner", assistantPayload: "a".repeat(64)}}});
  }});
  await assert.rejects(client.createManagedEvent(eventDraft, "synthetic-action-id"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "not_managed");
  await assert.rejects(client.deleteManagedEvent("synthetic-action-id"), CalendarIntegrationError);
  assert.equal(deletions, 0);
});

test("managed cleanup uses a conditional delete and disables notifications", async () => {
  let persisted: Record<string, unknown> | undefined;
  let deleted = false;
  const client = createCalendarClient({environment: writeEnvironment, now: fixedNow, getToken: async () => "synthetic-token", fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/calendars/primary")) return Response.json({id: "fictional-owner@example.test"});
    if (init?.method === "POST") {
      persisted = {...JSON.parse(String(init.body)), etag: '"synthetic-v1"'};
      return Response.json(persisted, {status: 201});
    }
    if (init?.method === "DELETE") {
      assert.equal(url.searchParams.get("sendUpdates"), "none");
      assert.equal(new Headers(init.headers).get("If-Match"), '"synthetic-v1"');
      deleted = true;
      return new Response(null, {status: 204});
    }
    return deleted ? Response.json({}, {status: 410}) : Response.json(persisted);
  }});
  const created = await client.createManagedEvent(eventDraft, "synthetic-cleanup-action");
  const result = await client.deleteManagedEvent("synthetic-cleanup-action");
  assert.equal(result.id, created.id);
  assert.equal(result.deleted, true);
  assert.equal(result.alreadyAbsent, false);
  assert.equal((await client.deleteManagedEvent("synthetic-cleanup-action")).alreadyAbsent, true);
});

test("managed cleanup refuses a user-modified event even when its original application marker remains", async () => {
  let persisted: Record<string, unknown> | undefined;
  let deletions = 0;
  const client = createCalendarClient({environment: writeEnvironment, now: fixedNow, getToken: async () => "synthetic-token", fetch: async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("/calendars/primary")) return Response.json({id: "fictional-owner@example.test"});
    if (init?.method === "POST") {
      persisted = {...JSON.parse(String(init.body)), etag: '"synthetic-v1"'};
      return Response.json(persisted, {status: 201});
    }
    if (init?.method === "DELETE") {deletions++; return new Response(null, {status: 204});}
    return Response.json(persisted);
  }});
  await client.createManagedEvent(eventDraft, "synthetic-modified-cleanup");
  persisted!.summary = "The owner changed this event";
  await assert.rejects(client.deleteManagedEvent("synthetic-modified-cleanup"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "conflict");
  assert.equal(deletions, 0);
});

test("managed cleanup and retries reject changed privacy, reminders, recurrence, or conference settings", async () => {
  for (const change of [
    {visibility: "default"},
    {reminders: {useDefault: true}},
    {reminders: {useDefault: false, overrides: [{method: "email", minutes: 30}]}},
    {recurrence: ["RRULE:FREQ=DAILY"]},
    {recurringEventId: "synthetic-parent"},
    {originalStartTime: {dateTime: eventDraft.start}},
    {attendees: [{email: "not-invited@example.test"}]},
    {conferenceData: {conferenceId: "synthetic-conference"}},
    {hangoutLink: "https://meet.google.com/synthetic"},
  ]) {
    let persisted: Record<string, unknown> | undefined;
    let deletions = 0;
    const client = createCalendarClient({environment: writeEnvironment, now: fixedNow, getToken: async () => "synthetic-token", fetch: async (input, init) => {
      if (new URL(String(input)).pathname.endsWith("/calendars/primary")) return Response.json({id: "fictional-owner@example.test"});
      if (init?.method === "POST") {
        if (persisted) return Response.json({}, {status: 409});
        persisted = {...JSON.parse(String(init.body)), etag: '"synthetic-v1"'};
        return Response.json(persisted, {status: 201});
      }
      if (init?.method === "DELETE") {deletions++; return new Response(null, {status: 204});}
      return Response.json(persisted);
    }});
    await client.createManagedEvent(eventDraft, "synthetic-settings-cleanup");
    Object.assign(persisted!, change);
    await assert.rejects(client.createManagedEvent(eventDraft, "synthetic-settings-cleanup"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "conflict");
    await assert.rejects(client.deleteManagedEvent("synthetic-settings-cleanup"), (error: unknown) => error instanceof CalendarIntegrationError && error.code === "conflict");
    assert.equal(deletions, 0);
  }
});

test("write mode requires combined-scope consent and reports verified owner identity only on success", async () => {
  let requestedScopes: string[] | undefined;
  const client = createCalendarClient({environment: writeEnvironment, getToken: async (_connector, params) => {
    requestedScopes = params.scopes;
    throw new UserAuthorizationRequiredError("synthetic missing write grant");
  }});
  const result = await client.overview();
  assert.deepEqual(requestedScopes, [CALENDAR_READ_SCOPE, CALENDAR_OWNED_EVENTS_SCOPE]);
  assert.equal(result.status.state, "authorization_required");
  assert.equal(result.status.writeEnabled, true);
  assert.equal(result.status.capabilities.createEvent, false);
  assert.equal(result.status.ownerEmail, undefined);
});

test("calendar consent returns to the validated original browser Host without asserting success", () => {
  const request = new Request("http://localhost:3000/api/assistant/calendar/authorize", {headers: {host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000"}});
  const callback = new URL(calendarAuthorizationCallback(request));
  assert.equal(callback.origin, "http://localhost:3000");
  assert.equal(callback.pathname, "/api/assistant/calendar/return");
  assert.equal(callback.searchParams.get("origin"), "http://127.0.0.1:3000");
  assert.equal(calendarReturnDestination(new Request(callback), {NODE_ENV: "development"}), "http://127.0.0.1:3000/assistant?view=connections&calendar=return");
  assert.throws(() => calendarAuthorizationCallback(new Request(request.url, {headers: {host: "attacker.example"}})));
  assert.throws(() => calendarAuthorizationCallback(new Request(request.url, {headers: {host: "127.0.0.1:3000", origin: "https://attacker.example"}})));
});

test("the local calendar return bridge rejects external, changed-port, credential-bearing, and production redirects", () => {
  const base = "http://localhost:3000/api/assistant/calendar/return";
  for (const origin of ["https://attacker.example", "http://127.0.0.1:4000", "http://user@127.0.0.1:3000", "http://127.0.0.1:3000/extra", "http://127.0.0.1:3000?secret=value"]) {
    const url = new URL(base); url.searchParams.set("origin", origin);
    assert.throws(() => calendarReturnDestination(new Request(url), {NODE_ENV: "development"}));
  }
  const url = new URL(base); url.searchParams.set("origin", "http://127.0.0.1:3000");
  assert.throws(() => calendarReturnDestination(new Request(url), {NODE_ENV: "production"}));
  assert.throws(() => calendarReturnDestination(new Request(url, {headers: {host: "attacker.example"}}), {NODE_ENV: "development"}));
  assert.equal(calendarAuthorizationCallback(new Request("https://demo.example/api/assistant/calendar/authorize", {headers: {host: "demo.example"}})), "https://demo.example/assistant?view=connections&calendar=return");
});

test("each signed-in actor gets a distinct OAuth subject, primary calendar, verified owner, and event ID", async () => {
  const actors: AssistantActor[] = [
    {id: "google:synthetic-user-a", email: "synthetic-a@workspace.example"},
    {id: "google:synthetic-user-b", email: "synthetic-b@workspace.example"},
    {id: "google:synthetic-user-c", email: "synthetic-c@example.test"},
  ];
  const subjects: string[] = [];
  const authorized: string[] = [];
  const ids: string[] = [];
  for (const actor of actors) {
    const client = createCalendarClientForActor(actor, {
      // Legacy configuration must be ignored even when it remains locally present.
      environment: () => ({...writeEnvironment(), ASSISTANT_GOOGLE_SUBJECT_ID: "assistant-owner", ASSISTANT_CALENDAR_OWNER_EMAIL: "legacy@example.test", ASSISTANT_CALENDAR_ID: "legacy-calendar"}),
      getToken: async (_connector, params) => {
        assert.deepEqual(params.subject, {type: "user", id: actor.id});
        subjects.push(actor.id);
        return "synthetic-token";
      },
      startAuthorization: async (_connector, params) => {
        assert.deepEqual(params.subject, {type: "user", id: actor.id});
        authorized.push(actor.id);
        return {url: "https://vercel.com/connect/synthetic-consent", request: "synthetic", verifier: "synthetic"};
      },
      fetch: async input => {
        const url = new URL(String(input));
        assert.equal(url.pathname.includes("legacy-calendar"), false);
        if (url.pathname.endsWith("/calendars/primary")) return Response.json({id: actor.email});
        assert.match(url.pathname, /\/calendars\/primary\/events$/);
        return Response.json({...eventFixture, items: [{id: actor.id, summary: "Synthetic private event for " + actor.id, start: {dateTime: eventDraft.start}, end: {dateTime: eventDraft.end}}]});
      },
    });
    const overview = await client.overview();
    assert.equal(overview.status.state, "connected");
    assert.equal(overview.status.ownerEmail, actor.email);
    assert.equal(overview.status.capabilities.createEvent, true);
    assert.equal(overview.events.length, 1);
    assert.equal(overview.events[0].id, actor.id);
    await client.authorizationUrl("http://localhost:3000/assistant");
    ids.push(managedCalendarEventIdForActor(actor, "same-synthetic-action"));
  }
  assert.deepEqual([...new Set(subjects)], actors.map(actor => actor.id));
  assert.deepEqual(authorized, actors.map(actor => actor.id));
  assert.equal(new Set(ids).size, actors.length);
});

test("actor-bound clients cannot use the legacy grant or expose a different account's events", async () => {
  const actor = {id: "google:synthetic-user-a", email: "synthetic-a@workspace.example"};
  let eventReads = 0;
  const client = createCalendarClientForActor(actor, {environment: writeEnvironment, getToken: async (_connector, params) => {
    assert.deepEqual(params.subject, {type: "user", id: actor.id});
    assert.notEqual(params.subject.type === "user" && params.subject.id, "assistant-owner");
    return "synthetic-token";
  }, fetch: async input => {
    if (!new URL(String(input)).pathname.endsWith("/calendars/primary")) eventReads++;
    return Response.json({id: "synthetic-b@workspace.example"});
  }});
  const result = await client.overview();
  assert.equal(result.status.state, "authorization_required");
  assert.equal(result.status.ownerEmail, undefined);
  assert.equal(result.events.length, 0);
  assert.equal(eventReads, 0);
  let called = false;
  for (const candidate of [undefined, {id: "assistant-owner", email: actor.email}, {id: actor.id, email: "not-an-email"}]) {
    assert.throws(() => createCalendarClientForActor(candidate as AssistantActor, {getToken: async () => {called = true; return "synthetic";}}), CalendarIntegrationError);
  }
  assert.equal(called, false);
});
