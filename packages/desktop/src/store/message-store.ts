import { getDb } from "./db";
import type { NormalizedChatMessage } from "@twirchat/shared/types";

const MAX_STORED = 1000;
const DEFAULT_LOAD_COUNT = 100;

export const MessageStore = {
  save(msg: NormalizedChatMessage): void {
    const db = getDb();

    db.run(
      `INSERT OR REPLACE INTO chat_messages (id, platform, channel_id, author_id, author_name, text, type, created_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        msg.platform,
        msg.channelId,
        msg.author.id,
        msg.author.displayName,
        msg.text,
        msg.type,
        new Date(msg.timestamp).getTime(),
        JSON.stringify(msg),
      ],
    );

    // Trim to MAX_STORED — delete oldest rows beyond the limit
    db.run(
      `DELETE FROM chat_messages
       WHERE created_at <= (
         SELECT created_at FROM chat_messages
         ORDER BY created_at DESC
         LIMIT 1 OFFSET ?
       )`,
      [MAX_STORED - 1],
    );
  },

  getRecent(limit: number = DEFAULT_LOAD_COUNT): NormalizedChatMessage[] {
    const db = getDb();

    const rows = db
      .query<{ data: string; created_at: number }, [number]>(
        `SELECT data, created_at FROM chat_messages
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit);

    return rows
      .map((row) => {
        try {
          const msg = JSON.parse(row.data) as NormalizedChatMessage;
          // Ensure timestamp is a proper Date (JSON stringify turns it into string)
          msg.timestamp = new Date(msg.timestamp);
          return msg;
        } catch {
          return null;
        }
      })
      .filter((m): m is NormalizedChatMessage => m !== null)
      .reverse(); // oldest first (newest last) to match chat display order
  },
};
