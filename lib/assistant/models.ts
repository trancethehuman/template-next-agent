/**
 * Models the assistant may run on. Every entry supports tools and images, so
 * any of them can drive the cloud browser from screenshots. The server only
 * accepts IDs from this list; anything else falls back to the default.
 */
export const assistantModels = [
  { id: "openai/gpt-6.1-terra", label: "GPT-6.1 Terra", note: "Default" },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", note: "Stronger, slower" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", note: "Fastest, cheapest" },
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", note: "Anthropic" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Google" },
] as const;

export type AssistantModelId = (typeof assistantModels)[number]["id"];

export const defaultAssistantModel: AssistantModelId = "openai/gpt-6.1-terra";

/** The browser cookie that carries the chosen model. It is a preference, not a credential. */
export const assistantModelCookie = "assistant-model";

export function isAssistantModel(value: unknown): value is AssistantModelId {
  return assistantModels.some((model) => model.id === value);
}

/** A chosen model, or the default when the choice is missing or not allowed. */
export function assistantModel(value: unknown): AssistantModelId {
  return isAssistantModel(value) ? value : defaultAssistantModel;
}

/** The model chosen in a Cookie header, or nothing when none or a disallowed one was chosen. */
export function assistantModelFromCookie(header: string | null | undefined): AssistantModelId | undefined {
  const match = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${assistantModelCookie}=`));
  if (!match) return undefined;
  try {
    const value = decodeURIComponent(match.slice(assistantModelCookie.length + 1));
    return isAssistantModel(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
