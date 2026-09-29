import { Check, ImageOff, Pencil } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { paths } from "@/config/paths";
import {
  useDeleteProductMutation,
  useGetAdminProductQuery,
} from "@/api/admin-products";
import { notifyApiError } from "@/lib/api-client";
import { assetUrl } from "@/utils/asset-url";

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 32, scale: 0.96 },
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

const perkListVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.12 } },
};

const perkVariants: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: "easeOut" } },
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
 * One of the signed-in admin's products, with edit and delete.
 *
 * Deleting reports its own result. The old version relied on one global
 * `deleteProductStatus` flag, which meant the success toast had to be raised
 * by the page instead, and any mounted card watching that flag would have
 * fired a duplicate.
 */
export const AdminProductCard = ({
  productId,
  index = 0,
  onEdit,
}: {
  productId: string;
  index?: number;
  onEdit: () => void;
}) => {
  const navigate = useNavigate();
  const { data: product, isLoading } = useGetAdminProductQuery(productId);
  const [deleteProduct, { isLoading: isDeleting }] = useDeleteProductMutation();

  if (isLoading || !product) {
    return <AdminProductSkeleton />;
  }

  const perks = product.perks ?? [];
  const imageSrc = assetUrl(product.image);

  const handleDelete = async () => {
    try {
      await deleteProduct(product._id).unwrap();
      toast.success(`"${product.name}" was deleted`);
    } catch (error) {
      notifyApiError(error, "Could not delete this product");
    }
  };

  return (
    <motion.div
      layout
      variants={cardVariants}
      whileHover={{ y: -10 }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className="group relative h-full"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-1 rounded-xl bg-foreground/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"
      />

      <Card className="relative flex h-full flex-col overflow-hidden border-border bg-card pt-0 transition-colors duration-300 group-hover:border-foreground/30">
        <div className="relative h-50 overflow-hidden">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
              <ImageOff className="size-8" />
            </div>
          )}

          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-linear-to-t from-card via-card/10 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-foreground/25 to-transparent transition-all duration-700 group-hover:left-[150%]"
          />
        </div>

        <CardContent className="flex flex-1 flex-col gap-6 px-8 pb-2">
          <div>
            <h3 className="text-lg font-semibold">{product.name}</h3>
            <div className="mt-3 flex items-end gap-2">
              <span className="font-mono text-3xl font-extrabold tabular-nums">
                $ {product.price}
              </span>
              <span className="text-sm text-muted-foreground">
                {product.period}
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground/70 line-through">
              ${product.price * 4}
            </span>
          </div>

          <Separator className="bg-border" />

          <motion.ul
            variants={perkListVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="flex flex-col gap-3 text-sm"
          >
            {perks.map((perk) => (
              <motion.li
                key={perk}
                variants={perkVariants}
                className="flex items-center gap-2"
              >
                <motion.span
                  whileHover={{ scale: 1.3, rotate: 12 }}
                  transition={{ type: "spring", stiffness: 400, damping: 12 }}
                  className="flex"
                >
                  <Check className="size-4 shrink-0" strokeWidth={2.5} />
                </motion.span>
                {perk}
              </motion.li>
            ))}
          </motion.ul>
        </CardContent>

        <CardFooter className="mt-auto flex justify-between gap-3 pt-4">
          <ConfirmDialog
            label={isDeleting ? "deleting…" : "delete"}
            title="Delete this product?"
            description="It will also disappear from every cart that holds it. This cannot be undone."
            onConfirm={handleDelete}
            disabled={isDeleting}
            className="w-1/2"
          />

          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: "spring", stiffness: 340, damping: 18 }}
            className="w-1/2"
          >
            <Button
              className="group/edit w-full cursor-pointer gap-1.5 px-2"
              onClick={() => {
                onEdit();
                navigate(paths.dashboardProduct.getHref(product._id));
              }}
            >
              <Pencil className="size-4 transition-transform duration-300 group-hover/edit:-rotate-12" />
              edit
            </Button>
          </motion.div>
        </CardFooter>

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
      </Card>
    </motion.div>
  );
};
