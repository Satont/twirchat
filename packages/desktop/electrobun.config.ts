import type { ElectrobunConfig } from 'electrobun/bun'
import path from "path";
import { readFileSync } from "fs";

/**
 * TwirChat Electrobun build configuration.
 *
 * Views are built with Vite + @vitejs/plugin-vue (SFC support).
 * Electrobun copies the Vite dist output into the views:// protocol.
 */

const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));

const aliasPlugin = {
  name: "alias-resolver",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: /^@\// }, (args) => {
      let resolved = path.resolve(process.cwd(), "src", args.path.slice(2));
      if (!path.extname(resolved)) {
        resolved += ".ts";
      }
      return { path: resolved };
    });
  },
};

const config: ElectrobunConfig = {
  app: {
    description: 'Multi-platform chat manager for streamers',
    identifier: 'dev.twirchat.app',
    name: 'TwirChat',
    version: packageJson.version,
  },

  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
      plugins: [aliasPlugin],
    },
    bunVersion: '1.3.13',

    copy: {
      'dist/main/assets': 'views/main/assets',
      'dist/main/index.html': 'views/main/index.html',
    },

    linux: {
      bundleCEF: false,
      icon: 'assets/icon.png',
    },

    mac: {
      bundleCEF: false,
      icons: 'assets/icon.iconset',
    },
    watchIgnore: ['dist/**'],
    win: {
      bundleCEF: false,
      icon: 'assets/icon.ico',
    },
  },

  release: {
    baseUrl: 'https://github.com/Satont/twirchat/releases/latest/download/',
  },

  runtime: {
    backendUrl: process.env['CHATRIX_BACKEND_URL'] || 'http://127.0.0.1:3000',
    backendWsUrl: process.env['CHATRIX_BACKEND_WS_URL'] || 'ws://127.0.0.1:3000/ws',
    exitOnLastWindowClosed: true,
    nodeEnv: process.env.NODE_ENV,
  },
}

export default config
