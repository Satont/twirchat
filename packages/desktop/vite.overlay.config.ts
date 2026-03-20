import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  root: "src/views/overlay",
  build: {
    outDir: resolve(__dirname, "dist/overlay"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@chatrix/shared": resolve(__dirname, "../shared/index.ts"),
      "@desktop": resolve(__dirname, "src"),
    },
  },
});
