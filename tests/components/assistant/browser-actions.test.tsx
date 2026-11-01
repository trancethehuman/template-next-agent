import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowserActionRow } from "@/components/assistant/assistant-chat";
import { browserSleepNote, browserSubtitle } from "@/components/assistant/browser-view";
import { ChatSplit } from "@/components/assistant/chat-split";
import {
  browserActionLabel,
  browserInputSchema,
  browserUrl,
  looksLikeCardNumber,
  browserKeys,
  browserRef,
} from "@/lib/assistant/browser-actions";
import {
  assistantModel,
  assistantModelFromCookie,
  defaultAssistantModel,
} from "@/lib/assistant/models";
import { assistantTaskSchema } from "@/lib/assistant/task-policy";

describe("browser action rules", () => {
  test("keys map to the names agent-browser accepts, and anything unknown is refused", () => {
    expect(browserKeys("enter")).toBe("Enter");
    expect(browserKeys("ctrl+a")).toBe("Control+a");
    expect(browserKeys("pagedown")).toBe("PageDown");
    expect(browserKeys("cmd+L")).toBe("Control+l");
    expect(browserKeys("F5")).toBe("F5");
    expect(browserKeys("rm -rf")).toBeUndefined();
    expect(browserKeys("")).toBeUndefined();
  });

  test("element refs come only from snapshots, written like @e12", () => {
    expect(browserRef("e12")).toBe("@e12");
    expect(browserRef(" @e3 ")).toBe("@e3");
    expect(browserRef("button.submit")).toBeUndefined();
    expect(browserRef("@e3; rm -rf /")).toBeUndefined();
    expect(browserRef(undefined)).toBeUndefined();
  });

  test("card-shaped numbers are caught, while dates, prices, and phone numbers are not", () => {
    expect(looksLikeCardNumber("4242 4242 4242 4242")).toBe(true);
    expect(looksLikeCardNumber("5555-5555-5555-4444")).toBe(true);
    expect(looksLikeCardNumber("Raptors vs Celtics, Nov 14 2026, $89.50")).toBe(false);
    expect(looksLikeCardNumber("+1 647 555 0199")).toBe(false);
    expect(looksLikeCardNumber("1234 5678 9012 3456")).toBe(false);
  });

  test("only web addresses open, and bare domains get https", () => {
    expect(browserUrl("ticketmaster.ca")).toBe("https://ticketmaster.ca/");
    expect(browserUrl("http://example.com/x")).toBe("http://example.com/x");
    expect(browserUrl("file:///etc/passwd")).toBeUndefined();
    expect(browserUrl("javascript:alert(1)")).toBeUndefined();
  });

  test("inputs stay bounded", () => {
    expect(browserInputSchema.safeParse({ action: "click", ref: "@e3" }).success).toBe(true);
    expect(browserInputSchema.safeParse({ action: "scroll", amount: 50_000 }).success).toBe(false);
    expect(browserInputSchema.safeParse({ action: "wait", seconds: 30 }).success).toBe(false);
  });

  test("the chat names each action plainly", () => {
    expect(browserActionLabel({ action: "click", ref: "@e3" })).toEqual({ label: "Clicking", detail: "@e3" });
    expect(browserActionLabel({ action: "fill", ref: "@e5", text: "Raptors" })).toEqual({ label: "Filling", detail: "@e5 “Raptors”" });
    expect(browserActionLabel({ action: "click", ref: "e182" })).toEqual({ label: "Clicking", detail: "@e182" });
    expect(browserActionLabel({ action: "navigate", url: "https://example.com" })).toEqual({ label: "Opening", detail: "https://example.com" });
    expect(browserActionLabel({ action: "type", text: "Raptors" })).toEqual({ label: "Typing", detail: "“Raptors”" });
  });
});

