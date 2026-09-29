import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateCustomerMutation } from "@/api/crm";
import { notifyApiError } from "@/lib/api-client";
import type { CustomerDetail } from "@/types/api";

/**
 * The tags on a customer.
 *
 * Tags are the escape hatch from a fixed set of stages: "enterprise",
 * "invoiced-in-euros", "waiting-on-legal" -- the things a business knows about
 * an account that no schema anticipated.
 *
 * The whole list is sent on every change rather than a single add or remove.
 * The server owns the trimming, lower-casing and de-duplication, so what comes
 * back is the truth and this never has to guess what it will do.
 */

export const TagEditor = ({ customer }: { customer: CustomerDetail }) => {
  const [updateCustomer, { isLoading }] = useUpdateCustomerMutation();
  const [draft, setDraft] = React.useState("");

  const save = async (tags: string[], message: string) => {
    try {
      await updateCustomer({ userId: customer.userId, tags }).unwrap();
      toast.success(message);
    } catch (error) {
      notifyApiError(error, "Could not update the tags");
    }
  };

  const add = () => {
    const tag = draft.trim().toLowerCase();
    if (!tag) return;

    if (customer.tags.includes(tag)) {
      setDraft("");
      return;
    }

    setDraft("");
    void save([...customer.tags, tag], `Tagged “${tag}”`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <AnimatePresence mode="popLayout">
          {customer.tags.map((tag) => (
            <motion.span
              key={tag}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: "spring", stiffness: 320, damping: 24 }}
            >
              <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove the tag ${tag}`}
                  disabled={isLoading}
                  className="rounded-full p-0.5 transition-colors hover:bg-background/60 hover:text-destructive"
                  onClick={() =>
                    void save(
                      customer.tags.filter((current) => current !== tag),
                      `Removed “${tag}”`,
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </motion.span>
          ))}
        </AnimatePresence>

        {customer.tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tags yet.</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // Inside a page that has other forms, so the key press must not
            // submit whichever one happens to be nearest.
            event.preventDefault();
            add();
          }}
          placeholder="Add a tag"
          aria-label="Add a tag"
          maxLength={40}
          className="h-9"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          disabled={isLoading || draft.trim().length === 0}
          onClick={add}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
};
