import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  plugins: [react()],
  resolve: { alias: { "@": projectRoot } },
  build: {
    outDir: fileURLToPath(new URL("../../dist-vercel", import.meta.url)),
    emptyOutDir: true,
  },
});
