import { LogIn, UserRound } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router";

import { MorphingText } from "@/components/animate-ui/primitives/texts/morphing";
import {
  canSeeLink,
  isLinkActive,
  NAV_LINKS,
} from "@/components/layouts/nav-links";
import { MobileNav } from "@/components/layouts/mobile-nav";
import { ModeToggle } from "@/components/layouts/mode-toggle";
import { useAccountSessionQuery } from "@/api/account";
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

export const Navbar = () => {
  const { t } = useTranslation();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, isLoggedIn } = useSession();

  const links = NAV_LINKS.filter((link) =>
    canSeeLink(link, isLoggedIn, user?.role),
  );

  // Signing in and the account are the new accounts (/account); the old
  // session above only still decides whether the old dashboard link shows.
  const { data: session } = useAccountSessionQuery();
  const signedIn = session?.status === "signed_in";
  const authControl = (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 340, damping: 18 }}
    >
      <Button
        className="cursor-pointer gap-1.5"
        variant={signedIn ? "outline" : "default"}
        onClick={() => navigate(signedIn ? paths.account.getHref() : paths.accountSignIn.getHref())}
      >
        {signedIn ? <UserRound className="size-4" /> : <LogIn className="size-4" />}
        {signedIn ? t("shop.nav.account") : t("shop.nav.signIn")}
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
                      <span className="relative me-1">
                        <Icon className="size-4" />
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
