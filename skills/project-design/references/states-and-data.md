# States and data

Read this when building forms, asynchronous regions, tables, or charts. Use only states supported by the interaction; do not manufacture a success or error state for a control that has no such behavior.

## Define observable states

| State | What the interface should explain |
| --- | --- |
| Empty | What belongs here and the next useful action. Distinguish no data from no filter matches. |
| Loading | What is in progress. Preserve meaningful context and avoid shifting controls. |
| Populated | The data and available actions, with clear row or region identity. |
| Review | What is uncertain and what someone can inspect or decide next. |
| Error | What failed, what work remains available, and the actual recovery action. |
| Complete | The result confirmed by the operation, including partial failures. |

For each state, identify its source, available actions, and how the next state is reached. Where a current screen lacks the backend behavior needed for a proposed state, implement it only within the feature request; otherwise report the gap. A visual redesign must not introduce a fake request, timer, or success confirmation.

Interactive controls also need applicable default, hover, focus, pressed, disabled, and pending treatments. Reuse the installed primitive's state contract. Keep focus visible, explain a surprising disabled action, and preserve the button's accessible name during a request.

## Forms and recovery

- Use visible labels and meaningful examples. A placeholder does not replace a label.
- Associate field errors and help text with their control. Explain how to correct invalid input, preserve valid entries, and keep server-side validation authoritative.
- Keep borders and control geometry stable as feedback appears. Pending feedback should identify the operation and guard against accidental duplicate submission.
- Use the project's field, dialog, menu, and select components instead of recreating keyboard, focus, or dismissal behavior.
- Prefer inline recovery near the failure. Offer retry only when an actual retry path exists, and make clear whether it retries one item or the entire operation.
- Keep form contents and row selection through recoverable failures when the existing data model allows it. Do not retain secrets or sensitive uploads beyond the documented boundary.

## Transaction and workflow surfaces

Treat row status and run status as different information. A disconnected stream does not prove that the workflow failed, and a completed workflow can include rows needing review. Preserve classified results while explaining an interruption.

Map actual workflow events to their visible states. Deduplicate replayed events through the existing progress logic rather than counting every received event as new work. Use text for status, modest live announcements, and details on demand instead of repeatedly announcing the entire table.

Keep semantic uncertainty visible. Show the actual closed-set decision and any review state the workflow emits. Do not invent an explanation or call a demonstration decision a live Jev result.

For shareable filters, tabs, and pagination, consider URL state when appropriate to the feature. Sensitive transaction rows, tokens, credentials, and raw upload contents must not appear in URLs, screenshots for publication, logs, or browser persistence. Adding persistence needs its own documented model.

## Tables and quantitative displays

Keep column headings, row identity, units, currency, sort direction, and filter scope understandable. A row action needs an accessible name identifying its target. Preserve selection and a visible way to clear filters where applicable.

Choose a quantitative display from the question:

- One value usually needs a figure, label, unit, and useful context.
- Comparisons often work as aligned rows or bars.
- Time series need an honest interval, units, and missing-data treatment.
- Detailed or numerous categories often need a table, possibly alongside a chart.

Keep chart legends, labels, and non-color cues sufficient to interpret the data. Use installed visualization components when available. Bar comparisons normally start at zero; explain a deliberately restricted axis rather than exaggerating differences. Label synthetic series, avoid invented trends, and make displayed totals consistent with the underlying records.

When the application supports multiple themes, verify focus, text, controls, chart marks, and status distinctions in each. Use semantic tokens instead of independent light and dark styling recipes.
