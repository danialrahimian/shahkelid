import * as React from "react";
import { Provider as ReduxProvider } from "react-redux";

import { ErrorFallback } from "@/components/errors/error-fallback";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { store } from "@/stores";
import { ErrorBoundary } from "react-error-boundary";

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
          {children}
          <Toaster richColors closeButton position="top-center" />
        </ThemeProvider>
      </ReduxProvider>
    </ErrorBoundary>
  </React.Suspense>
);
