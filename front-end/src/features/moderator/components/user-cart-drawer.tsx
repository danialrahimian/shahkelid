import { PackageOpen, ShoppingBag } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { toast } from "sonner";

import { CartItemCard } from "@/components/cart-item-card";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useGetProductQuery } from "@/api/products";
import {
  useAddToUserCartMutation,
  useRemoveFromUserCartMutation,
} from "@/api/users";
import { notifyApiError } from "@/lib/api-client";
import type { CartItem } from "@/types/api";

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

/**
 * One line of somebody else's cart, edited by a moderator.
 *
 * It renders the same card the shopper sees, but the callbacks target the
 * moderator endpoints. The old component decided which set of actions to use
 * by comparing the current URL against "/cart", so the two paths were
 * entangled inside a single component.
 */
const ModeratedCartLine = ({
  item,
  userId,
  index,
}: {
  item: CartItem;
  userId: string;
  index: number;
}) => {
  const { data: product, isError: isUnavailable } = useGetProductQuery(
    item.productId,
  );
  const [addToUserCart, { isLoading: isAdding }] = useAddToUserCartMutation();
  const [removeFromUserCart, { isLoading: isRemoving }] =
    useRemoveFromUserCartMutation();

  const run = async (
    action: () => Promise<unknown>,
    failureMessage: string,
  ) => {
    try {
      await action();
    } catch (error) {
      notifyApiError(error, failureMessage);
    }
  };

  return (
    <CartItemCard
      product={product}
      quantity={item.quantity}
      index={index}
      isBusy={isAdding || isRemoving}
      isUnavailable={isUnavailable}
      onAdd={() =>
        void run(
          () => addToUserCart({ userId, productId: item.productId }).unwrap(),
          "Could not update this cart",
        )
      }
      onRemove={() =>
        void run(async () => {
          await removeFromUserCart({
            userId,
            productId: item.productId,
          }).unwrap();
          if (item.quantity === 1) {
            toast.success(`${product?.name ?? "Item"} removed`);
          }
        }, "Could not update this cart")
      }
    />
  );
};

export const UserCartDrawer = ({
  items,
  username,
  userId,
}: {
  items: CartItem[];
  username: string;
  userId: string;
}) => {
  const isEmpty = items.length === 0;

  return (
    <Drawer direction="right">
      <DrawerTrigger asChild>
        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 340, damping: 20 }}
          className="flex w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-lg border bg-foreground p-2 break-all text-background transition hover:bg-background hover:text-foreground"
        >
          <ShoppingBag className="size-4 shrink-0" />
          {`${username}'s items`}
        </motion.button>
      </DrawerTrigger>

      <DrawerContent className="z-1000">
        {isEmpty ? (
          <DrawerHeader>
            <DrawerTitle className="sr-only">{username}'s items</DrawerTitle>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="flex flex-col items-center gap-4 py-10 text-center"
            >
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <PackageOpen className="size-7" />
              </motion.div>
              <p className="text-lg font-medium">
                {username} has nothing in their cart
              </p>
            </motion.div>
          </DrawerHeader>
        ) : (
          <>
            <DrawerHeader>
              <DrawerTitle>{username}'s items</DrawerTitle>
            </DrawerHeader>

            <motion.div
              variants={listVariants}
              initial="hidden"
              animate="show"
              className="no-scrollbar flex flex-col gap-3 overflow-y-auto px-4"
            >
              {items.map((item, index) => (
                <ModeratedCartLine
                  key={item._id}
                  item={item}
                  userId={userId}
                  index={index}
                />
              ))}
            </motion.div>
          </>
        )}

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};