describe("browser action rows", () => {
  test("a finished action shows its label, detail, and done state", () => {
    const html = renderToStaticMarkup(
      <BrowserActionRow input={{ action: "click", ref: "@e7" }} output={{ action: "click", summary: "Clicked @e7" }} state="output-available" />,
    );
    expect(html).toContain("Clicking");
    expect(html).toContain("@e7");
    expect(html).toContain('aria-label="Done"');
    expect(html).not.toContain("<img");
  });

  test("every action that captured the page shows its screenshot, which opens full size", () => {
    const shot = renderToStaticMarkup(
      <BrowserActionRow input={{ action: "click", ref: "@e2" }} output={{ action: "click", summary: "Clicked @e2", title: "Raptors tickets", screenshot: "c3ludGhldGlj" }} state="output-available" />,
    );
    expect(shot).toContain("Enlarge: Screenshot of Raptors tickets");
    expect(shot).toContain("data:image/jpeg;base64,c3ludGhldGlj");
    const refused = renderToStaticMarkup(
      <BrowserActionRow input={{ action: "fill", ref: "@e4", text: "4242" }} output={{ action: "fill", summary: "Refused: that looks like a payment card number.", error: "Refused" }} state="output-available" />,
    );
    expect(refused).toContain("Refused: that looks like a payment card number.");
    expect(refused).toContain('aria-label="Not done"');
  });
});

describe("browser panel", () => {
  test("the header names the page in front, or what the browser is doing", () => {
    const live = { state: "live", viewUrl: "https://example.test/view", controlUrl: "https://example.test/control" } as const;
    expect(browserSubtitle({ ...live, page: { title: "Raptors tickets", url: "https://example.com" } })).toBe("Raptors tickets");
    expect(browserSubtitle({ ...live, page: { title: "Raptors tickets", url: "https://example.com" } }, "stop")).toBe("Saving…");
    expect(browserSubtitle({ state: "stopped", saved: true })).toBe("Asleep, tabs saved");
    expect(browserSubtitle({ state: "off" }, "open")).toBe("Starting…");
    expect(browserSubtitle({ state: "starting" })).toBe("Starting…");
    expect(browserSubtitle({ state: "off" })).toBe("Off");
  });

  test("Keep awake is offered only when a live browser is about to sleep", () => {
    const checkedAt = Date.parse("2026-11-01T12:00:00Z");
    const live = (minutes: number) => ({ state: "live", viewUrl: "v", controlUrl: "c", sleepsAt: new Date(checkedAt + minutes * 60_000).toISOString() }) as const;
    expect(browserSleepNote(live(3), checkedAt)?.soon).toBe(true);
    expect(browserSleepNote(live(20), checkedAt)?.soon).toBe(false);
    expect(browserSleepNote(live(20), checkedAt)?.at).toBeTruthy();
    expect(browserSleepNote({ state: "stopped", saved: true }, checkedAt)).toBeUndefined();
    expect(browserSleepNote(undefined, checkedAt)).toBeUndefined();
  });

  test("the resizable split renders a placeholder on the server, without reading storage", () => {
    const html = renderToStaticMarkup(<ChatSplit chat={<p>Synthetic chat</p>} side={<p>Synthetic browser</p>} />);
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain("Synthetic chat");
  });
});

describe("assistant models", () => {
  test("GPT-6.1 Terra is the default, and only allow-listed choices are accepted", () => {
    expect(defaultAssistantModel).toBe("openai/gpt-6.1-terra");
    expect(assistantModel("anthropic/claude-sonnet-5.5")).toBe("anthropic/claude-sonnet-5.5");
    expect(assistantModel("evil/model")).toBe(defaultAssistantModel);
    expect(assistantModel(undefined)).toBe(defaultAssistantModel);
  });

  test("the cookie choice is read exactly, and anything else is ignored", () => {
    expect(assistantModelFromCookie("a=1; assistant-model=openai%2Fgpt-6-luna")).toBe("openai/gpt-6-luna");
    expect(assistantModelFromCookie("assistant-model=evil%2Fmodel")).toBeUndefined();
    expect(assistantModelFromCookie("assistant-model=%E0%A4%A")).toBeUndefined();
    expect(assistantModelFromCookie(null)).toBeUndefined();
  });

  test("a task can carry an allowed model for its brief, never an arbitrary one", () => {
    expect(assistantTaskSchema.parse({ model: "openai/gpt-6.1-sol" }).model).toBe("openai/gpt-6.1-sol");
    expect(assistantTaskSchema.safeParse({ model: "evil/model" }).success).toBe(false);
  });
});
