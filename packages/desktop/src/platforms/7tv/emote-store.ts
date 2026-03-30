import type { SevenTVEmoteSetEmote } from "./gql-client";

export interface EmoteCacheEntry {
  id: string;
  alias: string;
  name: string;
  animated: boolean;
  zeroWidth: boolean;
  aspectRatio: number;
  imageUrl: string;
  ownerId?: string;
  ownerName?: string;
}

export class EmoteStore {
  private emotesByAlias = new Map<string, EmoteCacheEntry>();
  private emotesById = new Map<string, EmoteCacheEntry>();
  private currentEmoteSetId: string | null = null;

  getEmoteByAlias(alias: string): EmoteCacheEntry | undefined {
    return this.emotesByAlias.get(alias.toLowerCase());
  }

  getEmoteById(id: string): EmoteCacheEntry | undefined {
    return this.emotesById.get(id);
  }

  getCurrentEmoteSetId(): string | null {
    return this.currentEmoteSetId;
  }

  setEmoteSetId(emoteSetId: string): void {
    this.currentEmoteSetId = emoteSetId;
  }

  clear(): void {
    this.emotesByAlias.clear();
    this.emotesById.clear();
    this.currentEmoteSetId = null;
  }

  addEmote(emote: SevenTVEmoteSetEmote): void {
    const alias = emote.alias.toLowerCase();
    const isAnimated = emote.emote.flags?.animated ?? false;
    const entry: EmoteCacheEntry = {
      id: emote.emote.id,
      alias: alias,
      name: emote.emote.defaultName,
      animated: isAnimated,
      zeroWidth: emote.flags?.zeroWidth ?? false,
      aspectRatio: emote.emote.aspectRatio ?? 1,
      imageUrl: this.buildEmoteUrl(emote.emote.id, isAnimated),
    };

    this.emotesByAlias.set(alias, entry);
    this.emotesById.set(emote.emote.id, entry);
  }

  removeEmote(emoteId: string): void {
    const entry = this.emotesById.get(emoteId);
    if (entry) {
      this.emotesByAlias.delete(entry.alias);
      this.emotesById.delete(emoteId);
    }
  }

  updateAlias(emoteId: string, newAlias: string): void {
    const entry = this.emotesById.get(emoteId);
    if (entry) {
      this.emotesByAlias.delete(entry.alias);
      entry.alias = newAlias.toLowerCase();
      this.emotesByAlias.set(entry.alias, entry);
    }
  }

  loadEmoteSet(emoteSetId: string, emotes: SevenTVEmoteSetEmote[]): void {
    this.clear();
    this.currentEmoteSetId = emoteSetId;
    for (const emote of emotes) {
      this.addEmote(emote);
    }
  }

  getAllEmotes(): EmoteCacheEntry[] {
    return Array.from(this.emotesByAlias.values());
  }

  getEmoteCount(): number {
    return this.emotesByAlias.size;
  }

  private buildEmoteUrl(emoteId: string, animated: boolean): string {
    const format = animated ? "webp" : "avif";
    return `https://cdn.7tv.app/emote/${emoteId}/4x.${format}`;
  }
}

export const emoteStore = new EmoteStore();
