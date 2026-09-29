import { AppProvider } from "@/app/provider";
import { AppRouter } from "@/app/router";

/**
 * The application: global providers on the outside, routing on the inside.
 * Splitting the two keeps the provider tree testable without a router.
 */
export const App = () => (
  <AppProvider>
    <AppRouter />
  </AppProvider>
);
