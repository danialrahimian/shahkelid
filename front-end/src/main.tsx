import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Served from our own domain, not Google Fonts: from Iran those are slow or
// blocked at times, and a missing font drops the whole page to a fallback.
import "@fontsource-variable/vazirmatn";

// Before the app, so the first render already has its language and direction.
import "@/lib/i18n";

import { App } from "@/app/app";
import "@/index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error('Missing <div id="root"> in index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
