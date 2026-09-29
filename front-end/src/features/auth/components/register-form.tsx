import { AtSign, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { PasswordField } from "@/components/ui/form/password-field";
import { Spinner } from "@/components/ui/spinner";
import {
  registerInputSchema,
  useRegisterMutation,
  type RegisterInput,
} from "@/api/auth";
import { notifyApiError } from "@/lib/api-client";
import { PasswordStrength } from "@/components/ui/password-strength";
import { useFormContext } from "react-hook-form";

/** Reads the live password so the meter can react as it is typed. */
const StrengthMeter = () => {
  const { watch } = useFormContext<RegisterInput>();
  return <PasswordStrength value={watch("password") ?? ""} />;
};

/**
 * Creating an account.
 *
 * The rules come straight from the schema the API request shares, so the
 * message shown while typing is the message the server would have sent back.
 * The old form checked lengths by hand and, when the two passwords disagreed,
 * only wrote to the console, so the button appeared to do nothing at all.
 */
export const RegisterForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const [register, { isLoading }] = useRegisterMutation();

  const handleSubmit = async (values: RegisterInput) => {
    try {
      const user = await register(values).unwrap();
      toast.success(`Welcome, ${user.username}`);
      onSuccess();
    } catch (error) {
      notifyApiError(error, "We could not create your account");
    }
  };

  return (
    <Form<RegisterInput>
      schema={registerInputSchema}
      onSubmit={handleSubmit}
      options={{ defaultValues: { username: "", email: "", password: "" } }}
    >
      {() => (
        <>
          <InputField<RegisterInput>
            name="username"
            label="Username"
            placeholder="your_name"
            autoComplete="username"
            icon={<UserRound className="size-4" />}
          />

          <InputField<RegisterInput>
            name="email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            icon={<AtSign className="size-4" />}
          />

          <div className="space-y-2">
            <PasswordField<RegisterInput>
              name="password"
              label="Password"
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
            <StrengthMeter />
          </div>

          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 340, damping: 20 }}
          >
            <Button type="submit" className="w-full gap-2" disabled={isLoading}>
              {isLoading ? <Spinner className="size-4" /> : null}
              {isLoading ? "Creating your account…" : "Create account"}
            </Button>
          </motion.div>
        </>
      )}
    </Form>
  );
};
