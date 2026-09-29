import {
  AtSign,
  BriefcaseBusiness,
  Check,
  Ellipsis,
  Link2,
  Mail,
  MessageCircle,
  Send,
  Share2,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { copyText } from "@/utils/clipboard";
import { postUrl, shareHref, type ShareNetwork } from "@/utils/share-links";

/**
 * Sharing a post.
 *
 * A menu rather than the browser's own share sheet alone. The sheet exists on
 * phones and on some desktops, and where it does not the button would do
 * nothing -- which is exactly how the old decorative icon behaved. The menu
 * works everywhere; the sheet is offered inside it where the device has one.
 *
 * Copying the link comes first, because it is the one that works for every
 * destination, including the ones not on the list.
 */

const NETWORKS: { key: ShareNetwork; label: string; icon: LucideIcon }[] = [
  { key: "telegram", label: "Telegram", icon: Send },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "x", label: "X", icon: AtSign },
  { key: "linkedin", label: "LinkedIn", icon: BriefcaseBusiness },
  { key: "email", label: "Email", icon: Mail },
];

/** The device's own share sheet, where there is one. */
const canShareNatively = () =>
  typeof navigator !== "undefined" && typeof navigator.share === "function";

export const ShareButton = ({
  slug,
  title,
  excerpt,
  size = "default",
}: {
  slug: string;
  title: string;
  excerpt?: string;
  size?: "default" | "large";
}) => {
  const [copied, setCopied] = React.useState(false);
  const url = postUrl(slug);
  const iconSize = size === "large" ? "size-6" : "size-5";

  // The tick reverts on its own, so a second copy shows a second tick.
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyLink = async () => {
    if (await copyText(url)) {
      setCopied(true);
      toast.success("Link copied");
    } else {
      // Nothing was copied, so hand the reader the link to copy themselves
      // rather than announcing a success that did not happen.
      toast.error("Could not copy automatically", { description: url });
    }
  };

  const shareNatively = async () => {
    try {
      await navigator.share({ title, text: excerpt, url });
    } catch (error) {
      // Closing the sheet without choosing anything is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Could not open the share sheet");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.button
          type="button"
          whileHover={{ scale: 1.12, rotate: -10 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 400, damping: 14 }}
          aria-label={`Share “${title}”`}
          className="flex items-center rounded-md text-muted-foreground transition-colors outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:text-primary"
        >
          {copied ? (
            <Check className={cn(iconSize, "text-emerald-500")} />
          ) : (
            <Share2 className={iconSize} />
          )}
        </motion.button>
      </DropdownMenuTrigger>

      {/* Above the floating navigation bar, which sits at z-100. */}
      <DropdownMenuContent align="end" className="z-1000 w-52">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Share this article
        </DropdownMenuLabel>

        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => void copyLink()}
        >
          <Link2 />
          Copy link
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {NETWORKS.map((network) => (
          <DropdownMenuItem key={network.key} asChild className="cursor-pointer">
            {/* A real link, so it can also be middle-clicked or its address
                copied from the context menu. */}
            <a
              href={shareHref(network.key, { url, title })}
              target="_blank"
              rel="noopener noreferrer"
            >
              <network.icon />
              {network.label}
            </a>
          </DropdownMenuItem>
        ))}

        {canShareNatively() ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => void shareNatively()}
            >
              <Ellipsis />
              More options…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
