import { Pencil } from "lucide-react";
import { motion, type Variants } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { FieldError, Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { PasswordField } from "@/components/ui/form/password-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  editUserInputSchema,
  useEditUserMutation,
  type EditUserInput,
} from "@/api/users";
import { useMediaQuery } from "@/hooks/use-media-query";
import { notifyApiError } from "@/lib/api-client";
import { useAuthorization } from "@/lib/authorization";
import type { Role, User } from "@/types/api";
import { Controller, useFormContext } from "react-hook-form";

const fieldsVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

const fieldVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

const ROLES: Role[] = ["user", "admin", "moderator", "owner"];

/**
 * The role picker, shown only to an owner.
 *
 * The server allows a role change for owners alone, and the old form offered
 * the field to every moderator while the API quietly ignored it: the input
 * accepted a value, the save reported success, and nothing changed.
 */
const RoleField = () => {
  const { control } = useFormContext<EditUserInput>();

  return (
    <motion.div variants={fieldVariants} className="space-y-2">
      <Label htmlFor="edit-user-role">Role</Label>
      <Controller
        control={control}
        name="role"
        render={({ field }) => (
          <Select
            value={field.value || undefined}
            onValueChange={field.onChange}
          >
            <SelectTrigger id="edit-user-role" className="w-full">
              <SelectValue placeholder="Leave unchanged" />
            </SelectTrigger>
            <SelectContent className="z-1100">
              {ROLES.map((role) => (
                <SelectItem key={role} value={role} className="capitalize">
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldError name="role" />
    </motion.div>
  );
};

const EditUserFields = ({
  user,
  isSaving,
  canChangeRole,
}: {
  user: User;
  isSaving: boolean;
  canChangeRole: boolean;
}) => (
  <motion.div
    variants={fieldsVariants}
    initial="hidden"
    animate="show"
    className="space-y-4"
  >
    <motion.div variants={fieldVariants}>
      <InputField<EditUserInput>
        name="username"
        label="Username"
        placeholder={user.username}
        autoComplete="off"
      />
    </motion.div>

    <motion.div variants={fieldVariants}>
      <InputField<EditUserInput>
        name="email"
        label="Email"
        type="email"
        placeholder={user.email}
        autoComplete="off"
      />
    </motion.div>

    {canChangeRole ? <RoleField /> : null}

    <motion.div variants={fieldVariants}>
      <PasswordField<EditUserInput>
        name="password"
        label="New password"
        placeholder="Leave blank to keep the current one"
        autoComplete="new-password"
        description="Only filled in if you want to replace it."
      />
    </motion.div>

    <motion.div
      variants={fieldVariants}
      whileHover={isSaving ? undefined : { scale: 1.02 }}
      whileTap={isSaving ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 340, damping: 20 }}
    >
      <Button type="submit" className="w-full gap-2" disabled={isSaving}>
        {isSaving ? <Spinner className="size-4" /> : null}
        {isSaving ? "Saving…" : "Save changes"}
      </Button>
    </motion.div>
  </motion.div>
);

/**
 * Editing one account, in a dialog on a wide screen and a drawer on a narrow
 * one. Blank fields mean "leave this as it is", which is what the API expects.
 */
export const EditUserForm = ({ user }: { user: User }) => {
  const [open, setOpen] = React.useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { checkPolicy } = useAuthorization();
  const [editUser, { isLoading: isSaving }] = useEditUserMutation();

  const canChangeRole = checkPolicy("user:change-role");

  const handleSubmit = async (values: EditUserInput) => {
    try {
      await editUser({ ...values, _id: user._id }).unwrap();
      toast.success(`${user.username} was updated`);
      setOpen(false);
    } catch (error) {
      notifyApiError(error, "Could not save those changes");
    }
  };

  const form = (
    <Form<EditUserInput>
      schema={editUserInputSchema}
      onSubmit={handleSubmit}
      options={{
        defaultValues: {
          _id: user._id,
          username: "",
          email: "",
          password: "",
          role: "",
        },
      }}
    >
      {() => (
        <EditUserFields
          user={user}
          isSaving={isSaving}
          canChangeRole={canChangeRole}
        />
      )}
    </Form>
  );

  const trigger = (
    <motion.div
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 340, damping: 18 }}
      className="w-1/2"
    >
      <Button className="w-full cursor-pointer gap-1.5" variant="outline">
        <Pencil className="size-4" />
        Edit profile
      </Button>
    </motion.div>
  );

  const description = `Blank fields are left unchanged. Editing ${user.username}.`;

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="z-1000">
        <DrawerHeader className="text-left">
          <DrawerTitle>Edit profile</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>

        <div className="px-4">{form}</div>

        <DrawerFooter className="pt-2">
          <DrawerClose asChild>
            <Button variant="outline">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};
