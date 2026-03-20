import type { ElectrobunConfig } from "electrobun/bun";

/**
 * Chatrix Electrobun build configuration.
 *
 * Views are built with Vite + @vitejs/plugin-vue (SFC support).
 * Electrobun copies the Vite dist output into the views:// protocol.
 */
const config: ElectrobunConfig = {
  app: {
    name: "Chatrix",
    identifier: "dev.chatrix.app",
    version: "0.1.0",
    description: "Multi-platform chat manager for streamers",
  },

  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },

    copy: {
      "dist/main/index.html": "views/main/index.html",
      "dist/main/assets": "views/main/assets",
      "dist/overlay/index.html": "views/overlay/index.html",
      "dist/overlay/assets": "views/overlay/assets",
    },

    watchIgnore: ["dist/**"],
  },

  runtime: {
    exitOnLastWindowClosed: true,
  },
};

export default config;
