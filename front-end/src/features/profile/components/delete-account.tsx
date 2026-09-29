import { AlertTriangle, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form/form";
import { PasswordField } from "@/components/ui/form/password-field";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/config/paths";
import {
  deleteAccountInputSchema,
  useDeleteAccountMutation,
  type DeleteAccountInput,
} from "@/api/profile";
import { notifyApiError } from "@/lib/api-client";

/**
 * Closing the account for good.
 *
 * Two steps on purpose. Opening the panel is the first, typing the password is
 * the second, and the server checks that password again. Nothing here is
 * recoverable, so a single mis-click should not be enough.
 */
export const DeleteAccount = () => {
  const [open, setOpen] = React.useState(false);
  const [deleteAccount, { isLoading }] = useDeleteAccountMutation();
  const navigate = useNavigate();

  const handleSubmit = async (values: DeleteAccountInput) => {
    try {
      await deleteAccount(values).unwrap();
      toast.success("Your account has been deleted");
      navigate(paths.home.getHref(), { replace: true });
    } catch (error) {
      notifyApiError(error, "Could not delete your account");
    }
  };

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="flex items-start gap-3">
        <motion.div
          initial={{ scale: 0.8, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/15 text-destructive"
        >
          <AlertTriangle className="size-5" />
        </motion.div>

        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-semibold">Delete your account</h3>
          <p className="text-sm text-muted-foreground">
            Your profile, your cart and your order history go with it. This
            cannot be undone.
          </p>
        </div>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              <Form<DeleteAccountInput>
                schema={deleteAccountInputSchema}
                onSubmit={handleSubmit}
                options={{ defaultValues: { password: "" } }}
              >
                {() => (
                  <>
                    <PasswordField<DeleteAccountInput>
                      name="password"
                      label="Confirm with your password"
                      placeholder="Your password"
                      autoComplete="current-password"
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        variant="destructive"
                        className="gap-2"
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Spinner className="size-4" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                        {isLoading ? "Deleting…" : "Delete my account"}
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setOpen(false)}
                        disabled={isLoading}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                )}
              </Form>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="trigger"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pt-4"
          >
            <Button
              type="button"
              variant="outline"
              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setOpen(true)}
            >
              <Trash2 className="size-4" />
              Delete account
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
