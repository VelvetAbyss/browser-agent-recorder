import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const isContentBuild = process.env.BUILD_TARGET === "content";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom"
  },
  build: isContentBuild
    ? {
        // Content scripts run as classic scripts in an isolated world and
        // cannot ES-import other chunks. Build the content entry as a single
        // self-contained IIFE bundle.
        emptyOutDir: false,
        rollupOptions: {
          input: {
            content: resolve(__dirname, "src/content/recorder.ts")
          },
          preserveEntrySignatures: false,
          output: {
            entryFileNames: "assets/[name].js",
            format: "iife",
            inlineDynamicImports: true
          }
        }
      }
    : {
        emptyOutDir: true,
        rollupOptions: {
          input: {
            popup: resolve(__dirname, "popup.html"),
            editor: resolve(__dirname, "editor.html"),
            background: resolve(__dirname, "src/background/serviceWorker.ts")
          },
          output: {
            entryFileNames: "assets/[name].js",
            chunkFileNames: "assets/[name].js",
            assetFileNames: "assets/[name][extname]"
          }
        }
      }
});
