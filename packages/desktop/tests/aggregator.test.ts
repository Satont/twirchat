import { test, expect, describe } from "bun:test";
import { ChatAggregator } from "@desktop/chat/aggregator";
import { BasePlatformAdapter } from "@desktop/platforms/base-adapter";
import type { NormalizedChatMessage, NormalizedEvent } from "@chatrix/shared/types";

class MockAdapter extends BasePlatformAdapter {
  readonly platform = "kick" as const;

  async connect(_channelSlug: string): Promise<void> {
    this.emit("status", { platform: "kick", status: "connected", mode: "anonymous" });
  }

  async disconnect(): Promise<void> {
    this.emit("status", { platform: "kick", status: "disconnected", mode: "anonymous" });
  }

  async sendMessage(_channelId: string, _text: string): Promise<void> {}

  simulateMessage(msg: NormalizedChatMessage): void {
    this.emit("message", msg);
  }

  simulateEvent(event: NormalizedEvent): void {
    this.emit("event", event);
  }
}

function makeMessage(id: string): NormalizedChatMessage {
  return {
    id,
    platform: "kick",
    channelId: "test-channel",
    author: { id: "user1", displayName: "User", badges: [] },
    text: `Message ${id}`,
    emotes: [],
    timestamp: new Date(),
    type: "message",
  };
}

describe("ChatAggregator", () => {
  test("collects messages from adapter", () => {
    const aggregator = new ChatAggregator();
    const adapter = new MockAdapter();
    aggregator.registerAdapter(adapter);

    const received: NormalizedChatMessage[] = [];
    aggregator.onMessage((msg) => received.push(msg));

    adapter.simulateMessage(makeMessage("1"));
    adapter.simulateMessage(makeMessage("2"));

    expect(received.length).toBe(2);
    expect(received[0]!.id).toBe("1");
  });

  test("deduplicates messages with same id", () => {
    const aggregator = new ChatAggregator();
    const adapter = new MockAdapter();
    aggregator.registerAdapter(adapter);

    const received: NormalizedChatMessage[] = [];
    aggregator.onMessage((msg) => received.push(msg));

    const msg = makeMessage("dup-1");
    adapter.simulateMessage(msg);
    adapter.simulateMessage(msg); // дубликат

    expect(received.length).toBe(1);
  });

  test("ring buffer limits size", () => {
    const aggregator = new ChatAggregator(5); // буфер 5 сообщений
    const adapter = new MockAdapter();
    aggregator.registerAdapter(adapter);

    for (let i = 0; i < 10; i++) {
      adapter.simulateMessage(makeMessage(`msg-${i}`));
    }

    const recent = aggregator.getRecentMessages();
    expect(recent.length).toBe(5);
    // Должны остаться последние 5
    expect(recent[recent.length - 1]!.id).toBe("msg-9");
  });

  test("onMessage unsubscribe works", () => {
    const aggregator = new ChatAggregator();
    const adapter = new MockAdapter();
    aggregator.registerAdapter(adapter);

    const received: string[] = [];
    const unsub = aggregator.onMessage((msg) => received.push(msg.id));

    adapter.simulateMessage(makeMessage("a"));
    unsub();
    adapter.simulateMessage(makeMessage("b"));

    expect(received).toEqual(["a"]);
  });

  test("emits events", () => {
    const aggregator = new ChatAggregator();
    const adapter = new MockAdapter();
    aggregator.registerAdapter(adapter);

    const events: NormalizedEvent[] = [];
    aggregator.onEvent((e) => events.push(e));

    adapter.simulateEvent({
      id: "ev1",
      platform: "kick",
      type: "follow",
      user: { id: "u1", displayName: "Follower" },
      data: {},
      timestamp: new Date(),
    });

    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe("follow");
  });
});
