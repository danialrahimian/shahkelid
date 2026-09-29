import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * State the client owns, as opposed to state the server owns.
 *
 * Deliberately small. Anything that comes from the API belongs in the query
 * cache, and anything only one component cares about belongs in that component.
 */
type UiState = {
  /** Whether the mobile navigation drawer is open. */
  isMobileNavOpen: boolean;
  /** Which product the catalogue is showing in a detail dialog, if any. */
  activeProductId: string | null;
};

const initialState: UiState = {
  isMobileNavOpen: false,
  activeProductId: null,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    mobileNavOpened: (state) => {
      state.isMobileNavOpen = true;
    },
    mobileNavClosed: (state) => {
      state.isMobileNavOpen = false;
    },
    activeProductChanged: (state, action: PayloadAction<string | null>) => {
      state.activeProductId = action.payload;
    },
  },
});

export const { mobileNavOpened, mobileNavClosed, activeProductChanged } =
  uiSlice.actions;

export const uiReducer = uiSlice.reducer;
