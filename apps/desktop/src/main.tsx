import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import "./index.css";

// Forward Rust log::info/warn/error calls to the browser DevTools console.
// attachConsole() is a no-op in web-only builds.
attachConsole();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);
