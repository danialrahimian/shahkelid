import { ImagePlus, Lock } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import * as React from "react";
import { Controller, useFormContext, type Path } from "react-hook-form";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { FieldError, Form } from "@/components/ui/form/form";
import { InputField } from "@/components/ui/form/input-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  postInputSchema,
  splitTags,
  useCreatePostMutation,
  useGetStaffPostQuery,
  useUpdatePostMutation,
  type PostInput,
} from "@/api/posts";
import { notifyApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { assetUrl } from "@/utils/asset-url";
import { IMAGE_ACCEPT } from "@/utils/image-upload";

const formVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

const fieldVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

/**
 * A labelled text area wired to the form, with a count that appears once the
 * limit is close enough to matter.
 */
const TextAreaField = ({
  name,
  label,
  description,
  rows,
  maxLength,
  placeholder,
}: {
  name: Path<PostInput>;
  label: string;
  description?: string;
  rows: number;
  maxLength: number;
  placeholder?: string;
}) => {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<PostInput>();
  const id = React.useId();
  const length = String(watch(name) ?? "").length;
  const hasError = Boolean(errors[name]);

  return (
    <motion.div variants={fieldVariants} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {length > maxLength * 0.8 ? (
          <span
            className={cn(
              "text-xs tabular-nums",
              length > maxLength ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {length} / {maxLength}
          </span>
        ) : null}
      </div>

      <textarea
        id={id}
        rows={rows}
        dir="auto"
        placeholder={placeholder}
        aria-invalid={hasError}
        className="flex w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm leading-6 shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
        {...register(name)}
      />

      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      <FieldError name={name} />
    </motion.div>
  );
};

/** The tags, with a preview of exactly what will be stored. */
const TagsField = () => {
  const { watch } = useFormContext<PostInput>();
  const tags = splitTags(watch("tags") ?? "");

  return (
    <motion.div variants={fieldVariants} className="space-y-2">
      <InputField<PostInput>
        name="tags"
        label="tags"
        placeholder="privacy, dns, public wi-fi"
        description="Separated by commas. Up to 8. Readers filter the journal by these."
      />

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="font-normal">
              #{tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
};

/**
 * The cover picker, with a live preview.
 *
 * The object URL for a freshly picked file is revoked when it is replaced, so
 * choosing several images in a row does not leak them.
 */
const CoverField = ({ existingCover }: { existingCover?: string }) => {
  const { control } = useFormContext<PostInput>();
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);

  React.useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  const preview = objectUrl ?? assetUrl(existingCover);

  return (
    <motion.div variants={fieldVariants} className="grid gap-2">
      <Label htmlFor="post-cover">cover image</Label>

      <AnimatePresence mode="wait">
        {preview ? (
          <motion.img
            key={preview}
            src={preview}
            alt="Cover preview"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3 }}
            className="aspect-square w-full rounded-lg border border-border object-cover"
          />
        ) : (
          <motion.div
            key="placeholder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground"
          >
            <ImagePlus className="size-7" />
            <span className="text-xs">Square works best in the journal</span>
          </motion.div>
        )}
      </AnimatePresence>

      <Controller
        control={control}
        name="cover"
        render={({ field }) => (
          <Input
            id="post-cover"
            type="file"
            accept={IMAGE_ACCEPT}
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

      <FieldError name="cover" />
    </motion.div>
  );
};

/**
 * Writes a post, or edits one.
 *
 * The address and the reading time are not fields: the server works both out,
 * the address once from the first title and never again, so a link that has
 * already been shared keeps working after the title is polished.
 */
export const PostForm = ({
  postId,
  onSaved,
}: {
  postId?: string;
  onSaved: () => void;
}) => {
  const isEdit = Boolean(postId);

  const {
    data: existing,
    isLoading: isLoadingPost,
    isError,
    error,
    refetch,
  } = useGetStaffPostQuery(postId ?? "", { skip: !postId });

  const [createPost, { isLoading: isCreating }] = useCreatePostMutation();
  const [updatePost, { isLoading: isUpdating }] = useUpdatePostMutation();
  const isSubmitting = isCreating || isUpdating;

  const handleSubmit = async (values: PostInput) => {
    // Only a new post must carry a cover; an edit may keep the old one.
    if (!isEdit && !(values.cover instanceof File)) {
      toast.warning("Choose a cover image for the post");
      return;
    }

    try {
      if (isEdit && postId) {
        await updatePost({ postId, input: values }).unwrap();
        toast.success("Your changes are live");
      } else {
        await createPost(values).unwrap();
        toast.success("Published to the journal");
      }
      onSaved();
    } catch (submitError) {
      notifyApiError(
        submitError,
        isEdit ? "Could not save your changes" : "Could not publish the post",
      );
    }
  };

  if (isEdit && isLoadingPost) {
    return (
      <div className="flex w-full items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (isEdit && isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="We could not load this post"
      />
    );
  }

  // Reached by URL rather than from a button, since the button is not
  // offered. The server would refuse the save; saying so up front is kinder
  // than letting somebody rewrite an article first.
  if (isEdit && existing && !existing.canEdit) {
    return (
      <EmptyState
        icon={<Lock className="size-8" />}
        title="This post is not yours to edit"
        description={`Only ${existing.author.name}, who wrote it, can change it.`}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full max-w-4xl"
    >
      <Card className="relative overflow-hidden">
        <motion.span
          aria-hidden
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="absolute inset-x-0 top-0 h-0.5 origin-left bg-foreground/40"
        />

        <Form<PostInput>
          schema={postInputSchema}
          onSubmit={handleSubmit}
          options={{
            defaultValues: {
              title: existing?.title ?? "",
              excerpt: existing?.excerpt ?? "",
              content: existing?.content ?? "",
              tags: existing?.tags.join(", ") ?? "",
              cover: null,
            },
          }}
        >
          {() => (
            <>
              <CardHeader>
                <CardTitle>{isEdit ? "Edit post" : "Write a post"}</CardTitle>
                <CardDescription>
                  {isEdit
                    ? "Leave the cover empty to keep the current one. The address stays the same, so links already shared keep working."
                    : "It goes live in the journal as soon as you publish, under your name."}
                </CardDescription>
              </CardHeader>

              <CardContent>
                <motion.div
                  variants={formVariants}
                  initial="hidden"
                  animate="show"
                  className="grid gap-6 md:grid-cols-[1fr_16rem]"
                >
                  <div className="flex min-w-0 flex-col gap-6">
                    <motion.div variants={fieldVariants}>
                      <InputField<PostInput>
                        name="title"
                        label="title"
                        dir="auto"
                        placeholder="Why your ISP can see more than you think"
                      />
                    </motion.div>

                    <TextAreaField
                      name="excerpt"
                      label="summary"
                      rows={3}
                      maxLength={300}
                      description="One or two lines, shown on the card before anyone opens the article."
                    />

                    <TextAreaField
                      name="content"
                      label="article"
                      rows={16}
                      maxLength={50_000}
                      description="Plain text. Leave a blank line between paragraphs."
                    />

                    <TagsField />
                  </div>

                  <CoverField existingCover={existing?.coverImage} />
                </motion.div>
              </CardContent>

              <CardFooter className="justify-end">
                <motion.div
                  whileHover={isSubmitting ? undefined : { scale: 1.02 }}
                  whileTap={isSubmitting ? undefined : { scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 340, damping: 18 }}
                >
                  <Button
                    type="submit"
                    className="gap-2"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? <Spinner className="size-4" /> : null}
                    {isEdit ? "Save changes" : "Publish"}
                  </Button>
                </motion.div>
              </CardFooter>
            </>
          )}
        </Form>
      </Card>
    </motion.div>
  );
};
