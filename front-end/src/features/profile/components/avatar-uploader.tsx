import { Camera, Trash2, UserRound } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  avatarFileSchema,
  useRemoveAvatarMutation,
  useUpdateAvatarMutation,
} from "@/api/profile";
import { notifyApiError } from "@/lib/api-client";
import { assetUrl } from "@/utils/asset-url";

/**
 * The profile picture, with everything needed to change it.
 *
 * The file is validated in the browser before it is sent, using the same
 * limits the server enforces, so an oversized image is refused instantly
 * rather than after a five megabyte upload.
 */
export const AvatarUploader = ({
  avatar,
  username,
  displayName,
}: {
  avatar: string | null | undefined;
  username: string;
  displayName?: string;
}) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const shouldReduceMotion = useReducedMotion();

  const [updateAvatar, { isLoading: isUploading }] = useUpdateAvatarMutation();
  const [removeAvatar, { isLoading: isRemoving }] = useRemoveAvatarMutation();
  const isBusy = isUploading || isRemoving;

  // Shown the instant a file is picked, so the change feels immediate rather
  // than waiting for the round trip.
  const [preview, setPreview] = React.useState<string | null>(null);

  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const shown = preview ?? assetUrl(avatar);
  const initials = (displayName || username).slice(0, 2).toUpperCase();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    const parsed = avatarFileSchema.safeParse(file);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "That file will not do");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return objectUrl;
    });

    try {
      await updateAvatar(file).unwrap();
      toast.success("Your picture has been updated");
    } catch (error) {
      // Put the old picture back: the new one was never saved.
      setPreview(null);
      URL.revokeObjectURL(objectUrl);
      notifyApiError(error, "Could not upload that picture");
    }
  };

  const handleRemove = async () => {
    try {
      await removeAvatar().unwrap();
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      toast.success("Your picture has been removed");
    } catch (error) {
      notifyApiError(error, "Could not remove your picture");
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 20 }}
        className="group relative"
      >
        {/* A halo that turns slowly behind the picture. */}
        {!shouldReduceMotion ? (
          <motion.span
            aria-hidden
            className="absolute -inset-1.5 rounded-full bg-conic from-primary/40 via-transparent to-primary/40 opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100"
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          />
        ) : null}

        <div className="relative size-28 overflow-hidden rounded-full border-2 border-border bg-muted">
          <AnimatePresence mode="wait">
            {shown ? (
              <motion.img
                key={shown}
                src={shown}
                alt={`${displayName || username}'s profile picture`}
                initial={{ opacity: 0, scale: 1.08 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="size-full object-cover"
              />
            ) : (
              <motion.div
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex size-full items-center justify-center bg-primary/10 text-xl font-semibold text-primary"
              >
                {initials || <UserRound className="size-8" />}
              </motion.div>
            )}
          </AnimatePresence>

          {/* The whole picture is the button: click it to choose a new one. */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isBusy}
            aria-label="Change your profile picture"
            className="absolute inset-0 grid place-items-center bg-black/55 text-white opacity-0 transition-opacity duration-200 hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <Spinner className="size-6" />
            ) : (
              <Camera className="size-6" />
            )}
          </button>
        </div>
      </motion.div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          // Reset so picking the same file twice still fires a change.
          event.target.value = "";
        }}
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => inputRef.current?.click()}
          disabled={isBusy}
        >
          <Camera className="size-4" />
          {shown ? "Change picture" : "Add a picture"}
        </Button>

        <AnimatePresence>
          {avatar ? (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground hover:text-destructive"
                onClick={handleRemove}
                disabled={isBusy}
              >
                {isRemoving ? (
                  <Spinner className="size-4" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Remove
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <p className="text-xs text-muted-foreground">
        PNG, JPEG, WEBP or GIF, up to 5MB.
      </p>
    </div>
  );
};
