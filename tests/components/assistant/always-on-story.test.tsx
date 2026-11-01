import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AlwaysOnStory } from "@/components/assistant/always-on-story";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  storyApprovedBefore,
  storyCopy,
  storyIndex,
  storyMissed,
  storyNext,
  storyPasses,
  storyScenarios,
  storySeek,
  storyStageMap,
  storySteps,
} from "@/lib/assistant/always-on-story";

const at = (id: string) => storyIndex(id);
const stage = (index: number, id: string, decisions = {}) =>
  storyStageMap(index, decisions, false).stages.find((item) => item.id === id)!;

describe("always-on story script", () => {
  test("every step is unique, belongs to a check, and every scenario spans real steps", () => {
    expect(new Set(storySteps.map((step) => step.id)).size).toBe(storySteps.length);
    for (const step of storySteps) expect(storyPasses[step.pass]).toBeDefined();
    for (const scenario of storyScenarios) {
      expect(at(scenario.start)).toBeGreaterThanOrEqual(0);
      expect(at(scenario.end)).toBeGreaterThanOrEqual(at(scenario.start));
    }
  });

  test("it shows each always-on behaviour: its own schedule, blind spots, open loops, and an email wake-up", () => {
    expect(storySteps.some((step) => step.schedule?.every((check) => /^\d+ \d+ \* \* [A-Z]{3}$/.test(check.cron)))).toBe(true);
    const insights = storySteps.flatMap((step) => step.insights ?? []);
    expect(insights.some((item) => item.kind === "blind_spot")).toBe(true);
    expect(insights.some((item) => item.kind === "open_loop" && item.status === "resolved")).toBe(true);
    expect(storyPasses.map((pass) => pass.trigger)).toEqual(
      expect.arrayContaining(["request", "schedule", "event"]),
    );
    // Only the first check is a request; the rest the agent starts itself.
    expect(storyPasses.filter((pass) => pass.trigger === "request")).toHaveLength(1);
  });

  test("anything sent to another person waits for a decision, and declining changes what is reported", () => {
    for (const step of storySteps.filter((item) => item.decision)) {
      const report = storySteps.find((item) => item.ifDeclined?.decisionId === step.id);
      expect(report).toBeDefined();
      expect(storyCopy(report!, { [step.id]: "declined" }).title).toBe(report!.ifDeclined!.title);
      expect(storyCopy(report!, { [step.id]: "approved" }).title).toBe(report!.title);
    }
  });

  test("playback stops at an undecided decision, and seeking can't skip past one", () => {
    const review = at("review-1");
    expect(storyNext(review, {})).toBeUndefined();
    expect(storyNext(review, { "review-1": "approved" })).toBe(review + 1);
    expect(storySeek(at("finish"), {})).toBe(review);
    const approved = storyApprovedBefore(at("read-5"), {});
    expect(storySeek(at("read-5"), approved)).toBe(at("read-5"));
    expect(storyNext(at("finish"), approved)).toBeUndefined();
  });

  test("the diagram follows the story: your turn, sleeping, skips, and the end", () => {
    expect(stage(at("review-1"), "review")).toMatchObject({ state: "waiting", stateLabel: "Your turn" });
    expect(stage(at("watch-1"), "watch")).toMatchObject({ state: "sleeping", stateLabel: "Asleep until Tue 9:00 AM" });
    expect(stage(at("deliver-1"), "review", { "review-1": "declined" })).toMatchObject({ state: "declined" });
    // A reminder to you needs no draft or approval.
    expect(stage(at("deliver-4"), "prepare")).toMatchObject({ state: "skipped", fact: "Just a reminder to you" });
    expect(stage(at("finish"), "finish")).toMatchObject({ state: "done" });
    expect(stage(at("finish"), "read")).toMatchObject({ state: "skipped", fact: "Goal done" });
    expect(stage(at("watch-1"), "notice").fact).toBe("3 blind spots · 2 open loops");
  });

  test("a task agent misses nothing on Monday, then everything after it stops", () => {
    expect(storyMissed(at("watch-1"))).toEqual([]);
    expect(storyMissed(at("read-3"))).toContain("Sam’s reply");
    expect(storyMissed(at("finish")).length).toBeGreaterThan(4);
  });
});

describe("always-on story view", () => {
  test("it is labelled as a mock and keeps scenarios and the comparison one click away", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AlwaysOnStory active={false} />
      </TooltipProvider>,
    );
    expect(html).toContain("Mocked story");
    expect(html).toContain("Nothing is read or sent.");
    expect(html).toContain('aria-label="Scenario"');
    expect(html).toContain("Jump to a scenario");
    expect(html).toContain('aria-label="Agent loop stages"');
    expect(html).toContain("Prepare me for Thursday’s product design review.");
    expect(html).toContain('aria-label="Play to here: Read"');
    expect(html).toContain("Compare with a task agent");
    // Folded away until asked for.
    expect(html).not.toContain("Chases replies and deadlines until they close");
    // Only the stage in focus is described; the rest are just names.
    expect(html).toContain("Your request · Mon 4:00 PM");
    expect(html).not.toContain("Calendar, notes and inbox");
  });
});
