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
      env: "CHATRIX_*",
    },

    copy: {
      "dist/main/index.html": "views/main/index.html",
      "dist/main/assets": "views/main/assets",
    },

    watchIgnore: ["dist/**"],

    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
      defaultRenderer: "cef",
    },
    win: {
      bundleCEF: false,
    },
  },

  release: {
    baseUrl: "https://github.com/Satont/twirchat/releases/latest/download/",
  },

  runtime: {
    exitOnLastWindowClosed: true,
  },
};

export default config;
