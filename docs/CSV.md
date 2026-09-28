# Transaction CSV format

The upload control on `/transactions` parses a CSV in the browser and previews the rows before starting a classification run. Use synthetic data while learning the workflow.

## Basic format

```csv
date,description,amount,currency
2026-09-01,Cloud hosting,-29.00,CAD
2026-09-03,Customer invoice payment,1250.00,CAD
2026-09-04,Bank service fee,-7.50,CAD
```

An amount below zero means money paid out. An amount above zero means money received. You can use `debit` and `credit` columns instead of a signed `amount`: enter a positive value in exactly one of the two columns for each row. `debit` becomes money paid out; `credit` becomes money received.

| Field | Accepted header names | Rules |
| --- | --- | --- |
| Date | `date`, `transaction date`, `posted date` | Required. `YYYY-MM-DD` or `MM/DD/YYYY`. |
| Description | `description`, `merchant`, `payee`, `name` | Required. 1–200 characters after trimming. |
| Signed amount | `amount`, `transaction amount` | Required unless using debit/credit. Nonzero dollars, up to two decimals. |
| Debit | `debit`, `withdrawal`, `outflow` | Alternative to signed amount. Positive dollars in the one populated money column. |
| Credit | `credit`, `deposit`, `inflow` | Alternative to signed amount. Positive dollars in the one populated money column. |
| Currency | `currency` | Optional. `CAD` or `USD`; defaults to `CAD`. |

Header matching ignores case, spaces, hyphens, and underscores. CSV quoting is supported, so a description containing a comma can be quoted. Unknown extra columns are ignored. A file must contain 1–25 transaction rows and be at most 64 KB. Duplicate recognized columns, inconsistent column counts, invalid dates, zero amounts, and mixed `amount` plus `debit`/`credit` columns are rejected with a row-specific message when possible.

The application validates the same run shape on the server. A classification result is a suggested demo category, not a posted accounting entry. Review any classification before using it in bookkeeping.
