import { toast } from "sonner";

import { CartItemCard } from "@/components/cart-item-card";
import {
  useAddToCartMutation,
  useRemoveFromCartMutation,
} from "@/api/cart";
import { useGetProductQuery } from "@/api/products";
import { notifyApiError } from "@/lib/api-client";
import type { CartItem } from "@/types/api";

/**
 * One line of the shopper's own cart.
 *
 * Each line fetches the product it refers to. That reads like N requests, but
 * the cache is keyed by product id and shared with the catalogue, so a plan
 * already seen on the products page costs nothing here.
 */
export const CartLine = ({
  item,
  index,
}: {
  item: CartItem;
  index: number;
}) => {
  // A plan withdrawn from the catalogue answers 404 here. The line stays,
  // because it is still in the cart and still has to be removable.
  const { data: product, isError: isUnavailable } = useGetProductQuery(
    item.productId,
  );
  const [addToCart, { isLoading: isAdding }] = useAddToCartMutation();
  const [removeFromCart, { isLoading: isRemoving }] =
    useRemoveFromCartMutation();

  const handleAdd = async () => {
    try {
      await addToCart(item.productId).unwrap();
    } catch (error) {
      notifyApiError(error, "Could not update your cart");
    }
  };

  const handleRemove = async () => {
    try {
      await removeFromCart(item.productId).unwrap();
      // Only worth announcing when the line disappears entirely; a quantity
      // going from three to two is already visible on the card.
      if (item.quantity === 1) {
        toast.success(`${product?.name ?? "Item"} removed from your cart`);
      }
    } catch (error) {
      notifyApiError(error, "Could not update your cart");
    }
  };

  return (
    <CartItemCard
      product={product}
      quantity={item.quantity}
      index={index}
      isBusy={isAdding || isRemoving}
      isUnavailable={isUnavailable}
      onAdd={handleAdd}
      onRemove={handleRemove}
    />
  );
};
