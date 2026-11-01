import { defineAgent, defineDynamic } from "eve";
import { assistantModel } from "../lib/assistant/models";

export default defineAgent({
  // The signed-in caller's chosen model, checked against the allow-list each turn.
  model: defineDynamic({
    events: {
      "turn.started": (_event, ctx) => assistantModel(ctx.session.auth.current?.attributes.model),
    },
  }),
  reasoning: "low",
  limits: {
    // Browsing sends a screenshot per action, so a session needs more input than chat alone.
    maxInputTokensPerSession: 3_000_000,
    maxOutputTokensPerSession: 60_000,
    sessionTimeoutMs: 7 * 24 * 60 * 60 * 1_000,
  },
});
