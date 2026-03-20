import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { initDb, getDb } from "@desktop/store/db";
import { AccountStore } from "@desktop/store/account-store";
import { SettingsStore } from "@desktop/store/settings-store";
import { DEFAULT_SETTINGS } from "@twirchat/shared/types";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB = "/tmp/twirchat-test.sqlite";

describe("Database", () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    initDb(TEST_DB);
  });

  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  test("creates tables on init", () => {
    const db = getDb();
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r) => r.name);

    expect(tables).toContain("accounts");
    expect(tables).toContain("settings");
    expect(tables).toContain("chat_messages");
  });
});

describe("AccountStore", () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    initDb(TEST_DB);
  });

  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  test("upsert and findByPlatform", () => {
    AccountStore.upsert({
      id: "kick:12345",
      platform: "kick",
      platformUserId: "12345",
      username: "testuser",
      displayName: "Test User",
      accessToken: "access_token_123",
      refreshToken: "refresh_token_456",
      scopes: ["user:read", "chat:write"],
    });

    const account = AccountStore.findByPlatform("kick");
    expect(account).not.toBeNull();
    expect(account!.username).toBe("testuser");
    expect(account!.displayName).toBe("Test User");
    expect(account!.platform).toBe("kick");
    expect(account!.scopes).toEqual(["user:read", "chat:write"]);
  });

  test("tokens are encrypted and decryptable", () => {
    AccountStore.upsert({
      id: "twitch:999",
      platform: "twitch",
      platformUserId: "999",
      username: "streamer",
      displayName: "Streamer",
      accessToken: "secret_access_token",
      refreshToken: "secret_refresh_token",
    });

    const tokens = AccountStore.getTokens("twitch:999");
    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBe("secret_access_token");
    expect(tokens!.refreshToken).toBe("secret_refresh_token");

    // Токены в БД должны быть зашифрованы (не равны исходным)
    const db = getDb();
    const raw = db
      .query<{ access_token: string }, [string]>(
        "SELECT access_token FROM accounts WHERE id = ?"
      )
      .get("twitch:999");
    expect(raw!.access_token).not.toBe("secret_access_token");
  });

  test("upsert updates existing account", () => {
    AccountStore.upsert({
      id: "kick:1",
      platform: "kick",
      platformUserId: "1",
      username: "user1",
      displayName: "User 1",
      accessToken: "old_token",
    });

    AccountStore.upsert({
      id: "kick:1",
      platform: "kick",
      platformUserId: "1",
      username: "user1_updated",
      displayName: "User 1 Updated",
      accessToken: "new_token",
    });

    const account = AccountStore.findByPlatform("kick");
    expect(account!.username).toBe("user1_updated");
  });

  test("delete account", () => {
    AccountStore.upsert({
      id: "kick:42",
      platform: "kick",
      platformUserId: "42",
      username: "deleteme",
      displayName: "Delete Me",
      accessToken: "token",
    });

    AccountStore.delete("kick:42");
    expect(AccountStore.findByPlatform("kick")).toBeNull();
  });

  test("findAll returns all accounts", () => {
    AccountStore.upsert({
      id: "kick:1",
      platform: "kick",
      platformUserId: "1",
      username: "kick_user",
      displayName: "Kick User",
      accessToken: "kick_token",
    });

    AccountStore.upsert({
      id: "twitch:2",
      platform: "twitch",
      platformUserId: "2",
      username: "twitch_user",
      displayName: "Twitch User",
      accessToken: "twitch_token",
    });

    const all = AccountStore.findAll();
    expect(all.length).toBe(2);
  });
});

describe("SettingsStore", () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    initDb(TEST_DB);
  });

  afterEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  test("returns default settings when nothing saved", () => {
    const settings = SettingsStore.get();
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  test("update merges settings", () => {
    const updated = SettingsStore.update({ theme: "light", fontSize: 16 });
    expect(updated.theme).toBe("light");
    expect(updated.fontSize).toBe(16);
    expect(updated.showPlatformIcon).toBe(DEFAULT_SETTINGS.showPlatformIcon);
  });

  test("get returns persisted settings", () => {
    SettingsStore.update({ theme: "light" });
    const settings = SettingsStore.get();
    expect(settings.theme).toBe("light");
  });
});
