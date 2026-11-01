import { expect, test } from "bun:test";
import { rehearsalBrief, rehearsalContext } from "../../lib/assistant/demonstration";

function runScenario(scenario: string) {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/assistant-demonstration.ts", scenario],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe", timeout: scenario === "live-http" ? 110_000 : 10_000 },
  );
  if (result.exitCode !== 0)
    throw new Error(`Demonstration scenario ${scenario} failed: ${new TextDecoder().decode(result.stderr)}`);
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

test("synthetic source changes preserve source identities and change the actual preparation context", () => {
  const initial = rehearsalContext(1);
  const changed = rehearsalContext(2);
  expect(changed.sources.map((source) => source.id)).toEqual(initial.sources.map((source) => source.id));
  expect(changed.sources.map((source) => source.version)).toEqual(["2", "1"]);
  expect(changed.key).not.toBe(initial.key);
  const preference = { bulletCount: 3 as const, includeLinks: false };
  expect(rehearsalBrief(changed, preference)).toContain("revised accessibility audit");
  expect(rehearsalBrief(initial, preference)).not.toContain("revised accessibility audit");
});

test("actual rehearsal preparation follows requested brief length and discloses fixture sources", () => {
  for (const bulletCount of [3, 5] as const) {
    const brief = rehearsalBrief(rehearsalContext(1), { bulletCount, includeLinks: true });
    expect(brief.match(/^- /gm)).toHaveLength(bulletCount);
    expect(brief).toContain("These are rehearsal fixtures");
    expect(brief).toContain("synthetic-design-review");
  }
});

test("guided advance executes one real phase and preserves the owner review boundary", () => {
  expect(runScenario("step-through")).toEqual({
    case: "step-through",
    sourceReads: 1,
    briefs: 1,
    deliveries: 1,
    externalCalls: 0,
  });
});

test("durable playback is paced, pause wins the pending timer, and approval is never automatic", () => {
  expect(runScenario("play-pause")).toEqual({
    case: "play-pause", pausedTimerCannotAdvance: true, ownerApprovalNeverAutomated: true, externalCalls: 0,
  });
});

test("play to a stage runs the stages before it and pauses before that stage runs", () => {
  expect(runScenario("play-to-stage")).toEqual({
    case: "play-to-stage", pausedBeforeStage: true, stopIsSpentAfterPause: true, externalCalls: 0,
  });
});

test("an accepted pause still stops at the next gate when its delivery loses the timer race", () => {
  expect(runScenario("delayed-pause")).toEqual({
    case: "delayed-pause", pausesAtNextGate: true, noUnrequestedBrief: true, externalCalls: 0,
  });
});

test("cooperative playback pause accepts a real prior gate but rejects a forged gate identity", () => {
  expect(runScenario("forged-pause")).toEqual({
    case: "forged-pause", forgedCheckpointIgnored: true, knownCheckpointPauses: true, externalCalls: 0,
  });
});

test("replay suppresses duplicate delivery, monitoring pauses, and a source change produces a fresh brief", () => {
  expect(runScenario("replay-change")).toEqual({
    case: "replay-change", sourceReads: 4, deduplicated: 2, deliveries: 2, externalCalls: 0,
  });
});

test("restarting delivery restores context but cannot inherit the original owner approval", () => {
  expect(runScenario("restart-delivery")).toEqual({
    case: "restart-delivery", originalApprovalCannotDeliver: true, context: "explicitly-restored", externalCalls: 0,
  });
});

test("restored monitoring respects maxChecks and old timers cannot start a fourth source read", () => {
  expect(runScenario("check-limit")).toEqual({
    case: "check-limit", sourceReads: 3, deduplicated: 3, noFourthRead: true, externalCalls: 0,
  });
});

test("a restarted calendar proposal requires fresh approval and retains its original provider action identity", () => {
  expect(runScenario("restart-calendar-write")).toEqual({
    case: "restart-calendar-write", freshOwnerApproval: true, identity: "original-action", providerAttempts: 1, externalCalls: 0,
  });
});

test("a restored live review preserves its full source key and deduplicates the next unchanged Calendar read without synthesis", () => {
  expect(runScenario("restored-live-review")).toEqual({
    case: "restored-live-review", calendarReads: 1, modelCalls: 0, deliveries: 1, deduplicated: 1, generatedBriefs: 0, externalCalls: 0,
  });
});

test.skipIf(process.env.ASSISTANT_DEMONSTRATION_HTTP !== "1")(
  "guided workflow persists and resumes through the real local HTTP runtime",
  () => {
    expect(runScenario("live-http")).toMatchObject({
      case: "live-http",
      runtime: "actual-next-workflow",
      phases: "read-prepare-review-deliver-watch-complete",
      approval: "fresh-owner-gate",
      pause: "stable-after-pending-timer",
      restart: "new-owned-run-preserves-parent-history",
      deliveries: 1,
      status: "completed",
    });
  },
  120_000,
);

test("a calendar watch messages only the owner once, sleeps until its own next check, and stays quiet when nothing changed", () => {
  expect(runScenario("calendar-watch")).toEqual({
    case: "calendar-watch", calendarScans: 2, notices: 2, messages: 1, approvals: 0, modelCalls: 0, externalCalls: 0,
  });
});
