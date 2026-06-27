import type { Platform } from "@twirchat/shared";
import { getDb } from "./db";

interface DbRow {
  platform: string;
  platform_user_id: string;
  alias: string;
  created_at: number;
  updated_at: number;
}

export interface UserAlias {
  platform: Platform;
  platformUserId: string;
  alias: string;
  createdAt: number;
  updatedAt: number;
}

function mapRow(row: DbRow): UserAlias {
  return {
    platform: row.platform as Platform,
    platformUserId: row.platform_user_id,
    alias: row.alias,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const UserAliasStore = {
  findAll(): UserAlias[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM user_aliases")
      .all() as unknown as DbRow[];
    return rows.map(mapRow);
  },

  upsert(platform: Platform, platformUserId: string, alias: string): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO user_aliases (platform, platform_user_id, alias)
       VALUES (?, ?, ?)
       ON CONFLICT(platform, platform_user_id) DO UPDATE SET
         alias = ?,
         updated_at = unixepoch()`,
    ).run(platform, platformUserId, alias, alias);
  },

  remove(platform: Platform, platformUserId: string): void {
    const db = getDb();
    db.prepare(
      "DELETE FROM user_aliases WHERE platform = ? AND platform_user_id = ?",
    ).run(
      platform,
      platformUserId,
    );
  },
};
