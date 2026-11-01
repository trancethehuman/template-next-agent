"use client";

import { useFormStatus } from "react-dom";
import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AssistantSignInButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="w-full justify-between"
      disabled={pending}
    >
      {pending ? "Opening Google…" : "Continue with Google"}
      {pending ? (
        <LoaderCircleIcon
          className="motion-safe:animate-spin"
          data-icon="inline-end"
        />
      ) : (
        <ArrowRightIcon data-icon="inline-end" />
      )}
    </Button>
  );
}
