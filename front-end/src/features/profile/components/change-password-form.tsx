import { KeyRound, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useFormContext, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form/form";
import { PasswordField } from "@/components/ui/form/password-field";
import { Spinner } from "@/components/ui/spinner";
import {
  changePasswordInputSchema,
  useChangePasswordMutation,
  type ChangePasswordInput,
} from "@/api/profile";
import { PasswordStrength } from "@/components/ui/password-strength";
import { notifyApiError } from "@/lib/api-client";

/** Reads the live password so the meter can react as it is typed. */
const StrengthMeter = () => {
  const { watch } = useFormContext<ChangePasswordInput>();
  return <PasswordStrength value={watch("newPassword") ?? ""} />;
};

/**
 * Changing your own password.
 *
 * The current one is required, and the server checks it too: without that,
 * an unattended signed-in browser would be enough to lock the owner out of
 * their own account.
 */
export const ChangePasswordForm = () => {
  const [changePassword, { isLoading }] = useChangePasswordMutation();

  const handleSubmit = async (
    values: ChangePasswordInput,
    methods: UseFormReturn<ChangePasswordInput>,
  ) => {
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      }).unwrap();

      toast.success("Your password has been changed");
      // Never leave a password sitting in a field once it has been used.
      methods.reset();
    } catch (error) {
      notifyApiError(error, "Could not change your password");
    }
  };

  return (
    <Form<ChangePasswordInput>
      schema={changePasswordInputSchema}
      onSubmit={handleSubmit}
      options={{
        defaultValues: {
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        },
      }}
    >
      {() => (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Changing your password does not sign you out anywhere else. If you
              think someone else has access, change it and then sign out.
            </p>
          </div>

          <PasswordField<ChangePasswordInput>
            name="currentPassword"
            label="Current password"
            placeholder="The one you use now"
            autoComplete="current-password"
            icon={<KeyRound className="size-4" />}
          />

          <div className="space-y-2">
            <PasswordField<ChangePasswordInput>
              name="newPassword"
              label="New password"
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
            <StrengthMeter />
          </div>

          <PasswordField<ChangePasswordInput>
            name="confirmPassword"
            label="Repeat new password"
            placeholder="Type it once more"
            autoComplete="new-password"
          />

          <motion.div
            whileHover={isLoading ? undefined : { scale: 1.01 }}
            whileTap={isLoading ? undefined : { scale: 0.99 }}
            transition={{ type: "spring", stiffness: 340, damping: 20 }}
          >
            <Button type="submit" className="gap-2" disabled={isLoading}>
              {isLoading ? <Spinner className="size-4" /> : null}
              {isLoading ? "Changing…" : "Change password"}
            </Button>
          </motion.div>
        </div>
      )}
    </Form>
  );
};
