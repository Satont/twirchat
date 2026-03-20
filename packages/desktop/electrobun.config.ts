import type { ElectrobunConfig } from "electrobun/bun";

/**
 * TwirChat Electrobun build configuration.
 *
 * Views are built with Vite + @vitejs/plugin-vue (SFC support).
 * Electrobun copies the Vite dist output into the views:// protocol.
 */
const config: ElectrobunConfig = {
  app: {
    name: "TwirChat",
    identifier: "dev.twirchat.app",
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

    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },

  runtime: {
    exitOnLastWindowClosed: true,
  },
};

export default config;
