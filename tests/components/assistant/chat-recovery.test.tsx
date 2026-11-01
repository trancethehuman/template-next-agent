import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultMessageReducer, EveAgentStore } from "eve/client";
import type { MessageStreamEvent } from "eve/client";
import {
  AssistantInputRequest,
  recoverUnacceptedDraft,
} from "@/components/assistant/assistant-chat";

describe("assistant chat recovery", () => {
  test("restores a rejected draft even when EVE resolves send after HTTP failure", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ error: "Unauthorized." }, { status: 401 }),
    });
    let draft = "";
    let finished = false;
    const submitted = { text: "Synthetic meeting-prep request", accepted: false };
    const store = new EveAgentStore({
      host: `http://127.0.0.1:${server.port}`,
      reducer: defaultMessageReducer(),
    });
    store.setCallbacks({
      onFinish(snapshot) {
        finished = true;
        draft = recoverUnacceptedDraft(draft, submitted, snapshot.status === "error");
      },
    });
    try {
      await store.send({ message: submitted.text });
      expect(finished).toBe(true);
      expect(store.snapshot.status).toBe("error");
      expect(store.snapshot.session).toBeUndefined();
      expect(draft).toBe(submitted.text);
    } finally {
      server.stop(true);
    }
  });

  test("preserves a newer draft and avoids resubmitting an acknowledged turn", () => {
    const submitted = { text: "Original request", accepted: false };
    expect(recoverUnacceptedDraft("A new draft", submitted, true)).toBe("A new draft");
    expect(recoverUnacceptedDraft("", { ...submitted, accepted: true }, true)).toBe("");
    expect(recoverUnacceptedDraft("", submitted, false)).toBe("");
  });

  test("renders SDK-projected session budget choices separately from task approval", () => {
    const reducer = defaultMessageReducer();
    const event: MessageStreamEvent = {
      type: "input.requested",
      data: {
        sequence: 0,
        stepIndex: 0,
        turnId: "turn_synthetic",
        requests: [{
          requestId: "synthetic_budget",
          kind: "session-limit",
          action: { kind: "tool-call", toolName: "session_limit", callId: "call_synthetic", input: {} },
          prompt: "This conversation reached its model budget.",
          options: [
            { id: "approve", label: "Continue conversation", style: "primary" },
            { id: "stop", label: "Stop", style: "danger" },
          ],
        }],
      },
      meta: { id: "evt_synthetic_budget", at: "2026-10-30T20:00:00Z" },
    };
    const projected = reducer.reduce(reducer.initial(), event);
    const request = projected.messages.flatMap(message => message.parts).flatMap(part =>
      part.type === "dynamic-tool" && part.state === "approval-requested"
        && part.toolMetadata?.eve?.inputRequest
        ? [part.toolMetadata.eve.inputRequest] : [],
    )[0];
    expect(request).toBeDefined();
    const html = renderToStaticMarkup(<AssistantInputRequest
      request={request}
      disabled={false}
      answer=""
      onAnswerChange={() => {}}
      onRespond={() => {}}
    />);
    expect(html).toContain("Continue conversation");
    expect(html).toContain("Stop");
    expect(html).toContain("does not approve a task");
    expect(html).not.toContain("Your approval is needed");
  });
});
