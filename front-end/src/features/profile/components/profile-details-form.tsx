import { AtSign, Globe, Phone, Save, UserRound } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FieldError, Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  profileInputSchema,
  useUpdateProfileMutation,
  type ProfileInput,
} from "@/api/profile";
import { notifyApiError } from "@/lib/api-client";
import type { User } from "@/types/api";

const fieldsVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const fieldVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

const BIO_LIMIT = 300;

/**
 * The bio, with a counter that turns as it fills.
 *
 * A limit the server enforces should be visible before it is hit, not
 * discovered as a rejection after writing three hundred characters.
 */
const BioField = () => {
  const { register, watch } = useFormContext<ProfileInput>();
  const value = watch("bio") ?? "";
  const remaining = BIO_LIMIT - value.length;

  return (
    <motion.div variants={fieldVariants} className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor="profile-bio">About you</Label>
        <motion.span
          key={remaining < 40 ? "close" : "fine"}
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          className={
            remaining < 0
              ? "text-xs font-medium text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {remaining} left
        </motion.span>
      </div>

      <textarea
        id="profile-bio"
        rows={4}
        placeholder="A sentence or two about yourself."
        className="flex w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
        {...register("bio")}
      />

      <FieldError name="bio" />
    </motion.div>
  );
};

/**
 * Everything a person can change about their own account, apart from the
 * password and the picture, which have their own forms because they carry
 * their own risks.
 */
export const ProfileDetailsForm = ({ user }: { user: User }) => {
  const [updateProfile, { isLoading }] = useUpdateProfileMutation();

  const handleSubmit = async (values: ProfileInput) => {
    try {
      await updateProfile(values).unwrap();
      toast.success("Your profile has been saved");
    } catch (error) {
      notifyApiError(error, "Could not save your profile");
    }
  };

  return (
    <Form<ProfileInput>
      schema={profileInputSchema}
      onSubmit={handleSubmit}
      options={{
        defaultValues: {
          username: user.username,
          email: user.email,
          displayName: user.displayName ?? "",
          bio: user.bio ?? "",
          phone: user.phone ?? "",
          country: user.country ?? "",
        },
      }}
    >
      {({ formState }) => (
        <motion.div
          variants={fieldsVariants}
          initial="hidden"
          animate="show"
          className="space-y-5"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <motion.div variants={fieldVariants}>
              <InputField<ProfileInput>
                name="username"
                label="Username"
                autoComplete="username"
                icon={<UserRound className="size-4" />}
              />
            </motion.div>

            <motion.div variants={fieldVariants}>
              <InputField<ProfileInput>
                name="email"
                label="Email"
                type="email"
                autoComplete="email"
                icon={<AtSign className="size-4" />}
              />
            </motion.div>
          </div>

          <motion.div variants={fieldVariants}>
            <InputField<ProfileInput>
              name="displayName"
              label="Display name"
              placeholder="What should we call you?"
              description="Shown instead of your username where there is room."
            />
          </motion.div>

          <BioField />

          <div className="grid gap-5 sm:grid-cols-2">
            <motion.div variants={fieldVariants}>
              <InputField<ProfileInput>
                name="phone"
                label="Phone"
                placeholder="Optional"
                autoComplete="tel"
                icon={<Phone className="size-4" />}
              />
            </motion.div>

            <motion.div variants={fieldVariants}>
              <InputField<ProfileInput>
                name="country"
                label="Country"
                placeholder="Optional"
                autoComplete="country-name"
                icon={<Globe className="size-4" />}
              />
            </motion.div>
          </div>

          <motion.div
            variants={fieldVariants}
            whileHover={isLoading ? undefined : { scale: 1.01 }}
            whileTap={isLoading ? undefined : { scale: 0.99 }}
            transition={{ type: "spring", stiffness: 340, damping: 20 }}
            className="flex items-center gap-3"
          >
            {/* Disabled until something actually changed, so the button says
                whether there is anything to save. */}
            <Button
              type="submit"
              className="gap-2"
              disabled={isLoading || !formState.isDirty}
            >
              {isLoading ? (
                <Spinner className="size-4" />
              ) : (
                <Save className="size-4" />
              )}
              {isLoading ? "Saving…" : "Save changes"}
            </Button>

            {formState.isDirty && !isLoading ? (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-sm text-muted-foreground"
              >
                You have unsaved changes
              </motion.span>
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </Form>
  );
};
