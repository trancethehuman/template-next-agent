import { describe, expect, test } from "bun:test";

import { CsvImportError, parseTransactionCsv } from "@/lib/transactions/csv";

describe("parseTransactionCsv", () => {
  test("parses quoted descriptions and signed amounts in minor units", () => {
    const rows = parseTransactionCsv(
      'Date,Description,Amount,Currency\n2026-08-21,"Harbor, Stationery","-$1,234.56",CAD\n08/20/2026,Refund,$23.40,usd\n',
    );

    expect(rows).toEqual([
      {
        id: "csv-1",
        date: "2026-08-21",
        description: "Harbor, Stationery",
        amountMinor: -123456,
        currency: "CAD",
      },
      {
        id: "csv-2",
        date: "2026-08-20",
        description: "Refund",
        amountMinor: 2340,
        currency: "USD",
      },
    ]);
  });

  test("uses debit and credit columns with a CAD default", () => {
    const rows = parseTransactionCsv(
      "posted date,Payee,Debit,Credit\n2026-08-21,Cloudfield,39.99,\n2026-08-22,Client,,125.00\n",
    );
    expect(rows.map((row) => row.amountMinor)).toEqual([-3999, 12500]);
    expect(rows.map((row) => row.currency)).toEqual(["CAD", "CAD"]);
  });

  test("rejects ambiguous or malformed money", () => {
    expect(() =>
      parseTransactionCsv("date,description,debit,credit\n2026-08-21,Example,10.00,12.00"),
    ).toThrow("exactly one of debit or credit");
    expect(() =>
      parseTransactionCsv("date,description,amount\n2026-08-21,Example,1.234"),
    ).toThrow("at most two decimals");
    expect(() =>
      parseTransactionCsv("date,description,amount\n2026-08-21,Example,0"),
    ).toThrow("cannot be zero");
  });

  test("rejects invalid dates and too many rows with clear errors", () => {
    expect(() =>
      parseTransactionCsv("date,description,amount\n2026-02-30,Example,-4.20"),
    ).toThrow("not a real calendar date");

    const rows = Array.from({ length: 26 }, (_, index) => `2026-08-21,Sample ${index},-1.00`);
    expect(() => parseTransactionCsv(["date,description,amount", ...rows].join("\n"))).toThrow(
      "1 to 25 transactions",
    );
  });

  test("rejects malformed quoted CSV", () => {
    expect(() => parseTransactionCsv('date,description,amount\n2026-08-21,"Unclosed,-1.00')).toThrow(
      CsvImportError,
    );
  });
});
