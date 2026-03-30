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
    bunVersion: "1.3.11",
    bun: {
      entrypoint: "src/bun/index.ts",
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
    backendUrl: process.env["CHATRIX_BACKEND_URL"] || "http://127.0.0.1:3000",
    backendWsUrl:
      process.env["CHATRIX_BACKEND_WS_URL"] || "ws://127.0.0.1:3000/ws",
    nodeEnv: process.env.NODE_ENV,
  },
};

export default config;
