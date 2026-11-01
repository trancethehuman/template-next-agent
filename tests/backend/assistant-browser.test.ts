import { describe, expect, mock, test } from "bun:test";
import { assistantActorPrincipal, assistantGoogleAuth, requireAssistantContextActor } from "../../agent/lib/auth";
import type { AssistantActor } from "../../lib/auth/actor";

// Only the provider SDK is doubled; the browser library's own rules run for real.
const sandbox = {
  name: "assistant-browser-synthetic",
  status: "running" as string,
  healthy: true,
  currentSnapshotId: "snap_synthetic" as string | undefined,
  expiresAt: new Date(Date.now() + 60_000) as Date | undefined,
  extendedBy: 0,
  commands: [] as string[],
  async extendTimeout(ms: number) {
    sandbox.extendedBy += ms;
  },
  domain: (port: number) => `https://sb-synthetic-${port}.vercel.run`,
  async runCommand(options: { cmd: string; args: string[] }) {
    sandbox.commands.push([options.cmd, ...options.args].join(" "));
    const tabs = JSON.stringify([
      { type: "service_worker", url: "https://example.test/sw.js" },
      { type: "page", title: "Raptors tickets", url: "https://tickets.example.test/raptors" },
    ]);
    return { exitCode: sandbox.healthy ? 0 : 1, stdout: async () => tabs, stderr: async () => "" };
  },
  async stop() {
    sandbox.status = "stopped";
  },
};
let exists = true;
class APIError extends Error {
  constructor(public response: Response) {
    super("synthetic provider error");
  }
}
mock.module("@vercel/sandbox", () => ({
  APIError,
  Sandbox: {
    get: async () => {
      if (!exists) throw new APIError(new Response(null, { status: 404 }));
      return sandbox;
    },
    getOrCreate: async () => {
      throw new Error("A refused action must never start a browser");
    },
  },
}));
process.env.AUTH_SECRET = "synthetic-auth-secret-for-browser-tests-only";
const { browserPassword, browserSandboxName, browserStatus, frontPage, keepBrowserAlive, runBrowserAction, stopBrowser } = await import("../../lib/assistant/browser");

const owner = { id: "google:synthetic-browser-owner" };
const other = { id: "google:synthetic-browser-other" };

describe("cloud browser ownership", () => {
  test("each account gets its own stable sandbox name that does not reveal the account", () => {
    expect(browserSandboxName(owner)).toBe(browserSandboxName(owner));
    expect(browserSandboxName(owner)).not.toBe(browserSandboxName(other));
    expect(browserSandboxName(owner)).toMatch(/^assistant-browser-[a-f0-9]{24}$/);
    expect(browserSandboxName(owner)).not.toContain("synthetic");
  });

  test("the live view password is derived per sandbox from the server secret, never stored", () => {
    const name = browserSandboxName(owner);
    expect(browserPassword(name)).toHaveLength(8);
    expect(browserPassword(name)).toBe(browserPassword(name));
    expect(browserPassword(name)).not.toBe(browserPassword(browserSandboxName(other)));
    expect(() => browserPassword(name, "")).toThrow(/AUTH_SECRET/);
  });
});

describe("cloud browser actions", () => {
  test("refusals happen before any sandbox starts", async () => {
    const card = await runBrowserAction(owner, { action: "fill", ref: "@e4", text: "card 4242 4242 4242 4242 exp 12/30" });
    expect(card.error).toMatch(/payment card/);
    expect((await runBrowserAction(owner, { action: "type", text: "5555 5555 5555 4444" })).error).toMatch(/payment card/);
    expect((await runBrowserAction(owner, { action: "click" })).error).toMatch(/element ref/);
    expect((await runBrowserAction(owner, { action: "click", ref: "button.buy" })).error).toMatch(/element ref/);
    expect((await runBrowserAction(owner, { action: "select", ref: "@e2" })).error).toMatch(/value/);
    expect((await runBrowserAction(owner, { action: "navigate", url: "javascript:alert(1)" })).error).toMatch(/http/);
    expect((await runBrowserAction(owner, { action: "press", keys: "launch-missiles" })).error).toMatch(/Unknown key/);
    expect((await runBrowserAction(owner, { action: "fill", ref: "@e1" })).error).toMatch(/needs text/);
  });
});

