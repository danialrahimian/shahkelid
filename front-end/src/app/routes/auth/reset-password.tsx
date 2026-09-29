import { AtSign, CheckCircle2, KeyRound, MailCheck } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { PasswordField } from "@/components/ui/form/password-field";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/config/paths";
import {
  resetLinkInputSchema,
  resetPasswordInputSchema,
  useResetPasswordMutation,
  useSendResetLinkMutation,
  type ResetLinkInput,
  type ResetPasswordInput,
} from "@/api/auth";
import { PasswordStrength } from "@/components/ui/password-strength";
import { notifyApiError } from "@/lib/api-client";
import { useFormContext } from "react-hook-form";

/** Reads the live password so the meter can react as it is typed. */
const StrengthMeter = () => {
  const { watch } = useFormContext<ResetPasswordInput>();
  return <PasswordStrength value={watch("newPassword") ?? ""} />;
};

/** Confirmation that a link went out, whether or not the address exists. */
const LinkSent = ({ email }: { email: string }) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center gap-4 text-center"
    >
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
        // A slow bob, so the panel does not look frozen while they go check.
        {...(shouldReduceMotion
          ? {}
          : {
              whileInView: { y: [0, -6, 0] },
              viewport: { once: false },
            })}
        className="grid size-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-500"
      >
        <MailCheck className="size-7" />
      </motion.div>

      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          If an account exists for{" "}
          <span className="font-medium text-foreground">{email}</span>, a reset
          link is on its way. The link is good for one hour.
        </p>
      </div>

      <Button asChild variant="outline">
        <Link to={paths.auth.getHref()}>Back to sign in</Link>
      </Button>
    </motion.div>
  );
};

/** Step one: ask for the address to send a link to. */
const RequestLinkForm = () => {
  const [sendResetLink, { isLoading }] = useSendResetLinkMutation();
  const [sentTo, setSentTo] = React.useState<string | null>(null);

  const handleSubmit = async (values: ResetLinkInput) => {
    try {
      await sendResetLink(values).unwrap();
      // The API answers 200 either way, on purpose: telling an anonymous
      // caller that an address is unknown hands them a list of real accounts.
      setSentTo(values.email);
    } catch (error) {
      notifyApiError(error, "We could not send the reset link");
    }
  };

  if (sentTo) return <LinkSent email={sentTo} />;

  return (
    <Form<ResetLinkInput>
      schema={resetLinkInputSchema}
      onSubmit={handleSubmit}
      options={{ defaultValues: { email: "" } }}
    >
      {() => (
        <>
          <div className="space-y-1.5 text-center">
            <h2 className="text-lg font-semibold">Reset your password</h2>
            <p className="text-sm text-muted-foreground">
              Enter your email and we will send you a link.
            </p>
          </div>

          <InputField<ResetLinkInput>
            name="email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            icon={<AtSign className="size-4" />}
          />

          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 20 }}
          >
            <Button type="submit" className="w-full gap-2" disabled={isLoading}>
              {isLoading ? <Spinner className="size-4" /> : null}
              {isLoading ? "Sending…" : "Send reset link"}
            </Button>
          </motion.div>

          <p className="text-center text-sm text-muted-foreground">
            <Link
              to={paths.auth.getHref()}
              className="transition-colors hover:text-foreground"
            >
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </Form>
  );
};

/** Step two: the visitor followed the link and can choose a new password. */
const ChooseNewPasswordForm = ({ resetToken }: { resetToken: string }) => {
  const [resetPassword, { isLoading }] = useResetPasswordMutation();
  const [done, setDone] = React.useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (values: ResetPasswordInput) => {
    try {
      await resetPassword({
        resetToken,
        newPassword: values.newPassword,
      }).unwrap();

      setDone(true);
      toast.success("Your password has been changed");
      // A moment to read the confirmation before the screen changes.
      setTimeout(() => navigate(paths.auth.getHref(), { replace: true }), 1600);
    } catch (error) {
      notifyApiError(error, "We could not change your password");
    }
  };

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 20 }}
        className="flex flex-col items-center gap-4 text-center"
      >
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 15 }}
          className="grid size-14 place-items-center rounded-full bg-emerald-500/15 text-emerald-500"
        >
          <CheckCircle2 className="size-7" />
        </motion.div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Password changed</h2>
          <p className="text-sm text-muted-foreground">
            Taking you to the sign-in screen…
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <Form<ResetPasswordInput>
      schema={resetPasswordInputSchema}
      onSubmit={handleSubmit}
      options={{ defaultValues: { newPassword: "", confirmPassword: "" } }}
    >
      {() => (
        <>
          <div className="space-y-1.5 text-center">
            <h2 className="text-lg font-semibold">Choose a new password</h2>
            <p className="text-sm text-muted-foreground">
              This link can only be used once.
            </p>
          </div>

          <div className="space-y-2">
            <PasswordField<ResetPasswordInput>
              name="newPassword"
              label="New password"
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
            <StrengthMeter />
          </div>

          <PasswordField<ResetPasswordInput>
            name="confirmPassword"
            label="Repeat password"
            placeholder="Type it once more"
            autoComplete="new-password"
          />

          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 20 }}
          >
            <Button type="submit" className="w-full gap-2" disabled={isLoading}>
              {isLoading ? <Spinner className="size-4" /> : null}
              {isLoading ? "Saving…" : "Change password"}
            </Button>
          </motion.div>
        </>
      )}
    </Form>
  );
};

/**
 * Password recovery, both halves on one route.
 *
 * Which half shows depends on whether the URL carries a token, which is what
 * distinguishes "I forgot" from "I clicked the link in the email".
 */
const ResetPasswordRoute = () => {
  const { resetToken } = useParams<{ resetToken?: string }>();

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <motion.div
          animate={{ x: [0, 40, 0], y: [0, -30, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-10 left-1/4 size-72 rounded-full bg-foreground/10 blur-3xl"
        />
        <motion.div
          animate={{ x: [0, -50, 0], y: [0, 40, 0], scale: [1, 1.2, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute right-1/4 bottom-0 size-80 rounded-full bg-primary/10 blur-3xl"
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-6 flex flex-col items-center gap-3"
      >
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: "spring",
            stiffness: 260,
            damping: 16,
            delay: 0.1,
          }}
          whileHover={{ rotate: -12, scale: 1.08 }}
          className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <KeyRound className="size-6" />
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        className="relative w-full max-w-100 overflow-hidden rounded-lg border bg-card p-6"
      >
        <motion.span
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="absolute inset-x-0 top-0 h-0.5 origin-left bg-foreground/40"
        />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={resetToken ? "choose" : "request"}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            {resetToken ? (
              <ChooseNewPasswordForm resetToken={resetToken} />
            ) : (
              <RequestLinkForm />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default ResetPasswordRoute;
