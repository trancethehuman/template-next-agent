"use client";

import { useEffect, useState } from "react";
import { getDecisionModel } from "@/lib/classification/models";
import type { DecisionModelId } from "@/lib/classification/models";
import { modelCatalogueUrl } from "@/lib/classification/model-facts";
import type { ModelFacts } from "@/lib/classification/model-facts";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

export function ModelProfile({
  modelId,
  lastElapsedMs,
}: {
  modelId: DecisionModelId;
  lastElapsedMs?: number;
}) {
  const model = getDecisionModel(modelId);
  const [facts, setFacts] = useState<ModelFacts[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/models", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalogue unavailable");
        const body = (await response.json()) as { models: ModelFacts[] };
        setFacts(body.models);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      });
    return () => controller.abort();
  }, []);
  const fact = facts?.find((item) => item.id === modelId);
  const unknown = facts || unavailable ? "Not listed" : "Loading…";
  return (
    <article aria-label={`${model.label} model card`} className="border">
      <div className="border-b p-6">
        <p className="text-xs text-muted-foreground">{model.provider}</p>
        <h2 className="mt-2 text-2xl font-medium tracking-tight">
          {model.label}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Chooses from fixed answers and returns scores. All models answer the
          same four questions in this demo.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 p-6 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Context capacity</dt>
          <dd className="mt-1 tabular-nums">
            {fact?.contextTokens != null
              ? `${fact.contextTokens.toLocaleString()} tokens`
              : unknown}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Input price / 1M tokens
          </dt>
          <dd className="mt-1 tabular-nums">
            {fact?.inputUsdPerMillion != null
              ? `${usd.format(fact.inputUsdPerMillion)} USD`
              : unknown}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Output price / 1M tokens
          </dt>
          <dd className="mt-1 tabular-nums">
            {fact?.outputUsdPerMillion != null
              ? `${usd.format(fact.outputUsdPerMillion)} USD`
              : unknown}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Last call in this demo
          </dt>
          <dd className="mt-1 tabular-nums">
            {lastElapsedMs != null
              ? `${lastElapsedMs.toLocaleString()} ms`
              : "Run to measure"}
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2 border-t px-6 py-4 text-xs text-muted-foreground">
        <p>
          {model.zeroDataRetention
            ? "Zero data retention requested through Gateway."
            : "Use fictional data. Zero retention is unavailable through Gateway."}
        </p>
        <p>
          {unavailable ? (
            "Live stats unavailable. You can still continue."
          ) : (
            <>
              Prices and capacity from the{" "}
              <a
                className="underline underline-offset-4"
                href={modelCatalogueUrl}
                target="_blank"
                rel="noreferrer"
              >
                Gateway catalogue
              </a>
              . Cached up to one hour.
            </>
          )}{" "}
          Timings include Gateway and retries.
        </p>
      </div>
    </article>
  );
}
