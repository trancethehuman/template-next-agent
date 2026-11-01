import { defineTool } from "eve/tools";
import { z } from "zod";
import { assistantPreference } from "../lib/preference";
import { requireAssistantContextActor } from "../lib/auth";

export default defineTool({
  description: "Clear the active brief-format preference in this conversation when the user asks. Earlier conversation and Workflow history remain subject to the runtime retention policy.",
  inputSchema: z.object({}),
  execute(_input, ctx) {
    requireAssistantContextActor(ctx);
    assistantPreference.update(() => null);
    return { scope: "this-conversation", preference: null };
  },
});
