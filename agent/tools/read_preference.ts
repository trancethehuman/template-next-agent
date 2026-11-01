import { defineTool } from "eve/tools";
import { z } from "zod";
import { assistantPreference } from "../lib/preference";
import { requireAssistantContextActor } from "../lib/auth";

export default defineTool({
  description: "Read the user's explicit brief-format preference in this durable conversation. Null means no saved preference; defaults are three bullets with source links.",
  inputSchema: z.object({}),
  execute(_input, ctx) {
    requireAssistantContextActor(ctx);
    return { scope: "this-conversation", preference: assistantPreference.get() };
  },
});
