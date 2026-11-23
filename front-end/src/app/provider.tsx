import { Direction } from "radix-ui";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Provider as ReduxProvider } from "react-redux";

import { ErrorFallback } from "@/components/errors/error-fallback";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { directionOf } from "@/lib/i18n";
import { store } from "@/stores";
import { ErrorBoundary } from "react-error-boundary";

/**
 * The language's direction for every menu, dropdown and popover (Radix
 * reads it from here, not from the page): in Persian a menu opens from the
 * right, toward the page, not out of it.
 */
const TextDirection = ({ children }: { children: React.ReactNode }) => {
  const { i18n } = useTranslation();
  return <Direction.Provider dir={directionOf(i18n.language)}>{children}</Direction.Provider>;
};

/**
 * Every global provider the application needs, in one place.
 *
 * The outermost boundary is the last resort: anything that escapes a local
 * boundary lands here rather than showing the user a white page.
 */
export const AppProvider = ({ children }: { children: React.ReactNode }) => (
  <React.Suspense
    fallback={
      <div className="flex h-dvh items-center justify-center">
        <Spinner className="size-8" />
      </div>
    }
  >
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <ReduxProvider store={store}>
        <ThemeProvider defaultTheme="dark">
          <TextDirection>
            {children}
            <Toaster richColors closeButton position="top-center" />
          </TextDirection>
        </ThemeProvider>
      </ReduxProvider>
    </ErrorBoundary>
  </React.Suspense>
);
