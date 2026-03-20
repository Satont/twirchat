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
      "@twirchat/shared/types": resolve(__dirname, "../shared/types.ts"),
      "@twirchat/shared/constants": resolve(__dirname, "../shared/constants.ts"),
      "@twirchat/shared/protocol": resolve(__dirname, "../shared/protocol.ts"),
      "@twirchat/shared": resolve(__dirname, "../shared/index.ts"),
      "@desktop": resolve(__dirname, "src"),
    },
  },
});
