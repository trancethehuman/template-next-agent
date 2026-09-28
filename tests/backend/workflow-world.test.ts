import assert from "node:assert/strict";
import { mock, test } from "bun:test";

const calls: string[] = [];
let startOptions: unknown;

mock.module("workflow/runtime", () => ({
  getWorld: () => {
    throw new Error("Run routes must use the Workflow API's default world.");
  },
}));

mock.module("workflow/api", () => ({
  start: async (_workflow: unknown, _args: unknown, options?: unknown) => {
    calls.push("start");
    startOptions = options;
    return { runId: "wrun_synthetic" };
  },
  getRun: (runId: string) => {
    assert.equal(runId, "wrun_synthetic");
    calls.push("getRun");
    return {
      exists: Promise.resolve(true),
      getReadable: () =>
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue('{"type":"done","runId":"wrun_synthetic","status":"completed"}\n');
            controller.close();
          },
        }),
    };
  },
}));

const { POST } = await import("../../app/api/runs/route");
const { GET } = await import("../../app/api/runs/[runId]/stream/route");

test("run routes use Workflow API defaults beside EVE", async () => {
  const response = await POST(
    new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactions: [
          {
            id: "synthetic-1",
            date: "2026-09-28",
            description: "Synthetic transfer",
            amountMinor: -100,
            currency: "CAD",
          },
        ],
      }),
    }),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(calls, ["start"]);
  assert.equal(startOptions, undefined);
  assert.deepEqual(await response.json(), { runId: "wrun_synthetic" });

  calls.length = 0;
  const streamResponse = await GET(
    new Request("http://localhost/api/runs/wrun_synthetic/stream"),
    { params: Promise.resolve({ runId: "wrun_synthetic" }) },
  );

  assert.equal(streamResponse.status, 200);
  assert.deepEqual(calls, ["getRun"]);
  assert.match(await streamResponse.text(), /"status":"completed"/);
});
