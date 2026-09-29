import { motion } from "motion/react";
import { Outlet, useLocation } from "react-router";

import { AppErrorBoundary } from "@/components/errors/error-fallback";
import { Navbar } from "@/components/layouts/navbar";

/**
 * The frame every page renders inside.
 *
 * The boundary sits here rather than around the whole application, so a page
 * that throws keeps the navigation usable and the visitor can go somewhere
 * else instead of reloading. Keying it on the pathname means moving to another
 * route clears the error on its own.
 */
export const AppRoot = () => {
  const { pathname } = useLocation();

  return (
    <div className="relative container mx-auto px-4 pt-22">
      <Navbar />

      <AppErrorBoundary resetKeys={[pathname]}>
        {/* Pages fade up as they mount, so navigation reads as a transition
            rather than a hard cut. */}
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <Outlet />
        </motion.main>
      </AppErrorBoundary>
    </div>
  );
};

export default AppRoot;
