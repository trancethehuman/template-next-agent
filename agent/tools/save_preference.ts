import { defineTool } from "eve/tools";
import { assistantPreference, preferenceInputSchema } from "../lib/preference";
import { requireAssistantContextActor } from "../lib/auth";

export default defineTool({
  description: "Save a brief format only after the user explicitly asks to remember it. Include their exact request as provenance. Persists for this conversation; does not save calendar data or secrets.",
  inputSchema: preferenceInputSchema,
  execute({ bulletCount, includeSources, explicitRequest }, ctx) {
    requireAssistantContextActor(ctx);
    assistantPreference.update(() => ({
      bulletCount,
      includeSources,
      provenance: {
        source: "explicit-user-request",
        request: explicitRequest,
        turnId: ctx.session.turn.id,
      },
    }));
    return { scope: "this-conversation", preference: assistantPreference.get() };
  },
});
