import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { useDispatch, useSelector } from "react-redux";

import { api } from "@/lib/api";
import { uiReducer } from "@/stores/ui-store";

/**
 * Two kinds of state, kept apart on purpose.
 *
 * `api` holds the server cache: anything fetched from the backend, with its
 * own loading, error and invalidation handling. `ui` holds the small amount of
 * state the client itself owns. The old store mixed both into five slices of
 * hand-written `status: "loading" | "succeeded" | "failed"` fields, one set per
 * request, which is what most of the deleted boilerplate was.
 */
export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(api.middleware),
  devTools: import.meta.env.DEV,
});

// Refetches when the tab regains focus or the connection comes back.
setupListeners(store.dispatch);

export type AppStore = typeof store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

/** Typed hooks, so a selector never has to annotate the root state by hand. */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
