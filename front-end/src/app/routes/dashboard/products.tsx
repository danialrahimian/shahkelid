import { LayoutGrid, PackagePlus, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import * as React from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { paths } from "@/config/paths";
import { useGetAdminProductsQuery } from "@/api/admin-products";
import { AdminProductCard } from "@/features/admin/components/admin-product-card";
import { ProductForm } from "@/features/admin/components/product-form";

type ActiveTab = "products" | "form";

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const AdminProductSkeleton = () => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    <Skeleton className="h-50 w-full rounded-none" />
    <div className="flex flex-col gap-6 p-8">
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-4 w-full" />
        ))}
      </div>
      <div className="flex justify-between gap-3">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-9 w-1/2" />
      </div>
    </div>
  </div>
);

/**
 * Product administration.
 *
 * The URL decides the mode: `/dashboard/products` lists and adds,
 * `/dashboard/products/:productId` edits. That
 * makes an edit screen linkable and survives a reload, where the previous
 * version held the same information in component state alongside the route
 * parameter and could disagree with it.
 */
const ProductsRoute = () => {
  const { productId } = useParams<{ productId?: string }>();
  const navigate = useNavigate();

  // The URL wins: an edit link always opens the form. Otherwise, whichever
  // tab was last chosen. Derived on every render rather than copied into
  // state by an effect, which drew the list first and then jumped to the form.
  const [chosenTab, setChosenTab] = React.useState<ActiveTab>("products");
  const activeTab: ActiveTab = productId ? "form" : chosenTab;

  const { data, isLoading, isError, error, refetch } =
    useGetAdminProductsQuery();
  const products = data ?? [];

  const goToList = () => {
    navigate(paths.dashboardProducts.getHref());
    setChosenTab("products");
  };

  let productsContent: ReactNode;
  if (isError) {
    productsContent = (
      <motion.div key="error" exit={{ opacity: 0 }} className="w-full">
        <ErrorState
          error={error}
          onRetry={() => void refetch()}
          title="We could not load your products"
        />
      </motion.div>
    );
  } else if (isLoading) {
    productsContent = (
      <motion.div
        key="loading"
        exit={{ opacity: 0 }}
        className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {[0, 1, 2].map((index) => (
          <AdminProductSkeleton key={index} />
        ))}
      </motion.div>
    );
  } else if (products.length === 0) {
    productsContent = (
      <motion.div key="empty" exit={{ opacity: 0 }} className="w-full">
        <EmptyState
          icon={<PackagePlus className="size-8" />}
          title="You have no products yet"
          description="Add your first plan and it will show up in the catalogue."
          action={
            <Button className="gap-2" onClick={() => setChosenTab("form")}>
              <PackagePlus className="size-4" />
              Add your first product
            </Button>
          }
        />
      </motion.div>
    );
  } else {
    productsContent = (
      <motion.div
        key="grid"
        variants={gridVariants}
        initial="hidden"
        animate="show"
        className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        <AnimatePresence mode="popLayout">
          {products.map((entry, index) => (
            <AdminProductCard
              key={entry.productId}
              productId={entry.productId}
              index={index}
              onEdit={() => setChosenTab("form")}
            />
          ))}
        </AnimatePresence>
      </motion.div>
    );
  }

  const countLabel = isLoading
    ? "Loading your products"
    : `${products.length} ${products.length === 1 ? "product" : "products"}`;

  return (
    <div className="pb-14">
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
          <ShieldCheck className="size-5" />
        </motion.div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
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
      </motion.header>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = value as ActiveTab;
          setChosenTab(next);
          // Leaving the form drops the product being edited from the URL.
          if (next === "products" && productId) {
            navigate(paths.dashboardProducts.getHref());
          }
        }}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="products" className="gap-1.5">
            <LayoutGrid className="size-4" />
            All products
          </TabsTrigger>
          <TabsTrigger value="form" className="gap-1.5">
            <PackagePlus className="size-4" />
            {productId ? "edit product" : "add product"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="form">
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            {/* Keyed so switching between add and edit starts from a clean form. */}
            <ProductForm
              key={productId ?? "new"}
              productId={productId}
              onSaved={goToList}
            />
          </motion.div>
        </TabsContent>

        <TabsContent value="products">
          <AnimatePresence mode="wait">{productsContent}</AnimatePresence>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ProductsRoute;
