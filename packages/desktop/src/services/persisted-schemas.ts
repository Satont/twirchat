import {
  DONATION_PROVIDERS,
  DONATION_SHARE_LIMITS,
  type DonationEvent,
} from '@twirchat/shared/donations'
import type {
  SevenTVEmote,
  BackendToDesktopMessage,
  EmoteSource,
  EmoteCatalogEntry,
} from '@twirchat/shared/protocol'
import type {
  Platform,
  Badge,
  Emote,
  NormalizedChatMessage,
  HotkeySettings,
  OverlayConfig,
  SplitConfig,
  ChatLayout,
  SelfPingConfig,
  AppSettings,
  CustomPalette,
  Language,
  SplitDirection,
  SplitNode,
  PanelContent,
  PanelNode,
  LayoutNode,
  WatchedChannelsLayout,
  NormalizedEvent,
  ModerationAction,
  ModerationOutcome,
} from '@twirchat/shared/types'
import { DEFAULT_SETTINGS } from '@twirchat/shared/types'
import type {
  YouTubeChatBatch,
  YouTubeChatStatus,
  YouTubeChatRelayEvent,
} from '@twirchat/shared/youtube-chat'
import { z } from 'zod'

import { t } from '../gpuix/i18n'
import { normalizePaletteColor } from '../shared/theme-palette'
import { MAX_FEED_SOURCES } from '../views/main/utils/layout-tree'

