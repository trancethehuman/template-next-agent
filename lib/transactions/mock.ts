import type { TransactionInput } from "@/lib/transactions/types";

export const mockTransactions: TransactionInput[] = [
  {
    id: "sample-01",
    date: "2026-08-21",
    description: "Harbor Stationery",
    amountMinor: -4865,
    currency: "CAD",
  },
  {
    id: "sample-02",
    date: "2026-08-20",
    description: "Northstar Client Payment",
    amountMinor: 275000,
    currency: "CAD",
  },
  {
    id: "sample-03",
    date: "2026-08-19",
    description: "Metro Rail Pass",
    amountMinor: -12800,
    currency: "CAD",
  },
  {
    id: "sample-04",
    date: "2026-08-18",
    description: "Cloudfield Software",
    amountMinor: -3900,
    currency: "USD",
  },
  {
    id: "sample-05",
    date: "2026-08-15",
    description: "Transfer between our own accounts",
    amountMinor: -50000,
    currency: "CAD",
  },
  {
    id: "sample-06",
    date: "2026-08-14",
    description: "Bluebird Cafe",
    amountMinor: -1840,
    currency: "CAD",
  },
  {
    id: "sample-07",
    date: "2026-08-12",
    description: "Marketplace Refund",
    amountMinor: 2150,
    currency: "CAD",
  },
  {
    id: "sample-08",
    date: "2026-08-11",
    description: "Lakeside Coworking",
    amountMinor: -32500,
    currency: "CAD",
  },
];
