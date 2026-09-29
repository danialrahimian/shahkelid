import { Search, UserShield, Users } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import * as React from "react";
import type { ReactNode } from "react";

import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGetUsersQuery } from "@/api/users";
import { UserCard } from "@/features/moderator/components/user-card";
import { useSession } from "@/lib/use-session";
import { ROLES } from "@/lib/authorization";
import type { User } from "@/types/api";

const PRIVILEGED_ROLES = new Set<string>([
  ROLES.ADMIN,
  ROLES.MODERATOR,
  ROLES.OWNER,
]);

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const UserCardSkeleton = () => (
  <div className="w-full rounded-xl border border-border bg-card p-6 md:w-90">
    <div className="flex items-center gap-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-36" />
      </div>
    </div>
    <div className="mt-4 flex gap-2">
      <Skeleton className="h-6 w-20 rounded-full" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
    <Skeleton className="mt-4 h-10 w-full rounded-lg" />
    <div className="mt-4 flex gap-2">
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="h-9 w-1/2" />
    </div>
  </div>
);

/**
 * User administration.
 *
 * A search box was added because the list is unpaginated: on a real database
 * finding one account meant scrolling past every other one.
 */
const UsersRoute = () => {
  const { data, isLoading, isError, error, refetch } = useGetUsersQuery();
  const { user: currentUser } = useSession();
  const [search, setSearch] = React.useState("");

  const users = React.useMemo(() => data ?? [], [data]);

  const matching = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;

    return users.filter(
      (user) =>
        user.username.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term),
    );
  }, [users, search]);

  const admins = React.useMemo(
    () => matching.filter((user) => PRIVILEGED_ROLES.has(user.role)),
    [matching],
  );

  const renderList = (list: User[], emptyMessage: string): ReactNode => {
    if (isError) {
      return (
        <motion.div key="error" exit={{ opacity: 0 }} className="w-full">
          <ErrorState
            error={error}
            onRetry={() => void refetch()}
            title="We could not load the users"
          />
        </motion.div>
      );
    }

    if (isLoading) {
      return (
        <motion.div
          key="loading"
          exit={{ opacity: 0 }}
          className="flex flex-wrap justify-center gap-6 md:justify-start"
        >
          {[0, 1, 2].map((index) => (
            <UserCardSkeleton key={index} />
          ))}
        </motion.div>
      );
    }

    if (list.length === 0) {
      return (
        <motion.div key="empty" exit={{ opacity: 0 }} className="w-full">
          <EmptyState
            icon={<Users className="size-8" />}
            title={emptyMessage}
            description={
              search ? "No account matches that search." : undefined
            }
          />
        </motion.div>
      );
    }

    return (
      <motion.div
        key={`list-${list.length}-${search}`}
        variants={listVariants}
        initial="hidden"
        animate="show"
        className="flex flex-wrap justify-center gap-6 md:justify-start"
      >
        <AnimatePresence mode="popLayout">
          {list.map((user, index) => (
            <UserCard
              key={user._id}
              user={user}
              index={index}
              isSelf={user._id === currentUser?._id}
            />
          ))}
        </AnimatePresence>
      </motion.div>
    );
  };

  const countLabel = isLoading
    ? "Loading users"
    : `${users.length} ${users.length === 1 ? "user" : "users"}`;

  return (
    <div className="pb-14">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-8 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 18,
              delay: 0.1,
            }}
            className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <UserShield className="size-5" />
          </motion.div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">Users</h1>
            <AnimatePresence mode="wait">
              <motion.p
                key={countLabel}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="text-sm text-muted-foreground"
              >
                {countLabel}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="relative"
        >
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a user…"
            aria-label="Search users"
            className="w-full pl-9 transition-all duration-300 focus-visible:w-72 sm:w-56"
          />
        </motion.div>
      </motion.header>

      <Tabs defaultValue="users">
        <TabsList className="mb-6">
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="size-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="admins" className="gap-1.5">
            <UserShield className="size-4" />
            Staff
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <AnimatePresence mode="wait">
            {renderList(matching, "There are no users yet")}
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="admins">
          <AnimatePresence mode="wait">
            {renderList(admins, "There are no admins or moderators yet")}
          </AnimatePresence>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default UsersRoute;
