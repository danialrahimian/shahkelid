import { AtSign } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { PasswordField } from "@/components/ui/form/password-field";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/config/paths";
import {
  loginInputSchema,
  useLoginMutation,
  type LoginInput,
} from "@/api/auth";
import { notifyApiError } from "@/lib/api-client";

/**
 * Signing in.
 *
 * The whole thing is one schema and two fields. It replaces a hand-rolled
 * version that kept each input in its own `useState`, validated by checking
 * for empty strings, and reported problems by pushing errors into Redux and
 * reading them back out in an effect.
 */
export const LoginForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const [login, { isLoading }] = useLoginMutation();

  const handleSubmit = async (values: LoginInput) => {
    try {
      const user = await login(values).unwrap();
      toast.success(`Welcome back, ${user.username}`);
      onSuccess();
    } catch (error) {
      notifyApiError(error, "We could not sign you in");
    }
  };

  return (
    <Form<LoginInput>
      schema={loginInputSchema}
      onSubmit={handleSubmit}
      options={{ defaultValues: { identifier: "", password: "" } }}
    >
      {() => (
        <>
          <InputField<LoginInput>
            name="identifier"
            label="Username or email"
            placeholder="you@example.com"
            autoComplete="username"
            icon={<AtSign className="size-4" />}
          />

          <div className="space-y-1.5">
            <PasswordField<LoginInput>
              name="password"
              label="Password"
              placeholder="Enter your password"
              autoComplete="current-password"
            />
            <Link
              to={paths.resetPassword.getHref()}
              className="inline-block text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Forgot your password?
            </Link>
          </div>

          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 20 }}
          >
            <Button type="submit" className="w-full gap-2" disabled={isLoading}>
              {isLoading ? <Spinner className="size-4" /> : null}
              {isLoading ? "Signing in…" : "Sign in"}
            </Button>
          </motion.div>
        </>
      )}
    </Form>
  );
};
