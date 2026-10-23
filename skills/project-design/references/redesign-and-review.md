# Redesign and review

Read this before changing an existing screen or reviewing substantial visual work. Scale the procedure to the change.

## Capture what the interface does

Inspect the affected source and running route. Record the important tasks, destinations, input fields, handlers, component props, identifiers used by scripts or tests, and data or stream connections. Use screenshots at comparable narrow and wide sizes when a visual comparison will help.

Identify what already works and should survive. Preserve factual content, consent and security language, routes, validation, authentication, data calls, and error recovery unless the requested feature changes them. Copy can become clearer without inventing facts or removing necessary instructions.

Keep a restyle within its requested layout and a polish within its existing visual system. A larger defect can be reported as a follow-up; its discovery does not authorize a larger redesign. An audit produces findings without changing files.

For implementation, name the affected files and behavior in a concise plan, then proceed. Preserve unrelated working-tree changes. Refactor only when the requested behavior or maintainability of the change warrants it; avoid replacing a component tree merely to reproduce its appearance.

## Review observable results

Look at the rendered interface before reading the implementation explanation. Verify:

1. The main task and next action are clear. Content hierarchy and density serve that task.
2. Existing links, fields, handlers, selection, filters, and destinations still work, except for intentional changes.
3. Relevant empty, pending, review, error, partial-success, and completion states are truthful and usable.
4. Narrow screens retain record identity, important values, and reachable controls; wide screens use space coherently.
5. Keyboard focus, labels, overlays, status communication, and reduced motion follow the project's accessibility guidance.
6. Real responses drive confirmations and progress. No request or backend outcome is inferred from a screenshot.

For a redesign, compare before and after at the same viewport and state. Ask what became harder to find, read, or do. Restore useful affordances that the new appearance obscured.

For substantial visual changes, an independent reviewer can improve confidence. Give that reviewer the request, screenshots, relevant source, and any before images without the implementer's defense of the design. Ask for concrete defects, their impact, and source locations where available. Missing, blank, or wrong-state screenshots call for a fresh capture, not a visual pass. Another stylistic preference alone is not a defect.

Group review findings by consequence:

| Kind | Response |
| --- | --- |
| Functional, accessibility, data-integrity, or responsive defect | Fix within the change and verify the affected path. |
| Hierarchy, density, consistency, or clarity issue | Resolve when it materially affects the requested task. |
| Optional visual refinement or broader redesign | Apply only if useful and in scope; otherwise explain briefly if relevant. |

Do not claim a score, test result, browser pass, or behavior-preservation count that was not actually checked. After fixes, repeat the affected checks when needed. Close with the resulting behavior, validation performed, and material limitations.
