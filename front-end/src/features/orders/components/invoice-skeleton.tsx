import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

/** Holds the invoice's exact shape while it loads, so nothing jumps into place. */
export const InvoiceSkeleton = () => (
  <Card className="mx-auto w-full max-w-2xl overflow-hidden border-border py-0">
    <CardHeader className="flex-row items-start justify-between gap-4 border-b border-border py-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-6 w-20 rounded-full" />
    </CardHeader>

    <CardContent className="grid gap-6 py-6 sm:grid-cols-2">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="space-y-2 sm:justify-self-end">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
    </CardContent>

    <Separator />

    <CardContent className="flex flex-col gap-4 py-6">
      {[0, 1].map((index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="size-14 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </CardContent>

    <Separator />

    <CardContent className="flex items-center justify-between py-6">
      <Skeleton className="h-4 w-14" />
      <Skeleton className="h-8 w-28" />
    </CardContent>
  </Card>
);
