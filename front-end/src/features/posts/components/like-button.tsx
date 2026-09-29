import { Heart } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { paths } from "@/config/paths";
import { useToggleLikeMutation } from "@/api/posts";
import { notifyApiError } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";
import { cn } from "@/lib/utils";

/**
 * The heart.
 *
 * The state flips immediately and the request follows, because a like is
 * small, reversible and the least interesting thing to wait for. If the server
 * refuses, the optimistic update in the mutation rolls the cache back.
 */
export const LikeButton = ({
  postId,
  slug,
  likeCount,
  likedByMe,
  size = "default",
  showCount = true,
}: {
  postId: string;
  slug: string;
  likeCount: number;
  likedByMe: boolean;
  size?: "default" | "large";
  showCount?: boolean;
}) => {
  const [toggleLike] = useToggleLikeMutation();
  const { isLoggedIn, isLoading } = useSession();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  // Drives the burst of particles, which is deliberately not tied to the
  // liked state: it fires on the press, not on every re-render.
  const [burstKey, setBurstKey] = React.useState(0);

  const iconSize = size === "large" ? "size-7" : "size-5";

  const handleClick = async () => {
    if (!isLoading && !isLoggedIn) {
      toast.info("Sign in to like an article");
      navigate(paths.auth.getHref(paths.post.getHref(slug)));
      return;
    }

    if (!likedByMe) setBurstKey((previous) => previous + 1);

    try {
      await toggleLike({ postId, slug }).unwrap();
    } catch (error) {
      notifyApiError(error, "Could not register that");
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <motion.button
        type="button"
        onClick={handleClick}
        aria-pressed={likedByMe}
        aria-label={likedByMe ? "Unlike this article" : "Like this article"}
        whileTap={{ scale: 0.8 }}
        transition={{ type: "spring", stiffness: 500, damping: 18 }}
        className="relative grid place-items-center rounded-full p-1 text-foreground transition-colors hover:text-rose-500"
      >
        {/* Six sparks thrown outward on the press that adds a like. */}
        {!shouldReduceMotion && burstKey > 0 ? (
          <span aria-hidden className="pointer-events-none absolute inset-0">
            {Array.from({ length: 6 }).map((_, index) => {
              const angle = (index / 6) * Math.PI * 2;
              return (
                <motion.span
                  key={`${burstKey}-${index}`}
                  initial={{ opacity: 0.9, x: 0, y: 0, scale: 0.4 }}
                  animate={{
                    opacity: 0,
                    x: Math.cos(angle) * 22,
                    y: Math.sin(angle) * 22,
                    scale: 1,
                  }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                  className="absolute top-1/2 left-1/2 size-1.5 rounded-full bg-rose-500"
                />
              );
            })}
          </span>
        ) : null}

        <motion.span
          key={likedByMe ? "liked" : "unliked"}
          initial={
            shouldReduceMotion ? false : { scale: likedByMe ? 0.6 : 1 }
          }
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 14 }}
          className="flex"
        >
          <Heart
            className={cn(
              iconSize,
              "transition-colors",
              likedByMe && "fill-rose-500 text-rose-500",
            )}
          />
        </motion.span>
      </motion.button>

      {showCount ? (
        // Keyed on the number so it rolls rather than swapping in place.
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={likeCount}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="text-sm font-medium tabular-nums"
          >
            {likeCount}
          </motion.span>
        </AnimatePresence>
      ) : null}
    </div>
  );
};
