import { emoteStore, type EmoteCacheEntry } from "./emote-store";

export interface ParsedEmote {
  id: string;
  name: string;
  imageUrl: string;
  animated: boolean;
  zeroWidth: boolean;
  aspectRatio: number;
  start: number;
  end: number;
}

export interface ParsedMessage {
  text: string;
  parts: Array<{ type: "text"; content: string } | { type: "emote"; emote: ParsedEmote }>;
  emotes: ParsedEmote[];
}

export function parseMessageWithEmotes(messageText: string): ParsedMessage {
  const parts: ParsedMessage["parts"] = [];
  const emotes: ParsedEmote[] = [];

  const tokens = messageText.split(/(\s+)/);
  let currentPosition = 0;

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      parts.push({ type: "text", content: token });
      currentPosition += token.length;
      continue;
    }

    const emote = emoteStore.getEmoteByAlias(token);
    if (emote) {
      const parsedEmote: ParsedEmote = {
        id: emote.id,
        name: emote.name,
        imageUrl: emote.imageUrl,
        animated: emote.animated,
        zeroWidth: emote.zeroWidth,
        aspectRatio: emote.aspectRatio,
        start: currentPosition,
        end: currentPosition + token.length,
      };

      parts.push({ type: "emote", emote: parsedEmote });
      emotes.push(parsedEmote);
    } else {
      parts.push({ type: "text", content: token });
    }

    currentPosition += token.length;
  }

  return {
    text: messageText,
    parts,
    emotes,
  };
}

export function hasEmotes(messageText: string): boolean {
  const tokens = messageText.split(/\s+/);
  for (const token of tokens) {
    if (emoteStore.getEmoteByAlias(token)) {
      return true;
    }
  }
  return false;
}

export function getEmotesInMessage(messageText: string): ParsedEmote[] {
  const emotes: ParsedEmote[] = [];
  const tokens = messageText.split(/(\s+)/);
  let currentPosition = 0;

  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      currentPosition += token.length;
      continue;
    }

    const emote = emoteStore.getEmoteByAlias(token);
    if (emote) {
      emotes.push({
        id: emote.id,
        name: emote.name,
        imageUrl: emote.imageUrl,
        animated: emote.animated,
        zeroWidth: emote.zeroWidth,
        aspectRatio: emote.aspectRatio,
        start: currentPosition,
        end: currentPosition + token.length,
      });
    }

    currentPosition += token.length;
  }

  return emotes;
}
