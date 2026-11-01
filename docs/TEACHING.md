# Teaching the decision-model workflow

This lab follows the webinar's loop: **small question → structured answer → code acts**. It uses the actual [AI Elements workflow components](https://elements.ai-sdk.dev/examples/workflow) and real model evaluations. It does not display private model reasoning or generated explanations.

## A five-minute demonstration

1. Open `/transactions`. **Choose a model** comes first. Keep Jev for the first run. Its compact card shows public capacity and prices plus the last real request timing, once measured. Missing prices are not treated as zero. Click **Next: add transactions**.
2. Download **Mock Amex CSV**, drop it into the file area, acknowledge fictional data, then **Next: run the demo**. The **Examples** tab offers individual mock rows instead.
3. Click **Start demo**. All rows execute at full speed while the presentation stays on one selected transaction. No token entry is needed in loopback development; deployed demos use Settings for the access token.
4. Use **Next step** or **Play steps**. The active node and a short explanation follow the actual events: read the row → check rules → ask the model → see answers → check the result → show the outcome. Hover a node for timing, provider/model IDs, choices, probabilities and scores. Later answers stay hidden until their recorded event is revealed. Click a node or **View step details** for the full panel; under **See the answers**, select one question at a time.
5. Use **Next: view results**. Open a review row and discuss why selecting a label does not necessarily authorize an application action.
6. Use **Next: compare models**, choose **OpenAI Decisions API**, and **Run comparison**. The same selected row, questions, and rules setting are reused. The table compares actual outputs and request timings. Inspect opens that run's step view. In **Settings**, uncheck simple rules to send every row to a model.
7. Use **Switch to full speed** or the sidebar **Full speed** entry to reveal all events immediately. Step mode changes playback only. Timings include Gateway transport, provider processing and SDK retries.

On phones, the workflow shows the current step at readable size rather than shrinking the entire graph. The step selector and detail panel keep every stage available.

The graph nodes and equivalent keyboard-accessible **Inspect step** selector inspect input, rule checks, the provider/model, returned answers, the application policy, and the outcome. All four questions share the same state in one evaluation call and are independent. The graph does not imply that the category consumes the movement answer.

## Supported models

The server allowlist was checked against the Gateway catalogue on October 11, 2026. Availability still depends on the Gateway account and provider.

| Model | Gateway ID | Retention request |
| --- | --- | --- |
| Jev | `typesafe-ai/jev` | Zero retention requested |
| OpenAI Decisions API (GPT-6 Luna) | `openai/gpt-6-luna-decisions` | Synthetic data acknowledgement required |
| Microsoft Decision 1 | `microsoft/microsoft-decision-1` | Zero retention requested |
| Liquid D1 | `liquid/d1` | Synthetic data acknowledgement required |
| Laya | `convaiinnovations/laya` | Synthetic data acknowledgement required |

The **OpenAI Decisions API** option uses GPT-6 Luna through AI Gateway with the existing `AI_GATEWAY_API_KEY`; no separate OpenAI key is required. It calls the native decision model, using the same four questions and application policy as Jev. OpenAI calls its boolean question a `predicate`; the AI SDK exposes its probability as a boolean answer. See the [OpenAI Decisions guide](https://developers.openai.com/api/docs/guides/decisions).

Non-ZDR models receive a Gateway request without the zero-retention constraint, only after explicit synthetic-data acknowledgement. This is an operator assertion, not detection or anonymization. Use fictional data. There is no silent fallback when a provider fails. Perplexity Decider, Typical, and specialist classifiers mentioned in the slides are not included without a verified compatible Gateway evaluation ID.

## What the values mean

- **Choice**: a label from the declared criteria, plus the probability distribution when the provider returns one. Missing distributions stay missing.
- **Score**: an expected position on three criteria, indexed 0–2. A value such as 1.625 is meaningful; it is not a percentage or a class label.
- **Noul / boolean**: the probability that the independent own-account statement is true. The demo does not apply a yes/no threshold to this teaching output.
- **Provider confidence**: shown only when returned in metadata. It is separate from the selected option's probability and should not be assumed to be calibrated across providers.
- **Min. selected P**: the smaller relevant selected-choice probability used by the code policy. The legacy `ClassificationRow.confidence` field holds this value for compatibility, not provider confidence. For transfers, only movement is relevant. Rules have no model probability.

The policy requires movement probability ≥ 0.85, category probability ≥ 0.90, a ≥ 0.20 lead over each runner-up, and compatible direction/category. Missing probabilities or conflicting evidence lead to review. The score and boolean outputs are educational and do not override that policy. Thresholds are example product policy, not guarantees about model accuracy. Supplier refunds are grouped with incoming money for this small demo; do not treat its categories as an accounting system.

The pinned AI SDK 7 exposes `experimental_evaluate`, while the slides show an earlier `experimental_decide` API. The implementation follows the installed SDK's evaluation types. Questions and criteria live in `lib/classification/questions.ts`; the allowlist in `models.ts`; the policy in `jev.ts`; orchestration in `workflows/classify-transactions.ts`.

## Reruns, replay, and data handling

Sidebar destinations use `/transactions?view=…` and native history. Switching between lab views and using browser Back/Forward preserves the CSV, settings, selected row, comparisons, and active stream. Opening a workflow screen starts its presentation playback again; it does not rerun the model. Reload keeps the destination but clears tab data, so an empty view offers Add transactions.

Every rerun starts a new authorized Workflow run with a snapshot of the model, rules setting, input, and question version. Up to 20 run comparisons are held in browser component memory; changing the input or reloading clears them. Selecting an earlier comparison restores that run's snapshot. It does not mutate or reuse the old provider response.

Workflow may deliver events more than once. The reducer keeps phase history monotonic and deduplicates replayed phases. Request timing measures the evaluation call, including SDK retries, not playback or a multi-run average. Token usage is displayed only when the provider supplies it. These individual observations are not a throughput benchmark or a model ranking.

Workflow persists inputs, answer traces, and progress under the backing World's retention. This starter adds no deletion scheduler or separate database. Deployed start and stream endpoints keep the bearer-token gate, input size limits, and 25-row limit. Local automatic access is restricted to loopback development and same-origin requests. See [SECURITY.md](SECURITY.md) before exposing the demo or using real financial data.
