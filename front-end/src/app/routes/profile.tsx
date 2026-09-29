import { KeyRound, ShieldAlert, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";

import { AppErrorBoundary } from "@/components/errors/error-fallback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { paths } from "@/config/paths";
import { useGetInvoicesQuery } from "@/api/orders";
import { useGetProfileQuery } from "@/api/profile";
import { AvatarUploader } from "@/features/profile/components/avatar-uploader";
import { ChangePasswordForm } from "@/features/profile/components/change-password-form";
import { DeleteAccount } from "@/features/profile/components/delete-account";
import { ProfileDetailsForm } from "@/features/profile/components/profile-details-form";
import { ProfileSummary } from "@/features/profile/components/profile-summary";

const ProfileSkeleton = () => (
  <div className="space-y-6">
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-8">
        <Skeleton className="size-28 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </CardContent>
    </Card>
    <div className="grid gap-3 sm:grid-cols-2">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} className="h-16 rounded-lg" />
      ))}
    </div>
  </div>
);

/**
 * A person's own account: what it holds, and everything they can change.
 *
 * Split into three tabs because the three carry different weight. Reading and
 * editing details is routine, changing a password needs the current one, and
 * closing the account is irreversible, so they do not belong on one long form
 * where a stray click could do real damage.
 */
const ProfileRoute = () => {
  const { data: user, isLoading, isError, error, refetch } =
    useGetProfileQuery();

  // The invoice list doubles as the order count on the summary. It answers 404
  // when there are none, which is a state rather than a fault.
  const { data: invoices } = useGetInvoicesQuery();
  const orders = invoices ?? [];

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-3xl pb-14">
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          title="We could not load your profile"
        />
      </div>
    );
  }

  if (isLoading || !user) {
    return (
      <div className="mx-auto w-full max-w-3xl pb-14">
        <ProfileSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl pb-14">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="mb-8 flex items-center gap-3"
      >
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
          <UserRound className="size-5" />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your profile</h1>
          <p className="text-sm text-muted-foreground">
            See and change everything on your account.
          </p>
        </div>
      </motion.header>

      <Card className="mb-6 overflow-hidden">
        {/* A soft band behind the picture, so the header reads as a profile
            rather than a form with an image on top. */}
        <div
          aria-hidden
          className="h-20 bg-linear-to-r from-primary/25 via-primary/10 to-transparent"
        />
        <CardContent className="-mt-14 flex flex-col items-center gap-4">
          <AvatarUploader
            avatar={user.avatar}
            username={user.username}
            displayName={user.displayName}
          />

          <div className="space-y-1 text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <h2 className="text-xl font-semibold">
                {user.displayName || user.username}
              </h2>
              <Badge variant="secondary" className="capitalize">
                {user.role}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="details">
        <TabsList className="mb-6">
          <TabsTrigger value="details" className="gap-1.5">
            <UserRound className="size-4" />
            Details
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5">
            <KeyRound className="size-4" />
            Password
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-1.5">
            <ShieldAlert className="size-4" />
            Danger zone
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-8"
          >
            <AppErrorBoundary>
              <ProfileSummary
                user={user}
                orderCount={orders.length}
                latestOrder={orders[0]}
              />
            </AppErrorBoundary>

            <Card>
              <CardContent className="pt-6">
                <ProfileDetailsForm user={user} />
              </CardContent>
            </Card>

            <p className="text-center text-sm text-muted-foreground">
              Looking for your receipts?{" "}
              <Link
                to={paths.invoices.getHref()}
                className="underline underline-offset-4 transition-colors hover:text-foreground"
              >
                Your invoices
              </Link>
            </p>
          </motion.div>
        </TabsContent>

        <TabsContent value="security">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <Card>
              <CardContent className="pt-6">
                <ChangePasswordForm />
              </CardContent>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="danger">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <DeleteAccount />
          </motion.div>
        </TabsContent>
      </Tabs>

      <Button asChild variant="ghost" className="mt-8 w-full sm:w-auto">
        <Link to={paths.home.getHref()}>Back to the store</Link>
      </Button>
    </div>
  );
};

export default ProfileRoute;
