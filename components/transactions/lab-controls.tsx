"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { decisionModels } from "@/lib/classification/models";
import type { DecisionModelId } from "@/lib/classification/models";
import type { TransactionInput } from "@/lib/transactions/types";

export function DecisionModelSelect({
  value,
  onChange,
  disabled,
  label = "Decision model",
}: {
  value: DecisionModelId;
  onChange: (value: DecisionModelId) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="decision-model">{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next as DecisionModelId);
        }}
        disabled={disabled}
        items={decisionModels.map((model) => ({
          value: model.id,
          label: model.label,
        }))}
      >
        <SelectTrigger id="decision-model" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {decisionModels.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}

export function TransactionPicker({
  rows,
  value,
  onChange,
}: {
  rows: readonly TransactionInput[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="selected-transaction">Transaction</FieldLabel>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
        items={rows.map((row) => ({ value: row.id, label: row.description }))}
      >
        <SelectTrigger id="selected-transaction" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {rows.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.description}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
