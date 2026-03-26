import { Electroview } from "electrobun/view";
import { createApp } from "vue";
import App from "./App.vue";
import type { TwirChatRPCSchema } from "../../shared/rpc";

// ----------------------------------------------------------------
// Set up Electrobun RPC on the webview side
// ----------------------------------------------------------------

export const rpc = Electroview.defineRPC<TwirChatRPCSchema>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {},
    messages: {},
  },
});

const view = new Electroview({ rpc });

// ----------------------------------------------------------------
// Wait for the RPC WebSocket to open before mounting Vue,
// so rpc.request.* calls in onMounted don't race against the socket.
// ----------------------------------------------------------------

function waitForSocket(): Promise<void> {
  return new Promise((resolve) => {
    function check() {
      const socket = (view as unknown as { bunSocket?: WebSocket }).bunSocket;
      if (!socket) {
        // bunSocket not assigned yet — poll in next microtask
        setTimeout(check, 10);
        return;
      }
      if (socket.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => resolve(), { once: true });
        return;
      }
      resolve(); // CLOSED / unknown — mount anyway
    }
    check();
  });
}

await waitForSocket();

// ----------------------------------------------------------------
// Mount Vue app
// ----------------------------------------------------------------

createApp(App).mount("#app");
