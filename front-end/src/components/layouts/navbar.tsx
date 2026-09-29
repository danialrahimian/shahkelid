import { LogIn } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Link, useLocation, useNavigate } from "react-router";

import { MorphingText } from "@/components/animate-ui/primitives/texts/morphing";
import {
  canSeeLink,
  isLinkActive,
  NAV_LINKS,
} from "@/components/layouts/nav-links";
import { MobileNav } from "@/components/layouts/mobile-nav";
import { ModeToggle } from "@/components/layouts/mode-toggle";
import { UserMenu } from "@/components/layouts/user-menu";
import { Button } from "@/components/ui/button";
import { paths } from "@/config/paths";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSession } from "@/lib/use-session";

const MORPHING_WORDS = ["shah kelid", "best vpn", "most security"];

const navVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
};

const linkVariants: Variants = {
  hidden: { opacity: 0, y: -10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

/**
 * How many items sit in the cart, read from the session.
 *
 * The session already carries the cart, so the badge costs no extra request.
 * It pops when the number changes, which is the only feedback that an "add to
 * cart" further down the page actually landed.
 */
const CartCount = ({ count }: { count: number }) => (
  <AnimatePresence>
    {count > 0 ? (
      <motion.span
        key={count}
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.4, opacity: 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 18 }}
        className="absolute -top-2 -right-3 grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums"
      >
        {count > 99 ? "99+" : count}
      </motion.span>
    ) : null}
  </AnimatePresence>
);

export const Navbar = () => {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, isLoggedIn } = useSession();

  const links = NAV_LINKS.filter((link) =>
    canSeeLink(link, isLoggedIn, user?.role),
  );

  const cartCount =
    user?.cart?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  const authControl = isLoggedIn ? (
    <UserMenu />
  ) : (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 340, damping: 18 }}
    >
      <Button
        className="cursor-pointer gap-1.5"
        onClick={() => navigate(paths.auth.getHref())}
      >
        <LogIn className="size-4" />
        login / sign up
      </Button>
    </motion.div>
  );

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 180, damping: 22 }}
      className="fixed top-0 right-0 left-0 z-100 mx-auto mt-2 flex h-16 w-[90%] items-center justify-between rounded-2xl border border-primary/20 px-2 backdrop-blur-2xl"
    >
      <div className="flex h-full w-full items-center justify-between px-2">
        {isDesktop ? (
          <>
            <MorphingText text={MORPHING_WORDS} loop />

            <motion.nav
              variants={navVariants}
              initial="hidden"
              animate="show"
              className="flex h-full items-center gap-3"
            >
              {links.map((link) => {
                const active = isLinkActive(link, pathname);
                const Icon = link.icon;

                return (
                  <motion.div
                    key={link.path}
                    variants={linkVariants}
                    whileHover={{ y: -2 }}
                    transition={{ type: "spring", stiffness: 380, damping: 20 }}
                    className="relative"
                  >
                    <Link
                      className={`flex cursor-pointer items-center transition-colors ${
                        active
                          ? "text-foreground"
                          : "text-foreground/80 hover:text-gray-400"
                      }`}
                      to={link.to}
                    >
                      <span className="relative mr-1">
                        <Icon className="size-4" />
                        {link.path === paths.cart.path ? (
                          <CartCount count={cartCount} />
                        ) : null}
                      </span>
                      {link.label}
                    </Link>

                    {active ? (
                      // One shared underline that slides between links rather
                      // than fading out and in at each end.
                      <motion.span
                        layoutId="nav-active"
                        transition={{
                          type: "spring",
                          stiffness: 380,
                          damping: 30,
                        }}
                        className="absolute -bottom-1 left-0 h-0.5 w-full rounded-full bg-foreground"
                      />
                    ) : null}
                  </motion.div>
                );
              })}
            </motion.nav>

            <div className="flex items-center gap-2">
              <ModeToggle />
              {authControl}
            </div>
          </>
        ) : (
          <>
            <MobileNav isLoggedIn={isLoggedIn} role={user?.role} />
            <MorphingText text={MORPHING_WORDS} loop />
            <div className="flex items-center gap-2">
              <ModeToggle />
              {authControl}
            </div>
          </>
        )}
      </div>
    </motion.header>
  );
};
