import { Menu } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { NavLink } from "@/components/layouts/nav-links";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The navigation on a phone: the same links as the bar, in a menu. */
export const MobileNav = ({ links }: { links: NavLink[] }) => {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.div
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: "spring", stiffness: 360, damping: 18 }}
        >
          <Button variant="outline" aria-label={t("nav.menu")}>
            <Menu />
          </Button>
        </motion.div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="absolute z-1000" align="start">
        <DropdownMenuGroup>
          {links.map((link) => (
            <DropdownMenuItem key={link.path} asChild className="cursor-pointer">
              <Link to={link.to}>
                <link.icon />
                {t(`nav.${link.label}`)}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
