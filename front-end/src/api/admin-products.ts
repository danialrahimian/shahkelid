import * as z from "zod";

import { api } from "@/lib/api";
import { BILLING_PERIODS } from "@/utils/billing-periods";
import { imageFileSchema } from "@/utils/image-upload";
import type { AdminProductRef, CreatedProduct, Product } from "@/types/api";

/**
 * Product administration. Every endpoint here is behind a role check on the
 * server, so a viewer without one gets 403 no matter what the UI shows.
 */

/** Mirrors the validator chain on `POST /admin`, so the form catches what the API would. */
export const productInputSchema = z.object({
  name: z
    .string()
    .min(2, "Name must have more than 2 characters")
    .regex(
      /^[\p{L}\p{N}_ -]+$/u,
      "Name can only contain letters, numbers, spaces and dashes",
    ),
  // The server accepts exactly these three, so the form cannot offer more.
  period: z.enum(BILLING_PERIODS, {
    message: "Choose a billing period",
  }),
  price: z.coerce
    .number()
    .int("Price must be a whole number")
    .min(0, "Price cannot be negative"),
  perks: z
    .array(z.string().min(1, "A perk cannot be empty"))
    .min(1, "Add at least one perk"),
  image: imageFileSchema,
});
export type ProductInput = z.infer<typeof productInputSchema>;

/**
 * The form is multipart because it carries a file, so the perk list travels as
 * JSON inside one field.
 */
const toFormData = (input: ProductInput) => {
  const formData = new FormData();
  formData.append("name", input.name);
  formData.append("period", input.period);
  formData.append("price", String(input.price));
  formData.append("perks", JSON.stringify(input.perks));
  if (input.image instanceof File) {
    formData.append("image", input.image);
  }
  return formData;
};

export const adminProductsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getAdminProducts: builder.query<AdminProductRef[], void>({
      query: () => "/admin-products",
      providesTags: ["AdminProduct"],
    }),

    getAdminProduct: builder.query<Product, string>({
      query: (productId) => `/admin-product/${productId}`,
      providesTags: (_result, _error, productId) => [
        { type: "AdminProduct", id: productId },
      ],
    }),

    createProduct: builder.mutation<CreatedProduct, ProductInput>({
      query: (input) => ({
        url: "/admin",
        method: "POST",
        body: toFormData(input),
      }),
      invalidatesTags: ["AdminProduct", { type: "Product", id: "LIST" }],
    }),

    updateProduct: builder.mutation<
      CreatedProduct,
      { productId: string; input: ProductInput }
    >({
      query: ({ productId, input }) => ({
        url: `/admin/${productId}`,
        method: "PUT",
        body: toFormData(input),
      }),
      invalidatesTags: (_result, _error, { productId }) => [
        "AdminProduct",
        { type: "Product", id: productId },
        { type: "AdminProduct", id: productId },
        { type: "Product", id: "LIST" },
      ],
    }),

    // POST rather than DELETE because that is the verb the API exposes.
    deleteProduct: builder.mutation<AdminProductRef[], string>({
      query: (productId) => ({ url: `/product/${productId}`, method: "POST" }),
      // Deleting pulls the product out of every cart, so those are stale too.
      invalidatesTags: [
        "AdminProduct",
        { type: "Product", id: "LIST" },
        "Cart",
        "Session",
      ],
    }),
  }),
});

export const {
  useGetAdminProductsQuery,
  useGetAdminProductQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
} = adminProductsApi;
