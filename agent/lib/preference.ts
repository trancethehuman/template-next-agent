import { defineState } from "eve/context";
import { z } from "zod";

export const preferenceInputSchema = z.object({
  bulletCount: z.union([z.literal(3), z.literal(5)]),
  includeSources: z.boolean(),
  explicitRequest: z.string().trim().min(1).max(300),
});

export type AssistantPreference = {
  bulletCount: 3 | 5;
  includeSources: boolean;
  provenance: { source: "explicit-user-request"; request: string; turnId: string };
};

export const assistantPreference = defineState<AssistantPreference | null>(
  "personal-assistant.explicit-brief-preference",
  () => null,
);
