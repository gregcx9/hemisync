import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

// flat-repo static files: copy to dist after build
const statics = ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png"];

export default defineConfig({
  plugins: [
    react(),
    {
      name: "copy-flat-statics",
      closeBundle() {
        for (const f of statics) {
          try { copyFileSync(resolve(f), resolve("dist", f)); } catch (e) {}
        }
      },
    },
  ],
  publicDir: false,
});
