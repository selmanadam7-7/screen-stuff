import React from "react";
import { createRoot } from "react-dom/client";
import "../styles/cockpit.css";
import { App } from "./App";

// Dev builds expose the store so screenshots and manual poking can set up a
// board without clicking one together first. Never present in a release build.
if (import.meta.env.DEV) {
  void import("./store").then(({ useStore }) => {
    (window as unknown as Record<string, unknown>).__screenStuffStore = useStore;
  });
}

const container = document.getElementById("root");
if (!container) throw new Error("the cockpit has nowhere to mount");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
