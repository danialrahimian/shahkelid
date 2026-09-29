import { Check, Pencil, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import { FieldError } from "@/components/ui/form/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The list of perks a plan advertises.
 *
 * A perk is not a text field, so it does not fit the shared input: it is a
 * list you add to, rename in place and remove from. The rows reorder with a
 * layout animation, which is what makes a deletion read as a removal rather
 * than the list simply being different afterwards.
 */
export const PerksEditor = ({
  perks,
  onChange,
  name = "perks",
}: {
  perks: string[];
  onChange: (perks: string[]) => void;
  name?: string;
}) => {
  const [draft, setDraft] = React.useState("");
  // null means "adding"; a number means "renaming the perk at that index".
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);

  const isEditing = editingIndex !== null;

  const commit = () => {
    const value = draft.trim();
    if (!value) {
      toast.warning("Write the perk first");
      return;
    }

    const duplicate = perks.some(
      (perk, index) =>
        index !== editingIndex &&
        perk.trim().toLowerCase() === value.toLowerCase(),
    );
    if (duplicate) {
      toast.warning("That perk is already listed");
      return;
    }

    if (editingIndex !== null) {
      onChange(
        perks.map((perk, index) => (index === editingIndex ? value : perk)),
      );
      setEditingIndex(null);
    } else {
      onChange([...perks, value]);
    }

    setDraft("");
  };

  const remove = (index: number) => {
    onChange(perks.filter((_, perkIndex) => perkIndex !== index));

    // Keep the rename target pointing at the same perk after the list shifts.
    if (editingIndex === null) return;
    if (editingIndex === index) {
      setEditingIndex(null);
      setDraft("");
    } else if (editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${name}-input`}>perks</Label>

      <div className="flex gap-2">
        <Input
          id={`${name}-input`}
          placeholder="What does this plan include?"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter would otherwise submit the whole product form.
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />

        <motion.div
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 340, damping: 18 }}
        >
          <Button type="button" onClick={commit} className="gap-1.5">
            <motion.span
              key={isEditing ? "edit" : "add"}
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
              className="flex"
            >
              {isEditing ? (
                <Pencil className="size-4" />
              ) : (
                <Plus className="size-4" />
              )}
            </motion.span>
            {isEditing ? "edit perk" : "add perk"}
          </Button>
        </motion.div>
      </div>

      <AnimatePresence initial={false}>
        {isEditing ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Button
              type="button"
              variant="ghost"
              className="w-full gap-1.5"
              onClick={() => {
                setEditingIndex(null);
                setDraft("");
              }}
            >
              <X className="size-4" />
              cancel editing
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.ul layout className="space-y-2">
        <AnimatePresence initial={false}>
          {perks.map((perk, index) => (
            <motion.li
              key={perk}
              layout
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, height: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className={cn(
                "flex items-center justify-between gap-2 rounded-md border p-2 transition-colors",
                editingIndex === index
                  ? "border-foreground/40 bg-muted"
                  : "border-border",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setEditingIndex(index);
                  setDraft(perk);
                }}
                className="flex flex-1 cursor-pointer items-center gap-2 text-left text-sm"
              >
                <Check className="size-4 shrink-0" strokeWidth={2.5} />
                {perk}
              </button>

              <motion.div
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 400, damping: 18 }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${perk}`}
                  onClick={() => remove(index)}
                  className="size-8 hover:text-destructive"
                >
                  <X className="size-4" />
                </Button>
              </motion.div>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>

      <FieldError name={name} />
    </div>
  );
};