export const platformSchema = z.toZod<Platform>()(
  z.union([z.literal('twitch'), z.literal('youtube'), z.literal('kick'), z.literal('vkplay')]),
)
export const badgeSchema = z.toZod<Badge>()(
  z.object({
    id: z.string(),
    type: z.union([
      z.literal('moderator'),
      z.literal('subscriber'),
      z.literal('vip'),
      z.literal('broadcaster'),
      z.literal('staff'),
      z.literal('gifter'),
      z.string(),
    ]),
    text: z.string(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
  }),
)
export const emoteSchema = z.toZod<Emote>()(
  z.object({
    id: z.string(),
    name: z.string(),
    imageUrl: z.string(),
    positions: z.array(z.object({ start: z.number(), end: z.number() })),
    aspectRatio: z.number().optional(),
    source: z
      .union([
        z.literal('channel'),
        z.literal('seventv'),
        z.literal('collectibles'),
        z.literal('global'),
        z.literal('bttv'),
        z.literal('ffz'),
        z.literal('personal'),
      ])
      .optional(),
    provider: z
      .union([z.literal('twitch'), z.literal('seventv'), z.literal('bttv'), z.literal('ffz')])
      .optional(),
    animated: z.boolean().optional(),
    zeroWidth: z.boolean().optional(),
    modifier: z.boolean().optional(),
  }),
)
export const normalizedChatMessageSchema = z.toZod<NormalizedChatMessage>()(
  z.object({
    id: z.string(),
    localTwitchEchoId: z.string().optional(),
    platform: platformSchema,
    channelId: z.string(),
    author: z.object({
      id: z.string(),
      username: z.string().optional(),
      displayName: z.string(),
      color: z.string().optional(),
      avatarUrl: z.string().optional(),
      badges: z.array(badgeSchema),
    }),
    text: z.string(),
    emotes: z.array(emoteSchema),
    timestamp: z.coerce.date(),
    type: z.union([z.literal('message'), z.literal('action'), z.literal('system')]),
    metadata: z
      .object({
        firstMessage: z.boolean().optional(),
        returningChatter: z.boolean().optional(),
        highlighted: z.boolean().optional(),
        rewardId: z.string().optional(),
        rewardTitle: z.string().optional(),
        bits: z.number().optional(),
        announcement: z.string().optional(),
        twitchNotice: z
          .object({
            kind: z.enum([
              'sub',
              'resub',
              'gift_sub',
              'community_gift',
              'raid',
              'reward_gift',
              'moderation',
              'modiversary',
              'watch_streak',
            ]),
            detail: z.string().optional(),
          })
          .optional(),
        sevenTvAction: z.enum(['added', 'removed', 'changed']).optional(),
        subscriptionMonths: z.number().optional(),
        rewardCost: z.number().optional(),
        flags: z.record(z.string(), z.boolean()).optional(),
        clientDetection: z.string().optional(),
        sharedChat: z
          .object({ sourceChannelId: z.string(), sourceMessageId: z.string().optional() })
          .optional(),
      })
      .optional(),
    reply: z
      .object({
        parentMessageId: z.string(),
        parentMessageText: z.string(),
        threadRootMessageId: z.string().optional(),
        parentAuthor: z.object({ id: z.string(), username: z.string(), displayName: z.string() }),
      })
      .optional(),
    delivery: z
      .object({
        state: z.union([z.literal('pending'), z.literal('confirmed'), z.literal('failed')]),
        error: z.string().optional(),
      })
      .optional(),
  }),
)
export const hotkeySettingsSchema = z.toZod<HotkeySettings>()(
  z.object({
    newTab: z.string(),
    nextTab: z.string(),
    prevTab: z.string(),
    tabSelector: z.string(),
  }),
)
export const overlayConfigSchema = z.toZod<OverlayConfig>()(
  z.object({
    background: z.string(),
    textColor: z.string(),
    fontSize: z.number(),
    fontFamily: z.string(),
    maxMessages: z.number(),
    messageTimeout: z.number(),
    showPlatformIcon: z.boolean(),
    showAvatar: z.boolean(),
    showBadges: z.boolean(),
    animation: z.union([z.literal('slide'), z.literal('fade'), z.literal('none')]),
    position: z.union([z.literal('bottom'), z.literal('top')]),
    port: z.number(),
  }),
)
export const splitConfigSchema = z.toZod<SplitConfig>()(
  z.object({
    id: z.string(),
    type: z.union([z.literal('combined'), z.literal('channel')]),
    channelId: z.string().optional(),
    size: z.number(),
  }),
)
export const chatLayoutSchema = z.toZod<ChatLayout>()(
  z.object({
    version: z.literal(1),
    mode: z.union([z.literal('combined'), z.literal('split')]),
    splits: z.array(splitConfigSchema),
  }),
)
export const selfPingConfigSchema = z.toZod<SelfPingConfig>()(
  z.object({ enabled: z.boolean(), color: z.string() }),
)
const themeSchema = z.enum([
  'dark',
  'light',
  'midnight',
  'ocean',
  'forest',
  'ember',
  'rose',
  'paper',
  'aura',
  'ayu',
  'carbonfox',
  'cobalt2',
  'cursor',
  'dracula',
  'everforest',
  'flexoki',
  'catppuccin',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'github',
  'gruvbox',
  'kanagawa',
  'material',
  'matrix',
  'mercury',
  'monokai',
  'nightowl',
  'nord',
  'one-dark',
  'opencode',
  'orng',
  'lucent-orng',
  'osaka-jade',
  'palenight',
  'rosepine',
  'solarized',
  'synthwave84',
  'tokyonight',
  'vercel',
  'vesper',
  'zenburn',
  'custom',
])
const themeModeSchema = z.enum(['dark', 'light'])
const languageSchema = z.toZod<Language>()(z.union([z.literal('en'), z.literal('ru')]))
const timestampFormatSchema = z.union([
  z.literal('HH:MM:SS'),
  z.literal('HH:MM'),
  z.literal('HH:MM:SS.sss'),
  z.literal('hh:MM A'),
  z.literal('hh:MM:SS A'),
])
const paletteColorSchema = z.string().transform((input, ctx) => {
  const color = normalizePaletteColor(input)
  if (color) return color
  ctx.addIssue({ code: 'custom', message: t('misc.persisted.paletteColor') })
  return z.NEVER
})
const customPaletteSchema = z.toZod<CustomPalette>()(
  z
    .object({
      background: paletteColorSchema,
      surface: paletteColorSchema,
      text: paletteColorSchema,
      muted: paletteColorSchema,
      accent: paletteColorSchema,
    })
    .readonly(),
)
export const appSettingsSchema = z.toZod<AppSettings>()(
  z.object({
    language: languageSchema,
    theme: themeSchema,
    themeMode: themeModeSchema,
    customPalette: customPaletteSchema.optional(),
    chatTheme: z.union([z.literal('modern'), z.literal('compact')]),
    fontFamily: z.union([z.literal('inter'), z.literal('manrope'), z.literal('system')]),
    fontSize: z.number(),
    showPlatformColorStripe: z.boolean(),
    showPlatformIcon: z.boolean(),
    showTimestamp: z.boolean(),
    timestampFormat: timestampFormatSchema.default('HH:MM:SS'),
    replyOnDoubleClick: z.boolean().default(true),
    showAvatars: z.boolean(),
    showBadges: z.boolean(),
    showChannelLabel: z.boolean(),
    showModerationRail: z.boolean().optional(),
    emoteSessionCache: z.boolean(),
    platformFilter: z.union([z.array(platformSchema), z.literal('all')]),
    hotkeys: hotkeySettingsSchema,
    overlay: overlayConfigSchema,
    autoCheckUpdates: z.boolean().optional(),
    twirIntegrationEnabled: z.boolean().optional(),
    jeetbotIntegrationEnabled: z.boolean().optional(),
    fossabotIntegrationEnabled: z.boolean().optional(),
    nightbotIntegrationEnabled: z.boolean().optional(),
    potatIntegrationEnabled: z.boolean().optional(),
    supibotIntegrationEnabled: z.boolean().optional(),
    chatLayout: chatLayoutSchema.optional(),
    selfPing: selfPingConfigSchema.optional(),
  }),
)
export const splitDirectionSchema = z.toZod<SplitDirection>()(
  z.union([z.literal('horizontal'), z.literal('vertical')]),
)
export const splitNodeSchema = z.toZod<SplitNode>()(
  z.object({
    type: z.literal('split'),
    id: z.string(),
    direction: splitDirectionSchema,
    children: z.array(z.lazy(() => layoutNodeSchema)),
    flex: z.number(),
    minSize: z.number().optional(),
  }),
)
export const panelContentSchema = z.toZod<PanelContent>()(
  z.union([
    z.object({ type: z.literal('main') }),
    z.object({
      type: z.literal('watched'),
      channelId: z.string().min(1),
      accountId: z.string().optional(),
    }),
    z.object({
      type: z.literal('feed'),
      sources: z
        .array(z.object({ channelId: z.string().min(1), accountId: z.string().optional() }))
        .min(2)
        .max(MAX_FEED_SOURCES)
        .refine(
          (sources) => new Set(sources.map(({ channelId }) => channelId)).size === sources.length,
        ),
    }),
    z.object({ type: z.literal('empty') }),
  ]),
)
export const panelNodeSchema = z.toZod<PanelNode>()(
  z.object({
    type: z.literal('panel'),
    id: z.string(),
    content: panelContentSchema,
    flex: z.number(),
  }),
)
export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([splitNodeSchema, panelNodeSchema]),
)
export const watchedChannelsLayoutSchema = z.toZod<WatchedChannelsLayout>()(
  z.object({
    version: z.literal(2),
    root: layoutNodeSchema,
    meta: z
      .object({
        createdAt: z.number(),
        updatedAt: z.number(),
        migratedFrom: z.literal('legacy').optional(),
      })
      .optional(),
  }),
)
export const normalizedEventSchema = z.toZod<NormalizedEvent>()(
  z.object({
    id: z.string(),
    platform: platformSchema,
    type: z.union([
      z.literal('follow'),
      z.literal('sub'),
      z.literal('resub'),
      z.literal('gift_sub'),
      z.literal('raid'),
      z.literal('host'),
      z.literal('bits'),
      z.literal('superchat'),
      z.literal('membership'),
    ]),
    user: z.object({ id: z.string(), displayName: z.string(), avatarUrl: z.string().optional() }),
    data: z.record(z.string(), z.unknown()),
    timestamp: z.coerce.date(),
  }),
)
export const moderationActionSchema = z.toZod<ModerationAction>()(
  z.union([z.literal('delete_message'), z.literal('timeout'), z.literal('ban')]),
)
export const moderationOutcomeSchema = z.toZod<ModerationOutcome>()(
  z.object({
    platform: platformSchema,
    channelId: z.string(),
    action: moderationActionSchema,
    messageId: z.string().optional(),
    targetUserId: z.string().optional(),
    durationSeconds: z.number().optional(),
  }),
)
export const youTubeChatBatchSchema = z.toZod<YouTubeChatBatch>()(
  z.object({
    messages: z.array(normalizedChatMessageSchema),
    events: z.array(normalizedEventSchema),
    moderation: z.array(moderationOutcomeSchema),
    ended: z.boolean().optional(),
  }),
)
export const youTubeChatStatusSchema = z.toZod<YouTubeChatStatus>()(
  z.union([
    z.literal('connecting'),
    z.literal('connected'),
    z.literal('disconnected'),
    z.literal('error'),
  ]),
)
export const youTubeChatRelayEventSchema = z.toZod<YouTubeChatRelayEvent>()(
  z.union([
    z.object({
      type: z.literal('ready'),
      subscriptionId: z.string(),
      channelId: z.string(),
      videoId: z.string(),
      liveChatId: z.string(),
    }),
    z.object({
      type: z.literal('batch'),
      subscriptionId: z.string(),
      batch: youTubeChatBatchSchema,
      nextPageToken: z.string().optional(),
    }),
    z.object({
      type: z.literal('status'),
      subscriptionId: z.string(),
      status: youTubeChatStatusSchema,
      error: z.string().optional(),
      terminal: z.boolean().optional(),
    }),
  ]),
)
export const sevenTVEmoteSchema = z.toZod<SevenTVEmote>()(
  z.object({
    id: z.string(),
    alias: z.string(),
    name: z.string(),
    animated: z.boolean(),
    zeroWidth: z.boolean(),
    aspectRatio: z.number(),
    imageUrl: z.string(),
  }),
)
export const donationEventSchema = z.toZod<DonationEvent>()(
  z.object({
    id: z.string().min(1).max(DONATION_SHARE_LIMITS.id),
    provider: z.enum(DONATION_PROVIDERS),
    username: z.string().max(DONATION_SHARE_LIMITS.username),
    amount: z.string().max(DONATION_SHARE_LIMITS.amount),
    currency: z.string().max(DONATION_SHARE_LIMITS.currency),
    message: z.string().max(DONATION_SHARE_LIMITS.message),
    timestamp: z.number().finite(),
  }),
)
export const backendToDesktopMessageSchema = z.toZod<BackendToDesktopMessage>()(
  z.union([
    z.object({ type: z.literal('youtube_chat_event'), event: youTubeChatRelayEventSchema }),
    z.object({
      type: z.literal('shared_donation'),
      channel: z.object({
        platform: z.enum(['twitch', 'kick']),
        channel: z.string().min(1).max(DONATION_SHARE_LIMITS.channel),
      }),
      donation: donationEventSchema,
    }),
    z.object({ type: z.literal('auth_url'), platform: platformSchema, url: z.string() }),
    z.object({
      type: z.literal('auth_success'),
      platform: platformSchema,
      username: z.string(),
      displayName: z.string(),
    }),
    z.object({ type: z.literal('auth_error'), platform: platformSchema, error: z.string() }),
    z.object({ type: z.literal('error'), message: z.string() }),
    z.object({ type: z.literal('pong') }),
    z.object({ type: z.literal('chat_message'), data: z.unknown() }),
    z.object({ type: z.literal('chat_event'), data: z.unknown() }),
    z.object({
      type: z.literal('platform_status'),
      platform: platformSchema,
      status: z.union([z.literal('connected'), z.literal('disconnected'), z.literal('error')]),
      error: z.string().optional(),
    }),
    z.object({
      type: z.literal('seventv_emote_set'),
      platform: platformSchema,
      channelId: z.string(),
      emotes: z.array(sevenTVEmoteSchema),
    }),
    z.object({
      type: z.literal('seventv_emote_added'),
      platform: platformSchema,
      channelId: z.string(),
      emote: sevenTVEmoteSchema,
    }),
    z.object({
      type: z.literal('seventv_emote_removed'),
      platform: platformSchema,
      channelId: z.string(),
      emoteId: z.string(),
    }),
    z.object({
      type: z.literal('seventv_emote_updated'),
      platform: platformSchema,
      channelId: z.string(),
      emoteId: z.string(),
      alias: z.string(),
    }),
    z.object({
      type: z.literal('seventv_system_message'),
      platform: platformSchema,
      channelId: z.string(),
      action: z.union([z.literal('added'), z.literal('removed'), z.literal('updated')]),
      emote: sevenTVEmoteSchema,
      oldAlias: z.string().optional(),
      actorName: z.string().trim().min(1).optional().catch(undefined),
    }),
    z.object({
      type: z.literal('seventv_system_message'),
      platform: platformSchema,
      channelId: z.string(),
      action: z.literal('set_changed'),
      setName: z.string(),
    }),
    z.object({
      type: z.literal('seventv_system_message'),
      platform: platformSchema,
      channelId: z.string(),
      action: z.literal('set_renamed'),
      oldName: z.string(),
      newName: z.string(),
    }),
    z.object({
      type: z.literal('seventv_system_message'),
      platform: platformSchema,
      channelId: z.string(),
      action: z.literal('set_deleted'),
      setName: z.string(),
    }),
  ]),
)
export const emoteSourceSchema = z.toZod<EmoteSource>()(
  z.union([
    z.literal('channel'),
    z.literal('seventv'),
    z.literal('collectibles'),
    z.literal('global'),
    z.literal('bttv'),
    z.literal('ffz'),
    z.literal('personal'),
  ]),
)
export const emoteCatalogEntrySchema = z.toZod<EmoteCatalogEntry>()(
  z.object({
    id: z.string(),
    alias: z.string(),
    name: z.string(),
    imageUrl: z.string(),
    animated: z.boolean(),
    zeroWidth: z.boolean(),
    aspectRatio: z.number(),
    source: emoteSourceSchema,
    provider: z
      .union([z.literal('twitch'), z.literal('seventv'), z.literal('bttv'), z.literal('ffz')])
      .optional(),
    modifier: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
)

export const partialAppSettingsSchema = appSettingsSchema.partial().extend({
  language: languageSchema.optional().catch(DEFAULT_SETTINGS.language),
  theme: themeSchema.optional().catch(DEFAULT_SETTINGS.theme),
  themeMode: themeModeSchema.optional().catch(DEFAULT_SETTINGS.themeMode),
  customPalette: customPaletteSchema.optional().catch(undefined),
  timestampFormat: timestampFormatSchema.optional(),
  replyOnDoubleClick: z.boolean().optional(),
  overlay: overlayConfigSchema.partial().optional(),
  hotkeys: hotkeySettingsSchema.partial().optional(),
  selfPing: selfPingConfigSchema.partial().optional(),
  chatLayout: chatLayoutSchema.partial().optional(),
})
