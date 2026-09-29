import { Menu } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router";

import {
  canSeeLink,
  NAV_LINKS,
  type NavLink,
} from "@/components/layouts/nav-links";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Role } from "@/types/api";

/** One row of the menu, sliding in from the left after the ones above it. */
const MenuLink = ({ link, index }: { link: NavLink; index: number }) => (
  <Link to={link.to}>
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.25 }}
    >
      <DropdownMenuItem className="cursor-pointer">
        <link.icon />
        {link.label}
      </DropdownMenuItem>
    </motion.div>
  </Link>
);

export const MobileNav = ({
  isLoggedIn,
  role,
}: {
  isLoggedIn: boolean;
  role: Role | undefined;
}) => {
  const visible = NAV_LINKS.filter((link) =>
    canSeeLink(link, isLoggedIn, role),
  );
  const mainLinks = visible.filter((link) => link.group === "main");
  const panelLinks = visible.filter((link) => link.group === "panel");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.div
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92, rotate: -8 }}
          transition={{ type: "spring", stiffness: 360, damping: 18 }}
        >
          <Button variant="outline" aria-label="Open navigation">
            <Menu />
          </Button>
        </motion.div>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="absolute z-1000" align="start">
        <DropdownMenuGroup>
          {mainLinks.map((link, index) => (
            <MenuLink key={link.path} link={link} index={index} />
          ))}
        </DropdownMenuGroup>

        {panelLinks.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {panelLinks.map((link, index) => (
                <MenuLink
                  key={link.path}
                  link={link}
                  index={mainLinks.length + index}
                />
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
