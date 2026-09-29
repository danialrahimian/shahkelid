import { ImagePlus } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import * as React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError, Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  productInputSchema,
  useCreateProductMutation,
  useGetAdminProductQuery,
  useUpdateProductMutation,
  type ProductInput,
} from "@/api/admin-products";
import { PerksEditor } from "@/features/admin/components/perks-editor";
import { notifyApiError } from "@/lib/api-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BILLING_PERIODS } from "@/utils/billing-periods";
import { assetUrl } from "@/utils/asset-url";

const formVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fieldVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

/**
 * The image picker, with a live preview.
 *
 * The object URL for a freshly picked file is revoked when it is replaced, so
 * choosing several images in a row does not leak them.
 */
const ImageField = ({ existingImage }: { existingImage?: string }) => {
  const { control } = useFormContext<ProductInput>();
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);

  React.useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  const preview = objectUrl ?? assetUrl(existingImage);

  return (
    <motion.div variants={fieldVariants} className="grid gap-2">
      <Label htmlFor="product-image">image</Label>

      <Controller
        control={control}
        name="image"
        render={({ field }) => (
          <Input
            id="product-image"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              field.onChange(file);

              setObjectUrl((previous) => {
                if (previous) URL.revokeObjectURL(previous);
                return file ? URL.createObjectURL(file) : null;
              });
            }}
          />
        )}
      />

      <AnimatePresence mode="wait">
        {preview ? (
          <motion.img
            key={preview}
            src={preview}
            alt="preview"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.3 }}
            className="h-32 w-full rounded-md border border-border object-cover"
          />
        ) : (
          <motion.div
            key="placeholder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-32 w-full items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"
          >
            <ImagePlus className="size-6" />
          </motion.div>
        )}
      </AnimatePresence>

      <FieldError name="image" />
    </motion.div>
  );
};

/**
 * The billing term.
 *
 * A select rather than a text box, because the server accepts exactly three
 * values. When this was free text the catalogue filled with "/ mo", "/ 6 mo"
 * and "6 mounth", none of which the pricing page could group by.
 */
const PeriodField = () => {
  const { control } = useFormContext<ProductInput>();

  return (
    <motion.div variants={fieldVariants} className="space-y-2">
      <Label htmlFor="product-period">period</Label>

      <Controller
        control={control}
        name="period"
        render={({ field }) => (
          <Select value={field.value || undefined} onValueChange={field.onChange}>
            <SelectTrigger id="product-period" className="w-full">
              <SelectValue placeholder="Choose a billing period" />
            </SelectTrigger>
            <SelectContent className="z-1100">
              {BILLING_PERIODS.map((period) => (
                <SelectItem key={period} value={period}>
                  {period}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />

      <FieldError name="period" />
    </motion.div>
  );
};

/** The perk list, bridged into the form so its errors show like any field. */
const PerksField = () => {
  const { control } = useFormContext<ProductInput>();

  return (
    <motion.div variants={fieldVariants}>
      <Controller
        control={control}
        name="perks"
        render={({ field }) => (
          <PerksEditor perks={field.value ?? []} onChange={field.onChange} />
        )}
      />
    </motion.div>
  );
};

const SubmitButton = ({
  isSubmitting,
  label,
}: {
  isSubmitting: boolean;
  label: string;
}) => (
  <motion.div
    whileHover={isSubmitting ? undefined : { scale: 1.02 }}
    whileTap={isSubmitting ? undefined : { scale: 0.97 }}
    transition={{ type: "spring", stiffness: 340, damping: 18 }}
    className="w-full"
  >
    <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
      {isSubmitting ? <Spinner className="size-4" /> : null}
      {label}
    </Button>
  </motion.div>
);

/**
 * Adds a product, or edits one.
 *
 * Which it does depends on whether a `productId` is present. Validation is the
 * schema the request shares, so the form rejects exactly what the API would
 * and no earlier: the previous version checked fields by hand across three
 * separate effects and a pile of local state.
 */
export const ProductForm = ({
  productId,
  onSaved,
}: {
  productId?: string;
  onSaved: () => void;
}) => {
  const isEdit = Boolean(productId);

  const { data: existing, isLoading: isLoadingProduct } =
    useGetAdminProductQuery(productId ?? "", { skip: !productId });

  const [createProduct, { isLoading: isCreating }] = useCreateProductMutation();
  const [updateProduct, { isLoading: isUpdating }] = useUpdateProductMutation();
  const isSubmitting = isCreating || isUpdating;

  const handleSubmit = async (values: ProductInput) => {
    // Only a new product must carry an image; an edit may keep the old one.
    if (!isEdit && !(values.image instanceof File)) {
      toast.warning("Choose an image for the product");
      return;
    }

    try {
      if (isEdit && productId) {
        await updateProduct({ productId, input: values }).unwrap();
        toast.success(`"${values.name}" was updated`);
      } else {
        await createProduct(values).unwrap();
        toast.success(`"${values.name}" was added`);
      }
      onSaved();
    } catch (error) {
      notifyApiError(
        error,
        isEdit ? "Could not save your changes" : "Could not add the product",
      );
    }
  };

  // Wait for the record before mounting the form, so the fields are filled
  // from the start rather than being written into after the fact.
  if (isEdit && isLoadingProduct) {
    return (
      <div className="flex w-full max-w-sm items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full max-w-sm"
    >
      <Card className="relative overflow-hidden">
        <motion.span
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="absolute inset-x-0 top-0 h-0.5 origin-left bg-foreground/40"
        />

        <Form<ProductInput>
          schema={productInputSchema}
          onSubmit={handleSubmit}
          options={{
            defaultValues: {
              name: existing?.name ?? "",
              period: existing?.period as ProductInput["period"],
              price: existing?.price ?? 0,
              perks: existing?.perks ?? [],
              image: null,
            },
          }}
        >
          {() => (
            <>
              <CardHeader>
                <CardTitle>
                  {isEdit ? "Edit product" : "Add a product"}
                </CardTitle>
                <CardDescription>
                  {isEdit
                    ? "Leave the image empty to keep the current one."
                    : "Every plan needs a name, a price, a period and an image."}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <motion.div
                  variants={formVariants}
                  initial="hidden"
                  animate="show"
                  className="flex flex-col gap-6"
                >
                  <motion.div variants={fieldVariants}>
                    <InputField<ProductInput>
                      name="name"
                      label="name"
                      placeholder="Gold plan"
                    />
                  </motion.div>

                  <PeriodField />

                  <motion.div variants={fieldVariants}>
                    <InputField<ProductInput>
                      name="price"
                      label="price"
                      type="number"
                      min={0}
                      placeholder="120"
                    />
                  </motion.div>

                  <PerksField />
                  <ImageField existingImage={existing?.image} />
                </motion.div>
              </CardContent>

              <CardFooter className="mt-2 flex-col gap-2">
                <SubmitButton
                  isSubmitting={isSubmitting}
                  label={isEdit ? "Save changes" : "Add product"}
                />
              </CardFooter>
            </>
          )}
        </Form>
      </Card>
    </motion.div>
  );
};
