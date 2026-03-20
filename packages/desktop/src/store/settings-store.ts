import { getDb } from "./db";
import type { AppSettings } from "@twirchat/shared/types";
import { DEFAULT_SETTINGS } from "@twirchat/shared/types";

export const SettingsStore = {
  get(): AppSettings {
    const db = getDb();
    const row = db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get("app_settings");

    if (!row) return { ...DEFAULT_SETTINGS };

    try {
      return JSON.parse(row.value) as AppSettings;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  },

  update(partial: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const updated = deepMerge(current, partial);
    const db = getDb();
    db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ["app_settings", JSON.stringify(updated)]
    );
    return updated;
  },

  set(settings: AppSettings): void {
    const db = getDb();
    db.run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ["app_settings", JSON.stringify(settings)]
    );
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const val = source[key];
    if (val !== undefined && val !== null) {
      if (typeof val === "object" && !Array.isArray(val)) {
        result[key] = deepMerge(target[key] as Record<string, unknown>, val as Record<string, unknown>) as T[keyof T];
      } else {
        result[key] = val as T[keyof T];
      }
    }
  }
  return result;
}
