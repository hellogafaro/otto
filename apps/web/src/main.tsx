import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@workspace/ui/globals.css";
import { ThemeProvider } from "@/components/theme-provider.tsx";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