describe("cloud browser status", () => {
  test("a live browser offers a watch-only view and a separate control view", async () => {
    exists = true;
    sandbox.status = "running";
    sandbox.healthy = true;
    const status = await browserStatus(owner);
    expect(status.state).toBe("live");
    if (status.state !== "live") return;
    expect(status.viewUrl).toStartWith("https://sb-synthetic-6080.vercel.run/vnc.html?");
    expect(status.viewUrl).toEndWith("&view_only=1");
    expect(status.controlUrl).toEndWith("&view_only=0");
    expect(status.viewUrl).toContain(`password=${encodeURIComponent(browserPassword(sandbox.name))}`);
    expect(status.page).toEqual({ title: "Raptors tickets", url: "https://tickets.example.test/raptors" });
    expect(status.sleepsAt).toBe(sandbox.expiresAt?.toISOString());
  });

  test("status never starts a browser, and reports starting, asleep, or off", async () => {
    sandbox.healthy = false;
    expect(await browserStatus(owner)).toEqual({ state: "starting" });
    sandbox.status = "pending";
    expect(await browserStatus(owner)).toEqual({ state: "starting" });
    sandbox.status = "stopped";
    expect(await browserStatus(owner)).toEqual({ state: "stopped", saved: true });
    sandbox.currentSnapshotId = undefined;
    expect(await browserStatus(owner)).toEqual({ state: "stopped", saved: false });
    sandbox.currentSnapshotId = "snap_synthetic";
    exists = false;
    expect(await browserStatus(owner)).toEqual({ state: "off" });
  });

  test("stop saves the tabs and closes Chrome cleanly before the disk is snapshotted", async () => {
    exists = true;
    sandbox.status = "running";
    sandbox.commands = [];
    await stopBrowser(owner);
    expect(sandbox.status).toBe("stopped");
    const shutdown = sandbox.commands.join("\n");
    expect(shutdown).toContain("json/list");
    expect(shutdown).toContain("pkill -TERM -x chrome");
    expect(shutdown.indexOf("json/list")).toBeLessThan(shutdown.indexOf("pkill"));
    exists = false;
    await stopBrowser(owner);
  });

  test("a deployment can turn the browser off", async () => {
    process.env.ASSISTANT_BROWSER_ENABLED = "false";
    try {
      expect(await browserStatus(owner)).toEqual({ state: "disabled" });
    } finally {
      delete process.env.ASSISTANT_BROWSER_ENABLED;
    }
  });
});

describe("chosen model on the signed-in principal", () => {
  const actor: AssistantActor = { id: "google:synthetic-model-user", email: "synthetic-model@agiventures.ca" };
  const auth = assistantGoogleAuth({
    session: async (request) => (request.headers.get("cookie")?.includes("synthetic-session=yes") ? actor : null),
    owner: async () => actor,
    proxyOrigin: async () => "https://assistant.example",
  });
  const request = (cookie: string) =>
    new Request("https://assistant.example/eve/v1/session", {
      method: "POST",
      headers: { origin: "https://assistant.example", cookie },
    });

  test("an allowed choice rides along without changing who the caller is", async () => {
    const principal = await auth(request("synthetic-session=yes; assistant-model=openai%2Fgpt-6.1-sol"));
    expect(principal).toEqual(assistantActorPrincipal(actor, "openai/gpt-6.1-sol"));
    const context = { session: { auth: { current: principal, initiator: assistantActorPrincipal(actor) } } };
    expect(requireAssistantContextActor(context as never)).toEqual(actor);
  });

  test("a missing or disallowed choice adds nothing, so the default model applies", async () => {
    expect(await auth(request("synthetic-session=yes"))).toEqual(assistantActorPrincipal(actor));
    expect(await auth(request("synthetic-session=yes; assistant-model=evil%2Fmodel"))).toEqual(assistantActorPrincipal(actor));
  });
});

describe("cloud browser keep-alive and saved state", () => {
  test("a watched browser gets more time only when it is close to sleeping, and never wakes", async () => {
    exists = true;
    sandbox.status = "running";
    sandbox.extendedBy = 0;
    sandbox.expiresAt = new Date(Date.now() + 60 * 60_000);
    await keepBrowserAlive(owner);
    expect(sandbox.extendedBy).toBe(0);
    sandbox.expiresAt = new Date(Date.now() + 60_000);
    await keepBrowserAlive(owner);
    expect(sandbox.extendedBy).toBeGreaterThan(0);
    sandbox.status = "stopped";
    sandbox.extendedBy = 0;
    await keepBrowserAlive(owner);
    expect(sandbox.extendedBy).toBe(0);
  });

  test("the page in front comes from Chrome's own tab list, skipping blank tabs and workers", () => {
    expect(frontPage(JSON.stringify([
      { type: "page", title: "New Tab", url: "chrome://newtab/" },
      { type: "page", title: "Event", url: "https://example.test/event" },
    ]))).toEqual({ title: "Event", url: "https://example.test/event" });
    expect(frontPage("not json")).toBeUndefined();
  });
});
