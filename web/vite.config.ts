import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/hooks": { target: "http://127.0.0.1:7420", ws: false },
      "/api": { target: "http://127.0.0.1:7420", ws: false },
      "/health": "http://127.0.0.1:7420",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
