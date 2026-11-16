import * as React from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * A themed select written like the browser's: `value`, `onChange` and
 * `<option>` children. The browser's own draws its list with system
 * colours, which the theme cannot reach (a white box on the dark theme);
 * this one is the shadcn Select underneath.
 *
 *   <Picker value={stage} onChange={(event) => setStage(event.target.value)}>
 *     <option value="">All</option>
 *     <option value="new">New</option>
 *   </Picker>
 */

// Radix keeps "" for "nothing chosen": an option whose value is "" gets this instead.
const EMPTY = "__empty__";

type Option = { value: string; label: React.ReactNode; disabled?: boolean };

const optionsFrom = (children: React.ReactNode): Option[] =>
  React.Children.toArray(children).flatMap((child): Option[] => {
    if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === React.Fragment) return optionsFrom(child.props.children);
    return [{ value: String(child.props.value ?? ""), label: child.props.children, disabled: child.props.disabled }];
  });

export type PickerProps = {
  value: string;
  onChange?: (event: { target: { value: string } }) => void;
  children: React.ReactNode;
  id?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export const Picker = ({ value, onChange, children, className, placeholder, disabled, ...trigger }: PickerProps) => {
  const options = optionsFrom(children);
  const known = options.some((option) => option.value === value);
  return (
    <Select
      // An unknown value (nothing chosen yet, no "" option) shows the placeholder.
      value={known ? (value === "" ? EMPTY : value) : ""}
      onValueChange={(next) => onChange?.({ target: { value: next === EMPTY ? "" : next } })}
      disabled={disabled}
      dir={typeof document !== "undefined" && document.documentElement.dir === "ltr" ? "ltr" : "rtl"}
    >
      <SelectTrigger {...trigger} className={cn("h-9 min-w-32", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value === "" ? EMPTY : option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
