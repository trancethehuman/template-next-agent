import Papa from "papaparse";

import type { TransactionInput } from "@/lib/transactions/types";

export const MAX_CSV_BYTES = 64 * 1024;
export const MAX_CSV_ROWS = 25;

const headerAliases = {
  date: ["date", "transactiondate", "posteddate"],
  description: ["description", "merchant", "payee", "name"],
  amount: ["amount", "transactionamount"],
  debit: ["debit", "withdrawal", "outflow"],
  credit: ["credit", "deposit", "inflow"],
  currency: ["currency"],
} as const;

type ColumnName = keyof typeof headerAliases;

export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvImportError";
  }
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function findColumn(headers: string[], name: ColumnName): number {
  const matches = headers.flatMap((header, index) =>
    (headerAliases[name] as readonly string[]).includes(header) ? [index] : [],
  );
  if (matches.length > 1) {
    throw new CsvImportError(`The CSV has more than one ${name} column.`);
  }
  return matches[0] ?? -1;
}

function normalizeDate(value: string, rowNumber: number): string {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!iso && !us) {
    throw new CsvImportError(`Row ${rowNumber}: date must be YYYY-MM-DD or MM/DD/YYYY.`);
  }

  const year = Number(iso?.[1] ?? us?.[3]);
  const month = Number(iso?.[2] ?? us?.[1]);
  const day = Number(iso?.[3] ?? us?.[2]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    year > 2100 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new CsvImportError(`Row ${rowNumber}: date is not a real calendar date.`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMoney(value: string, rowNumber: number, column: string): number {
  const match = /^(\()?([+-])?\$?((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?)(\))?$/.exec(
    value.trim(),
  );
  if (!match || Boolean(match[1]) !== Boolean(match[4]) || (match[1] && match[2])) {
    throw new CsvImportError(`Row ${rowNumber}: ${column} must be a dollar amount with at most two decimals.`);
  }

  const [wholeText, fractionText = ""] = match[3].replaceAll(",", "").split(".");
  const whole = Number(wholeText);
  if (!Number.isSafeInteger(whole) || whole > Math.floor(Number.MAX_SAFE_INTEGER / 100)) {
    throw new CsvImportError(`Row ${rowNumber}: ${column} is too large.`);
  }

  const minor = whole * 100 + Number(fractionText.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) {
    throw new CsvImportError(`Row ${rowNumber}: ${column} is too large.`);
  }
  return match[1] || match[2] === "-" ? -minor : minor;
}

function amountFromRow(
  row: string[],
  columns: Record<ColumnName, number>,
  rowNumber: number,
): number {
  if (columns.amount >= 0) {
    const amount = parseMoney(row[columns.amount] ?? "", rowNumber, "amount");
    if (amount === 0) {
      throw new CsvImportError(`Row ${rowNumber}: amount cannot be zero.`);
    }
    return amount;
  }

  const debitText = columns.debit >= 0 ? row[columns.debit]?.trim() : "";
  const creditText = columns.credit >= 0 ? row[columns.credit]?.trim() : "";
  if (Boolean(debitText) === Boolean(creditText)) {
    throw new CsvImportError(`Row ${rowNumber}: enter an amount in exactly one of debit or credit.`);
  }

  if (debitText) {
    const debit = parseMoney(debitText, rowNumber, "debit");
    if (debit <= 0) {
      throw new CsvImportError(`Row ${rowNumber}: debit must be greater than zero.`);
    }
    return -debit;
  }

  const credit = parseMoney(creditText ?? "", rowNumber, "credit");
  if (credit <= 0) {
    throw new CsvImportError(`Row ${rowNumber}: credit must be greater than zero.`);
  }
  return credit;
}

export function parseTransactionCsv(content: string): TransactionInput[] {
  if (new TextEncoder().encode(content).byteLength > MAX_CSV_BYTES) {
    throw new CsvImportError("CSV file is too large. Choose a file under 64 KB.");
  }

  const parsed = Papa.parse<string[]>(content, { skipEmptyLines: "greedy" });
  if (parsed.errors.length > 0) {
    const error = parsed.errors[0];
    throw new CsvImportError(`CSV could not be read near row ${(error.row ?? 0) + 1}: ${error.message}`);
  }

  const [rawHeaders, ...rows] = parsed.data;
  if (!rawHeaders || rawHeaders.length === 0) {
    throw new CsvImportError("CSV is empty. Add a header row and at least one transaction.");
  }
  if (rows.length < 1 || rows.length > MAX_CSV_ROWS) {
    throw new CsvImportError(`CSV must contain 1 to ${MAX_CSV_ROWS} transactions.`);
  }

  const headers = rawHeaders.map(normalizeHeader);
  const columns = Object.fromEntries(
    (Object.keys(headerAliases) as ColumnName[]).map((name) => [name, findColumn(headers, name)]),
  ) as Record<ColumnName, number>;
  if (columns.date < 0 || columns.description < 0) {
    throw new CsvImportError("CSV needs date and description columns.");
  }
  if (columns.amount < 0 && columns.debit < 0 && columns.credit < 0) {
    throw new CsvImportError("CSV needs an amount column, or debit and credit columns.");
  }
  if (columns.amount >= 0 && (columns.debit >= 0 || columns.credit >= 0)) {
    throw new CsvImportError("Use either amount or debit/credit columns, not both.");
  }

  return rows.map((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== rawHeaders.length) {
      throw new CsvImportError(`Row ${rowNumber}: expected ${rawHeaders.length} columns, found ${row.length}.`);
    }
    const description = (row[columns.description] ?? "").trim().replace(/\s+/g, " ");
    if (!description || description.length > 200) {
      throw new CsvImportError(`Row ${rowNumber}: description must be 1 to 200 characters.`);
    }
    const currency = columns.currency < 0 ? "CAD" : row[columns.currency]?.trim().toUpperCase();
    if (currency !== "CAD" && currency !== "USD") {
      throw new CsvImportError(`Row ${rowNumber}: currency must be CAD or USD.`);
    }

    return {
      id: `csv-${index + 1}`,
      date: normalizeDate(row[columns.date] ?? "", rowNumber),
      description,
      amountMinor: amountFromRow(row, columns, rowNumber),
      currency,
    };
  });
}
