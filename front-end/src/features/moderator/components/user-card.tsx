import {
  Mail,
  User as UserIcon,
  UserShield,
  UserStar,
  type LucideIcon,
} from "lucide-react";
import { motion, type Variants } from "motion/react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeleteUserMutation } from "@/api/users";
import { EditUserForm } from "@/features/moderator/components/edit-user-form";
import { UserCartDrawer } from "@/features/moderator/components/user-cart-drawer";
import { notifyApiError } from "@/lib/api-client";
import type { Role, User } from "@/types/api";

const ROLE_META: Record<
  Role,
  { icon: LucideIcon; className: string; badge: string }
> = {
  user: {
    icon: UserIcon,
    className: "text-green-400",
    badge: "border-green-500/30 bg-green-500/10 text-green-500",
  },
  admin: {
    icon: UserShield,
    className: "text-blue-400",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-500",
  },
  owner: {
    icon: UserStar,
    className: "text-amber-400",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  },
  moderator: {
    icon: UserShield,
    className: "text-violet-400",
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-500",
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 30, scale: 0.96 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 210, damping: 24, mass: 0.9 },
  },
  exit: {
    opacity: 0,
    scale: 0.85,
    y: -20,
    transition: { duration: 0.28, ease: "easeIn" },
  },
};

/**
 * One account, with its role, its cart and the two things a moderator can do
 * to it.
 */
export const UserCard = ({
  user,
  index = 0,
  isSelf,
}: {
  user: User;
  index?: number;
  isSelf: boolean;
}) => {
  const [deleteUser, { isLoading: isDeleting }] = useDeleteUserMutation();

  const role = ROLE_META[user.role] ?? ROLE_META.user;
  const RoleIcon = role.icon;
  const items = user.cart?.items ?? [];
  const itemCount = items.length;

  const handleDelete = async () => {
    try {
      await deleteUser(user._id).unwrap();
      toast.success(`${user.username} was deleted`);
    } catch (error) {
      notifyApiError(error, "Could not delete this account");
    }
  };

  return (
    <motion.div
      layout
      variants={cardVariants}
      whileHover={{ y: -8 }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className="group relative w-full md:w-90"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-xl bg-foreground/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"
      />

      <Card className="relative h-full overflow-hidden transition-colors duration-300 group-hover:border-foreground/30">
        <motion.span
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{
            duration: 0.6,
            delay: 0.1 + index * 0.05,
            ease: "easeOut",
          }}
          className="absolute inset-x-0 top-0 h-0.5 origin-left bg-foreground/40"
        />

        <CardContent>
          <CardHeader className="min-w-0 gap-3 px-0">
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0, rotate: -25 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{
                  type: "spring",
                  stiffness: 280,
                  damping: 16,
                  delay: 0.15 + index * 0.05,
                }}
                whileHover={{ rotate: -8, scale: 1.1 }}
                className={`flex size-10 shrink-0 items-center justify-center rounded-full bg-muted ${role.className}`}
              >
                <RoleIcon className="size-5" />
              </motion.div>

              <div className="min-w-0">
                <CardTitle className="truncate">{user.username}</CardTitle>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{user.email}</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.25 + index * 0.05 }}
              >
                <Badge variant="outline" className={`gap-1.5 ${role.badge}`}>
                  <RoleIcon className="size-3.5" />
                  {user.role}
                </Badge>
              </motion.div>

              <Badge variant="secondary" className="tabular-nums">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </Badge>

              {isSelf ? <Badge variant="outline">you</Badge> : null}
            </div>

            <UserCartDrawer
              items={items}
              username={user.username}
              userId={user._id}
            />
          </CardHeader>
        </CardContent>

        <CardContent className="flex w-full gap-2">
          {/* The API refuses to let anyone delete their own account here, so
              the button says as much rather than offering a doomed action. */}
          <ConfirmDialog
            label={isDeleting ? "deleting…" : "delete user"}
            title={`Delete ${user.username}?`}
            description="Their account and cart are removed for good. This cannot be undone."
            onConfirm={handleDelete}
            disabled={isDeleting || isSelf}
            className="w-1/2 cursor-pointer"
          />

          <EditUserForm user={user} />
        </CardContent>
      </Card>
    </motion.div>
  );
};
