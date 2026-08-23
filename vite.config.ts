import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Screen Stuff ships three pages out of one bundle:
//   index.html  -> the cockpit (React control surface, lives on monitor 4)
//   board.html  -> the board (the clean canvas that goes on air)
//   guest.html  -> what a guest opens, served by Rust over the local network
export default defineConfig({
  // GitHub Pages serves the demo from a sub-path; the app itself is served from
  // the root of a Tauri window. One env var rather than a second config.
  base: process.env.SCREEN_STUFF_BASE ?? "/",
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 4483,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome110",
    rollupOptions: {
      input: {
        cockpit: resolve(__dirname, "index.html"),
        board: resolve(__dirname, "board.html"),
        guest: resolve(__dirname, "guest.html"),
      },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    // Node by default; the two suites that touch DOM globals opt in with a
    // `@vitest-environment jsdom` docblock. Booting jsdom for the pure maths
    // suites cost more than running them.
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
