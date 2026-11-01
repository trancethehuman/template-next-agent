import { defineTool, toolOutput, toolOutputPart } from "eve/tools";
import { once } from "eve/tools/approval";
import { requireAssistantContextActor } from "../lib/auth";
import { browserInputSchema, type BrowserResult } from "../../lib/assistant/browser-actions";
import { BrowserError, runBrowserAction } from "../../lib/assistant/browser";

function pageText(output: BrowserResult) {
  return [
    output.summary,
    output.title || output.url ? `Page: ${output.title ?? ""}${output.url ? ` (${output.url})` : ""}` : undefined,
    output.snapshot ? `Interactive elements:\n${output.snapshot}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export default defineTool({
  description: `Use the signed-in user's cloud browser: Google Chrome in an isolated Vercel Sandbox that the user can watch live, driven through agent-browser. One action per call. Start with navigate. Every action returns the page title, address, and its interactive elements with refs such as @e3; use those refs with click, fill, and select, and use the newest list after the page changes. fill replaces a field's text; type types wherever the focus is; press sends keys such as Enter. Use screenshot when you need to see the page itself. Use it to look things up on websites, such as finding events and ticket prices. It is read-and-browse only: never sign in, create accounts, enter payment or personal details, accept terms, or complete a purchase; stop and hand those steps to the user. Close it when the task is done, unless the user asked to keep it open.`,
  inputSchema: browserInputSchema,
  // Opening a cloud browser costs money and acts on the open web, so the user approves it once per conversation.
  approval: once(),
  async execute(input, ctx) {
    const actor = requireAssistantContextActor(ctx);
    try {
      return await runBrowserAction(actor, input);
    } catch (error) {
      if (error instanceof BrowserError)
        return { action: input.action, summary: error.message, error: error.code };
      return { action: input.action, summary: "The cloud browser could not complete that action. Try again, or close it.", error: "unavailable" };
    }
  },
  // The chat shows a screenshot for every action. The model reads the element
  // list instead, and gets the image only when it asks to look.
  toModelOutput(output) {
    return output.action === "screenshot" && output.screenshot
      ? toolOutput.content([
          toolOutputPart.text(pageText(output)),
          toolOutputPart.file(output.screenshot, { mediaType: "image/jpeg" }),
        ])
      : toolOutput.text(pageText(output));
  },
});
