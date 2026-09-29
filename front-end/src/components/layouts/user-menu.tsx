import { CreditCardIcon, LogOut, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { paths } from "@/config/paths";
import { useSession } from "@/lib/use-session";
import { useSignOut } from "@/lib/use-sign-out";
import { assetUrl } from "@/utils/asset-url";

export const UserMenu = () => {
  const { user } = useSession();
  const { signOut, isSigningOut } = useSignOut();

  // The session already carries the avatar, so showing it here costs no extra
  // request and it updates the moment a new one is uploaded.
  const avatarSrc = assetUrl(user?.avatar);
  const name = user?.displayName || user?.username || "";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.div
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 360, damping: 18 }}
        >
          <Button variant="ghost" size="icon" className="rounded-full">
            <Avatar>
              {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
              <AvatarFallback>
                {initials || <UserRound className="size-4" />}
              </AvatarFallback>
            </Avatar>
          </Button>
        </motion.div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="absolute right-0 z-1000 w-56">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span className="truncate">{name || "signed in"}</span>
          {user?.role ? (
            <Badge variant="secondary" className="capitalize">
              {user.role}
            </Badge>
          ) : null}
        </DropdownMenuLabel>

        {user?.email ? (
          <p className="truncate px-2 pb-1.5 text-xs text-muted-foreground">
            {user.email}
          </p>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <Link to={paths.profile.getHref()}>
            <DropdownMenuItem className="cursor-pointer">
              <UserRound />
              Profile
            </DropdownMenuItem>
          </Link>

          <Link to={paths.invoices.getHref()}>
            <DropdownMenuItem className="cursor-pointer">
              <CreditCardIcon />
              Invoices
            </DropdownMenuItem>
          </Link>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="mb-1 cursor-pointer"
          onSelect={(event) => {
            event.preventDefault();
            void signOut();
          }}
          disabled={isSigningOut}
        >
          {isSigningOut ? <Spinner /> : <LogOut />}
          logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
