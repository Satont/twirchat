/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  CustomerId: { input: any; output: any; }
  /**
   * Implement the DateTime<Utc> scalar
   *
   * The input/output is a string in RFC3339 format.
   */
  DateTime: { input: any; output: any; }
  Id: { input: any; output: any; }
  InvoiceId: { input: any; output: any; }
  /** A scalar that can represent any JSON Object value. */
  JSONObject: { input: any; output: any; }
  StripeProductId: { input: any; output: any; }
};

export type AdminPermission = {
  admin: Scalars['Boolean']['output'];
  bypassRateLimit: Scalars['Boolean']['output'];
  manageEntitlements: Scalars['Boolean']['output'];
  manageRedeemCodes: Scalars['Boolean']['output'];
  superAdmin: Scalars['Boolean']['output'];
};

export type AnyEvent = EmoteEvent | EmoteSetEvent | UserEvent;

export type BackdoorQuery = {
  executeSql: Scalars['String']['output'];
};


export type BackdoorQueryExecuteSqlArgs = {
  sql: Scalars['String']['input'];
};

export type Badge = {
  createdById: Scalars['Id']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Id']['output'];
  images: Array<Image>;
  name: Scalars['String']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  tags: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type BadgePermission = {
  admin: Scalars['Boolean']['output'];
  assign: Scalars['Boolean']['output'];
  manage: Scalars['Boolean']['output'];
};

export type BadgeProgress = {
  currentBadge?: Maybe<Badge>;
  currentBadgeId?: Maybe<Scalars['Id']['output']>;
  nextBadge?: Maybe<BadgeProgressNextBadge>;
};

export type BadgeProgressNextBadge = {
  badge?: Maybe<Badge>;
  badgeId: Scalars['Id']['output'];
  daysLeft: Scalars['Float']['output'];
  percentage: Scalars['Float']['output'];
};

export type BadgeQuery = {
  badge?: Maybe<Badge>;
  badges: Array<Badge>;
};


export type BadgeQueryBadgeArgs = {
  id: Scalars['Id']['input'];
};

export type Billing = {
  badgeProgress: BadgeProgress;
  subscriptionInfo: SubscriptionInfo;
};

export type BillingMutation = {
  cancelSubscription: SubscriptionInfo;
  getPickems: SubscribeResponse;
  reactivateSubscription: SubscriptionInfo;
  redeemCode: RedeemResponse;
  subscribe: SubscribeResponse;
};


export type BillingMutationCancelSubscriptionArgs = {
  productId: Scalars['Id']['input'];
};


export type BillingMutationGetPickemsArgs = {
  pickemsId: Scalars['Id']['input'];
  subscriptionPriceId?: InputMaybe<Scalars['StripeProductId']['input']>;
};


export type BillingMutationReactivateSubscriptionArgs = {
  productId: Scalars['Id']['input'];
};


export type BillingMutationRedeemCodeArgs = {
  captchaToken: Scalars['String']['input'];
  code: Scalars['String']['input'];
};


export type BillingMutationSubscribeArgs = {
  variantId: Scalars['StripeProductId']['input'];
};

export type CodeEffect = CodeEffectDirectEntitlement | CodeEffectSpecialEvent;

export type CodeEffectDirectEntitlement = {
  entitlements: Array<EntitlementNodeAny>;
};

export type CodeEffectSpecialEvent = {
  specialEvent?: Maybe<SpecialEvent>;
  specialEventId: Scalars['Id']['output'];
};

export type Color = {
  a: Scalars['Int']['output'];
  b: Scalars['Int']['output'];
  g: Scalars['Int']['output'];
  hex: Scalars['String']['output'];
  r: Scalars['Int']['output'];
};

export type CreateProductInput = {
  active: Scalars['Boolean']['input'];
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  price: Scalars['Int']['input'];
  providerId: Scalars['String']['input'];
};

export type CreateRedeemCodeBatchInput = {
  activePeriod?: InputMaybe<TimePeriodInput>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  number: Scalars['Int']['input'];
  specialEventId: Scalars['Id']['input'];
  subscriptionEffect?: InputMaybe<RedeemCodeSubscriptionEffectInput>;
  tags: Array<Scalars['String']['input']>;
  uses: Scalars['Int']['input'];
};

export type CreateRedeemCodeInput = {
  activePeriod?: InputMaybe<TimePeriodInput>;
  code?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  specialEventId: Scalars['Id']['input'];
  subscriptionEffect?: InputMaybe<RedeemCodeSubscriptionEffectInput>;
  tags: Array<Scalars['String']['input']>;
  uses: Scalars['Int']['input'];
};

export type CreateSpecialEventInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  tags: Array<Scalars['String']['input']>;
};

export type EditorEmotePermission = {
  admin: Scalars['Boolean']['output'];
  create: Scalars['Boolean']['output'];
  manage: Scalars['Boolean']['output'];
  transfer: Scalars['Boolean']['output'];
};

export type EditorEmotePermissionInput = {
  admin: Scalars['Boolean']['input'];
  create: Scalars['Boolean']['input'];
  manage: Scalars['Boolean']['input'];
  transfer: Scalars['Boolean']['input'];
};

export type EditorEmoteSetPermission = {
  admin: Scalars['Boolean']['output'];
  create: Scalars['Boolean']['output'];
  manage: Scalars['Boolean']['output'];
};

export type EditorEmoteSetPermissionInput = {
  admin: Scalars['Boolean']['input'];
  create: Scalars['Boolean']['input'];
  manage: Scalars['Boolean']['input'];
};

export type EditorUserPermission = {
  admin: Scalars['Boolean']['output'];
  manageBilling: Scalars['Boolean']['output'];
  manageEditors: Scalars['Boolean']['output'];
  managePersonalEmoteSet: Scalars['Boolean']['output'];
  manageProfile: Scalars['Boolean']['output'];
};

export type EditorUserPermissionInput = {
  admin: Scalars['Boolean']['input'];
  manageBilling: Scalars['Boolean']['input'];
  manageEditors: Scalars['Boolean']['input'];
  managePersonalEmoteSet: Scalars['Boolean']['input'];
  manageProfile: Scalars['Boolean']['input'];
};

export type Emote = {
  aspectRatio: Scalars['Float']['output'];
  attribution: Array<EmoteAttribution>;
  channels: UserSearchResult;
  defaultName: Scalars['String']['output'];
  deleted: Scalars['Boolean']['output'];
  events: Array<EmoteEvent>;
  flags: EmoteFlags;
  id: Scalars['Id']['output'];
  images: Array<Image>;
  imagesPending: Scalars['Boolean']['output'];
  inEmoteSets: Array<EmoteInEmoteSetResponse>;
  owner?: Maybe<User>;
  ownerId: Scalars['Id']['output'];
  ranking?: Maybe<Scalars['Int']['output']>;
  scores: EmoteScores;
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  tags: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};


export type EmoteChannelsArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
};


export type EmoteEventsArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
};


export type EmoteInEmoteSetsArgs = {
  emoteSetIds: Array<Scalars['Id']['input']>;
};


export type EmoteRankingArgs = {
  ranking: Ranking;
};

export type EmoteAttribution = {
  addedAt: Scalars['DateTime']['output'];
  user?: Maybe<User>;
  userId: Scalars['Id']['output'];
};

export type EmoteBatchOperation = {
  delete: Array<Emote>;
  flags: Array<Emote>;
  merge: Array<Emote>;
  name: Array<Emote>;
  owner: Array<Emote>;
  tags: Array<Emote>;
};


export type EmoteBatchOperationDeleteArgs = {
  reason?: InputMaybe<Scalars['String']['input']>;
};


export type EmoteBatchOperationFlagsArgs = {
  flags: EmoteFlagsInput;
};


export type EmoteBatchOperationMergeArgs = {
  with: Scalars['Id']['input'];
};


export type EmoteBatchOperationNameArgs = {
  name: Scalars['String']['input'];
};


export type EmoteBatchOperationOwnerArgs = {
  ownerId: Scalars['Id']['input'];
};


export type EmoteBatchOperationTagsArgs = {
  tags: Array<Scalars['String']['input']>;
};

export type EmoteEvent = {
  actor?: Maybe<User>;
  actorId?: Maybe<Scalars['Id']['output']>;
  createdAt: Scalars['DateTime']['output'];
  data: EventEmoteData;
  id: Scalars['Id']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  target?: Maybe<Emote>;
  targetId: Scalars['Id']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type EmoteFlags = {
  animated: Scalars['Boolean']['output'];
  approvedPersonal: Scalars['Boolean']['output'];
  defaultZeroWidth: Scalars['Boolean']['output'];
  deniedPersonal: Scalars['Boolean']['output'];
  nsfw: Scalars['Boolean']['output'];
  private: Scalars['Boolean']['output'];
  publicListed: Scalars['Boolean']['output'];
};

export type EmoteFlagsInput = {
  animated?: InputMaybe<Scalars['Boolean']['input']>;
  approvedPersonal?: InputMaybe<Scalars['Boolean']['input']>;
  defaultZeroWidth?: InputMaybe<Scalars['Boolean']['input']>;
  deniedPersonal?: InputMaybe<Scalars['Boolean']['input']>;
  nsfw?: InputMaybe<Scalars['Boolean']['input']>;
  private?: InputMaybe<Scalars['Boolean']['input']>;
  publicListed?: InputMaybe<Scalars['Boolean']['input']>;
};

export type EmoteInEmoteSetResponse = {
  emote?: Maybe<EmoteSetEmote>;
  emoteSetId: Scalars['Id']['output'];
};

export type EmoteModerationRequestPermission = {
  admin: Scalars['Boolean']['output'];
  manage: Scalars['Boolean']['output'];
};

export type EmoteMutation = {
  emote: EmoteOperation;
  emotes: EmoteBatchOperation;
};


export type EmoteMutationEmoteArgs = {
  id: Scalars['Id']['input'];
};


export type EmoteMutationEmotesArgs = {
  ids: Array<Scalars['Id']['input']>;
};

export type EmoteOperation = {
  delete: Emote;
  flags: Emote;
  merge: Emote;
  name: Emote;
  owner: Emote;
  tags: Emote;
};


export type EmoteOperationFlagsArgs = {
  flags: EmoteFlagsInput;
};


export type EmoteOperationMergeArgs = {
  targetId: Scalars['Id']['input'];
};


export type EmoteOperationNameArgs = {
  name: Scalars['String']['input'];
};


export type EmoteOperationOwnerArgs = {
  ownerId: Scalars['Id']['input'];
};


export type EmoteOperationTagsArgs = {
  tags: Array<Scalars['String']['input']>;
};

export type EmotePermission = {
  admin: Scalars['Boolean']['output'];
  delete: Scalars['Boolean']['output'];
  edit: Scalars['Boolean']['output'];
  manageAny: Scalars['Boolean']['output'];
  merge: Scalars['Boolean']['output'];
  upload: Scalars['Boolean']['output'];
  viewUnlisted: Scalars['Boolean']['output'];
};

export type EmoteQuery = {
  emote?: Maybe<Emote>;
  search: EmoteSearchResult;
};


export type EmoteQueryEmoteArgs = {
  id: Scalars['Id']['input'];
};


export type EmoteQuerySearchArgs = {
  filters?: InputMaybe<Filters>;
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
  sort: Sort;
  tags?: InputMaybe<Tags>;
};

export type EmoteScores = {
  topAllTime: Scalars['Int']['output'];
  topDaily: Scalars['Int']['output'];
  topMonthly: Scalars['Int']['output'];
  topWeekly: Scalars['Int']['output'];
  trendingDay: Scalars['Int']['output'];
  trendingMonth: Scalars['Int']['output'];
  trendingWeek: Scalars['Int']['output'];
};

export type EmoteSearchResult = {
  items: Array<Emote>;
  pageCount: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
};

export type EmoteSet = {
  capacity?: Maybe<Scalars['Int']['output']>;
  description?: Maybe<Scalars['String']['output']>;
  emotes: EmoteSetEmoteSearchResult;
  id: Scalars['Id']['output'];
  kind: EmoteSetKind;
  name: Scalars['String']['output'];
  owner?: Maybe<User>;
  ownerId?: Maybe<Scalars['Id']['output']>;
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  tags: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};


export type EmoteSetEmotesArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
};

export type EmoteSetEmote = {
  addedAt: Scalars['DateTime']['output'];
  addedById?: Maybe<Scalars['Id']['output']>;
  alias: Scalars['String']['output'];
  emote: Emote;
  flags: EmoteSetEmoteFlags;
  id: Scalars['Id']['output'];
  originSetId?: Maybe<Scalars['Id']['output']>;
};

export type EmoteSetEmoteFlags = {
  overrideConflicts: Scalars['Boolean']['output'];
  zeroWidth: Scalars['Boolean']['output'];
};

export type EmoteSetEmoteFlagsInput = {
  overrideConflicts: Scalars['Boolean']['input'];
  zeroWidth: Scalars['Boolean']['input'];
};

export type EmoteSetEmoteId = {
  alias?: InputMaybe<Scalars['String']['input']>;
  emoteId: Scalars['Id']['input'];
};

export type EmoteSetEmoteSearchResult = {
  items: Array<EmoteSetEmote>;
  pageCount: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
};

export type EmoteSetEvent = {
  actor?: Maybe<User>;
  actorId?: Maybe<Scalars['Id']['output']>;
  createdAt: Scalars['DateTime']['output'];
  data: EventEmoteSetData;
  id: Scalars['Id']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  target?: Maybe<EmoteSet>;
  targetId: Scalars['Id']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export enum EmoteSetKind {
  Global = 'GLOBAL',
  Normal = 'NORMAL',
  Personal = 'PERSONAL',
  Special = 'SPECIAL'
}

export type EmoteSetMutation = {
  create: EmoteSet;
  emoteSet: EmoteSetOperation;
};


export type EmoteSetMutationCreateArgs = {
  name: Scalars['String']['input'];
  ownerId?: InputMaybe<Scalars['Id']['input']>;
  tags: Array<Scalars['String']['input']>;
};


export type EmoteSetMutationEmoteSetArgs = {
  id: Scalars['Id']['input'];
};

export type EmoteSetOperation = {
  addEmote: EmoteSet;
  capacity: EmoteSet;
  delete: Scalars['Boolean']['output'];
  name: EmoteSet;
  removeEmote: EmoteSet;
  tags: EmoteSet;
  updateEmoteAlias: EmoteSetEmote;
  updateEmoteFlags: EmoteSetEmote;
};


export type EmoteSetOperationAddEmoteArgs = {
  id: EmoteSetEmoteId;
  overrideConflicts?: InputMaybe<Scalars['Boolean']['input']>;
  zeroWidth?: InputMaybe<Scalars['Boolean']['input']>;
};


export type EmoteSetOperationCapacityArgs = {
  capacity: Scalars['Int']['input'];
};


export type EmoteSetOperationNameArgs = {
  name: Scalars['String']['input'];
};


export type EmoteSetOperationRemoveEmoteArgs = {
  id: EmoteSetEmoteId;
};


export type EmoteSetOperationTagsArgs = {
  tags: Array<Scalars['String']['input']>;
};


export type EmoteSetOperationUpdateEmoteAliasArgs = {
  alias: Scalars['String']['input'];
  id: EmoteSetEmoteId;
};


export type EmoteSetOperationUpdateEmoteFlagsArgs = {
  flags: EmoteSetEmoteFlagsInput;
  id: EmoteSetEmoteId;
};

export type EmoteSetPermission = {
  admin: Scalars['Boolean']['output'];
  assign: Scalars['Boolean']['output'];
  manage: Scalars['Boolean']['output'];
  manageAny: Scalars['Boolean']['output'];
  manageGlobal: Scalars['Boolean']['output'];
  manageSpecial: Scalars['Boolean']['output'];
  resize: Scalars['Boolean']['output'];
};

export type EmoteSetQuery = {
  emoteSet?: Maybe<EmoteSet>;
  emoteSets: Array<EmoteSet>;
  global: EmoteSet;
};


export type EmoteSetQueryEmoteSetArgs = {
  id: Scalars['Id']['input'];
};


export type EmoteSetQueryEmoteSetsArgs = {
  ids: Array<Scalars['Id']['input']>;
};

export type EntitlementEdgeAnyAny = {
  from: EntitlementNodeAny;
  to: EntitlementNodeAny;
};

export type EntitlementEdgeMutation = {
  create: EntitlementEdgeAnyAny;
  entitlementEdge: EntitlementEdgeOperation;
};


export type EntitlementEdgeMutationCreateArgs = {
  from: EntitlementNodeInput;
  to: EntitlementNodeInput;
};


export type EntitlementEdgeMutationEntitlementEdgeArgs = {
  from: EntitlementNodeInput;
  to: EntitlementNodeInput;
};

export type EntitlementEdgeOperation = {
  delete: Scalars['Boolean']['output'];
};

export type EntitlementNodeAny = EntitlementNodeBadge | EntitlementNodeEmoteSet | EntitlementNodeGlobalDefaultEntitlementGroup | EntitlementNodePaint | EntitlementNodeProduct | EntitlementNodeRole | EntitlementNodeSpecialEvent | EntitlementNodeSubscription | EntitlementNodeSubscriptionBenefit | EntitlementNodeUser;

export type EntitlementNodeBadge = {
  badge?: Maybe<Badge>;
  badgeId: Scalars['Id']['output'];
};

export type EntitlementNodeEmoteSet = {
  emoteSet?: Maybe<EmoteSet>;
  emoteSetId: Scalars['Id']['output'];
};

export type EntitlementNodeGlobalDefaultEntitlementGroup = {
  noop: Scalars['Boolean']['output'];
};

export type EntitlementNodeInput = {
  id: Scalars['Id']['input'];
  type: EntitlementNodeTypeInput;
};

export type EntitlementNodePaint = {
  paint?: Maybe<Paint>;
  paintId: Scalars['Id']['output'];
};

export type EntitlementNodeProduct = {
  productId: Scalars['Id']['output'];
};

export type EntitlementNodeRole = {
  role?: Maybe<Role>;
  roleId: Scalars['Id']['output'];
};

export type EntitlementNodeSpecialEvent = {
  specialEvent?: Maybe<SpecialEvent>;
  specialEventId: Scalars['Id']['output'];
};

export type EntitlementNodeSubscription = {
  subscriptionId: SubscriptionId;
};

export type EntitlementNodeSubscriptionBenefit = {
  subscriptionBenefit?: Maybe<SubscriptionBenefit>;
  subscriptionBenefitId: Scalars['Id']['output'];
};

export enum EntitlementNodeTypeInput {
  Badge = 'BADGE',
  EmoteSet = 'EMOTE_SET',
  GlobalDefaultEntitlementGroup = 'GLOBAL_DEFAULT_ENTITLEMENT_GROUP',
  Paint = 'PAINT',
  Role = 'ROLE',
  SpecialEvent = 'SPECIAL_EVENT',
  Subscription = 'SUBSCRIPTION',
  SubscriptionBenefit = 'SUBSCRIPTION_BENEFIT',
  User = 'USER'
}

export type EntitlementNodeUser = {
  user?: Maybe<User>;
  userId: Scalars['Id']['output'];
};

export type EntitlementQuery = {
  traverse: RawEntitlements;
};


export type EntitlementQueryTraverseArgs = {
  from: EntitlementNodeInput;
};

export type EventEmoteData = EventEmoteDataChangeFlags | EventEmoteDataChangeName | EventEmoteDataChangeOwner | EventEmoteDataChangeTags | EventEmoteDataDelete | EventEmoteDataMerge | EventEmoteDataProcess | EventEmoteDataUpload;

export type EventEmoteDataChangeFlags = {
  newFlags: EmoteFlags;
  oldFlags: EmoteFlags;
};

export type EventEmoteDataChangeName = {
  newName: Scalars['String']['output'];
  oldName: Scalars['String']['output'];
};

export type EventEmoteDataChangeOwner = {
  newOwner?: Maybe<User>;
  newOwnerId: Scalars['Id']['output'];
  oldOwner?: Maybe<User>;
  oldOwnerId: Scalars['Id']['output'];
};

export type EventEmoteDataChangeTags = {
  newTags: Array<Scalars['String']['output']>;
  oldTags: Array<Scalars['String']['output']>;
};

export type EventEmoteDataDelete = {
  /** Always false */
  noop: Scalars['Boolean']['output'];
};

export type EventEmoteDataMerge = {
  newEmote: Emote;
  newEmoteId: Scalars['Id']['output'];
};

export type EventEmoteDataProcess = {
  event: ImageProcessorEvent;
};

export type EventEmoteDataUpload = {
  /** Always false */
  noop: Scalars['Boolean']['output'];
};

export type EventEmoteSetData = EventEmoteSetDataAddEmote | EventEmoteSetDataChangeCapacity | EventEmoteSetDataChangeName | EventEmoteSetDataChangeTags | EventEmoteSetDataCreate | EventEmoteSetDataDelete | EventEmoteSetDataRemoveEmote | EventEmoteSetDataRenameEmote;

export type EventEmoteSetDataAddEmote = {
  addedEmote?: Maybe<Emote>;
  addedEmoteId: Scalars['Id']['output'];
  alias: Scalars['String']['output'];
};

export type EventEmoteSetDataChangeCapacity = {
  newCapacity?: Maybe<Scalars['Int']['output']>;
  oldCapacity?: Maybe<Scalars['Int']['output']>;
};

export type EventEmoteSetDataChangeName = {
  newName: Scalars['String']['output'];
  oldName: Scalars['String']['output'];
};

export type EventEmoteSetDataChangeTags = {
  newTags: Array<Scalars['String']['output']>;
  oldTags: Array<Scalars['String']['output']>;
};

export type EventEmoteSetDataCreate = {
  /** Always false */
  noop: Scalars['Boolean']['output'];
};

export type EventEmoteSetDataDelete = {
  /** Always false */
  noop: Scalars['Boolean']['output'];
};

export type EventEmoteSetDataRemoveEmote = {
  removedEmote?: Maybe<Emote>;
  removedEmoteId: Scalars['Id']['output'];
};

export type EventEmoteSetDataRenameEmote = {
  newAlias: Scalars['String']['output'];
  oldAlias: Scalars['String']['output'];
  renamedEmote?: Maybe<Emote>;
  renamedEmoteId: Scalars['Id']['output'];
};

export type EventUserData = EventUserDataAddConnection | EventUserDataChangeActiveBadge | EventUserDataChangeActiveEmoteSet | EventUserDataChangeActivePaint | EventUserDataCreate | EventUserDataDelete | EventUserDataRemoveConnection;

export type EventUserDataAddConnection = {
  addedPlatform: Platform;
};

export type EventUserDataChangeActiveBadge = {
  newBadge?: Maybe<Badge>;
  newBadgeId?: Maybe<Scalars['Id']['output']>;
  oldBadge?: Maybe<Badge>;
  oldBadgeId?: Maybe<Scalars['Id']['output']>;
};

export type EventUserDataChangeActiveEmoteSet = {
  newEmoteSet?: Maybe<EmoteSet>;
  newEmoteSetId?: Maybe<Scalars['Id']['output']>;
  oldEmoteSet?: Maybe<EmoteSet>;
  oldEmoteSetId?: Maybe<Scalars['Id']['output']>;
};

export type EventUserDataChangeActivePaint = {
  newPaint?: Maybe<Paint>;
  newPaintId?: Maybe<Scalars['Id']['output']>;
  oldPaint?: Maybe<Paint>;
  oldPaintId?: Maybe<Scalars['Id']['output']>;
};

export type EventUserDataCreate = {
  /** Always false */
  noop: Scalars['Boolean']['output'];
};

export type EventUserDataDelete = {
  /** Always false */
  noop: Scalars['Boolean']['output'];
};

export type EventUserDataRemoveConnection = {
  removedPlatform: Platform;
};

export type Filters = {
  animated?: InputMaybe<Scalars['Boolean']['input']>;
  approvedPersonal?: InputMaybe<Scalars['Boolean']['input']>;
  defaultZeroWidth?: InputMaybe<Scalars['Boolean']['input']>;
  /** defaults to false when unset */
  exactMatch?: InputMaybe<Scalars['Boolean']['input']>;
  nsfw?: InputMaybe<Scalars['Boolean']['input']>;
};

export type FlagPermission = {
  hidden: Scalars['Boolean']['output'];
};

export type Image = {
  frameCount: Scalars['Int']['output'];
  height: Scalars['Int']['output'];
  mime: Scalars['String']['output'];
  scale: Scalars['Int']['output'];
  size: Scalars['Int']['output'];
  url: Scalars['String']['output'];
  width: Scalars['Int']['output'];
};

export enum ImageProcessorEvent {
  Cancel = 'CANCEL',
  Fail = 'FAIL',
  Start = 'START',
  Success = 'SUCCESS'
}

export type InventoryEntitlementEdgeAnyBadge = {
  /** Whether this entitlement is directly connected to the user */
  accessible: Scalars['Boolean']['output'];
  from: EntitlementNodeAny;
  to: EntitlementNodeBadge;
};

export type InventoryEntitlementEdgeAnyPaint = {
  /** Whether this entitlement is directly connected to the user */
  accessible: Scalars['Boolean']['output'];
  from: EntitlementNodeAny;
  to: EntitlementNodePaint;
};

export type InventoryEntitlementEdgeAnyProduct = {
  /** Whether this entitlement is directly connected to the user */
  accessible: Scalars['Boolean']['output'];
  from: EntitlementNodeAny;
  to: EntitlementNodeProduct;
};

export type JobMutation = {
  rerunSubscriptionRefreshJob: Scalars['Boolean']['output'];
};

export type KickLinkInput = {
  avatarUrl?: InputMaybe<Scalars['String']['input']>;
  displayName: Scalars['String']['input'];
  id: Scalars['String']['input'];
  username: Scalars['String']['input'];
};

export type Mutation = {
  billing: BillingMutation;
  emoteSets: EmoteSetMutation;
  emotes: EmoteMutation;
  entitlementEdges: EntitlementEdgeMutation;
  jobs: JobMutation;
  product: ProductMutation;
  redeemCodes: RedeemCodeMutation;
  specialEvents: SpecialEventMutation;
  tickets: TicketMutation;
  userEditors: UserEditorMutation;
  userSessions: UserSessionMutation;
  users: UserMutation;
};


export type MutationBillingArgs = {
  userId: Scalars['Id']['input'];
};

export type Paint = {
  createdById: Scalars['Id']['output'];
  data: PaintData;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Id']['output'];
  name: Scalars['String']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  tags: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type PaintData = {
  layers: Array<PaintLayer>;
  shadows: Array<PaintShadow>;
};

export type PaintGradientStop = {
  at: Scalars['Float']['output'];
  color: Color;
};

export type PaintLayer = {
  id: Scalars['Id']['output'];
  opacity: Scalars['Float']['output'];
  ty: PaintLayerType;
};

export type PaintLayerType = PaintLayerTypeImage | PaintLayerTypeLinearGradient | PaintLayerTypeRadialGradient | PaintLayerTypeSingleColor;

export type PaintLayerTypeImage = {
  images: Array<Image>;
};

export type PaintLayerTypeLinearGradient = {
  angle: Scalars['Int']['output'];
  repeating: Scalars['Boolean']['output'];
  stops: Array<PaintGradientStop>;
};

export type PaintLayerTypeRadialGradient = {
  repeating: Scalars['Boolean']['output'];
  shape: PaintRadialGradientShape;
  stops: Array<PaintGradientStop>;
};

export type PaintLayerTypeSingleColor = {
  color: Color;
};

export type PaintPermission = {
  admin: Scalars['Boolean']['output'];
  assign: Scalars['Boolean']['output'];
  manage: Scalars['Boolean']['output'];
};

export type PaintQuery = {
  paint?: Maybe<Paint>;
  paints: Array<Paint>;
};


export type PaintQueryPaintArgs = {
  id: Scalars['Id']['input'];
};

export enum PaintRadialGradientShape {
  Circle = 'CIRCLE',
  Ellipse = 'ELLIPSE'
}

export type PaintShadow = {
  blur: Scalars['Float']['output'];
  color: Color;
  offsetX: Scalars['Float']['output'];
  offsetY: Scalars['Float']['output'];
};

export type Permissions = {
  admin: AdminPermission;
  badge: BadgePermission;
  emote: EmotePermission;
  emoteModerationRequest: EmoteModerationRequestPermission;
  emoteModerationRequestLimit?: Maybe<Scalars['Int']['output']>;
  emoteModerationRequestPriority?: Maybe<Scalars['Int']['output']>;
  emoteSet: EmoteSetPermission;
  emoteSetCapacity?: Maybe<Scalars['Int']['output']>;
  emoteSetLimit?: Maybe<Scalars['Int']['output']>;
  flags: FlagPermission;
  paint: PaintPermission;
  personalEmoteSetCapacity?: Maybe<Scalars['Int']['output']>;
  ratelimits: Scalars['JSONObject']['output'];
  role: RolePermission;
  ticket: TicketPermission;
  user: UserPermission;
};

export enum Platform {
  Discord = 'DISCORD',
  Google = 'GOOGLE',
  Kick = 'KICK',
  Twitch = 'TWITCH'
}

export type Price = {
  amount: Scalars['Int']['output'];
  currency: Scalars['String']['output'];
};

export type Product = {
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Id']['output'];
  name: Scalars['String']['output'];
  providerId: Scalars['String']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type ProductMutation = {
  create: Product;
};


export type ProductMutationCreateArgs = {
  data: CreateProductInput;
};

export type ProductQuery = {
  subscriptionProduct?: Maybe<SubscriptionProduct>;
  subscriptionProducts: Array<SubscriptionProduct>;
};


export type ProductQuerySubscriptionProductArgs = {
  id: Scalars['Id']['input'];
};

export type ProviderSubscriptionId = {
  id: Scalars['String']['output'];
  provider: SubscriptionProvider;
};

export type Query = {
  _service: _Service;
  backdoor: BackdoorQuery;
  badges: BadgeQuery;
  emoteSets: EmoteSetQuery;
  emotes: EmoteQuery;
  entitlements: EntitlementQuery;
  paints: PaintQuery;
  products: ProductQuery;
  redeemCodes: RedeemCodeQuery;
  roles: RoleQuery;
  search: SearchQuery;
  specialEvents: SpecialEventQuery;
  store: StoreQuery;
  users: UserQuery;
};

export enum Ranking {
  TopAllTime = 'TOP_ALL_TIME',
  TopDaily = 'TOP_DAILY',
  TopMonthly = 'TOP_MONTHLY',
  TopWeekly = 'TOP_WEEKLY',
  TrendingDaily = 'TRENDING_DAILY',
  TrendingMonthly = 'TRENDING_MONTHLY',
  TrendingWeekly = 'TRENDING_WEEKLY'
}

export type RawEntitlements = {
  edges: Array<EntitlementEdgeAnyAny>;
  nodes: Array<EntitlementNodeAny>;
};

export type RedeemCode = {
  activePeriod?: Maybe<TimePeriod>;
  code: Scalars['String']['output'];
  createdAt: Scalars['DateTime']['output'];
  createdBy?: Maybe<User>;
  createdById: Scalars['Id']['output'];
  description?: Maybe<Scalars['String']['output']>;
  effect: CodeEffect;
  id: Scalars['Id']['output'];
  name: Scalars['String']['output'];
  remainingUses: Scalars['Int']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  subscriptionEffect?: Maybe<RedeemCodeSubscriptionEffect>;
  tags: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type RedeemCodeMutation = {
  create: RedeemCode;
  createBatch: Array<RedeemCode>;
  redeemCode: RedeemCodeOperation;
};


export type RedeemCodeMutationCreateArgs = {
  data: CreateRedeemCodeInput;
};


export type RedeemCodeMutationCreateBatchArgs = {
  data: CreateRedeemCodeBatchInput;
};


export type RedeemCodeMutationRedeemCodeArgs = {
  id: Scalars['Id']['input'];
};

export type RedeemCodeOperation = {
  deactivate: RedeemCode;
};

export type RedeemCodeQuery = {
  redeemCode?: Maybe<RedeemCode>;
  redeemCodes: RedeemCodeSearchResult;
};


export type RedeemCodeQueryRedeemCodeArgs = {
  id: Scalars['Id']['input'];
};


export type RedeemCodeQueryRedeemCodesArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
  remainingUses?: InputMaybe<Scalars['Boolean']['input']>;
};

export type RedeemCodeSearchResult = {
  items: Array<RedeemCode>;
  pageCount: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
};

export type RedeemCodeSubscriptionEffect = {
  id: Scalars['Id']['output'];
  noRedirectToStripe: Scalars['Boolean']['output'];
  subscriptionProduct?: Maybe<SubscriptionProduct>;
  trialDays?: Maybe<Scalars['Int']['output']>;
};

export type RedeemCodeSubscriptionEffectInput = {
  noRedirectToStripe: Scalars['Boolean']['input'];
  productId: Scalars['Id']['input'];
  trialDays?: InputMaybe<Scalars['Int']['input']>;
};

export type RedeemResponse = {
  checkoutUrl?: Maybe<Scalars['String']['output']>;
};

export type Role = {
  color?: Maybe<Color>;
  createdBy?: Maybe<User>;
  createdById: Scalars['Id']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Id']['output'];
  name: Scalars['String']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  tags: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type RolePermission = {
  admin: Scalars['Boolean']['output'];
  assign: Scalars['Boolean']['output'];
  manage: Scalars['Boolean']['output'];
};

export type RoleQuery = {
  roles: Array<Role>;
};

export type SearchQuery = {
  all: SearchResultAll;
};


export type SearchQueryAllArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
  query?: InputMaybe<Scalars['String']['input']>;
};

export type SearchResultAll = {
  emotes: EmoteSearchResult;
  users: UserSearchResult;
};

export type Sort = {
  order: SortOrder;
  sortBy: SortBy;
};

export enum SortBy {
  NameAlphabetical = 'NAME_ALPHABETICAL',
  TopAllTime = 'TOP_ALL_TIME',
  TopDaily = 'TOP_DAILY',
  TopMonthly = 'TOP_MONTHLY',
  TopWeekly = 'TOP_WEEKLY',
  TrendingDaily = 'TRENDING_DAILY',
  TrendingMonthly = 'TRENDING_MONTHLY',
  TrendingWeekly = 'TRENDING_WEEKLY',
  UploadDate = 'UPLOAD_DATE'
}

export enum SortOrder {
  Ascending = 'ASCENDING',
  Descending = 'DESCENDING'
}

export type SpecialEvent = {
  createdAt: Scalars['DateTime']['output'];
  createdBy?: Maybe<User>;
  createdById: Scalars['Id']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Id']['output'];
  name: Scalars['String']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  tags: Array<Scalars['String']['output']>;
  updatedAt: Scalars['DateTime']['output'];
};

export type SpecialEventMutation = {
  create: SpecialEvent;
};


export type SpecialEventMutationCreateArgs = {
  data: CreateSpecialEventInput;
};

export type SpecialEventQuery = {
  specialEvents: Array<SpecialEvent>;
};

export type StoreQuery = {
  monthlyPaints: Array<Paint>;
};

export type SubscribeResponse = {
  checkoutUrl: Scalars['String']['output'];
};

export type Subscription = {
  createdAt: Scalars['DateTime']['output'];
  endedAt?: Maybe<Scalars['DateTime']['output']>;
  id: SubscriptionId;
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  state: SubscriptionState;
  updatedAt: Scalars['DateTime']['output'];
};

export type SubscriptionBenefit = {
  id: Scalars['Id']['output'];
  name: Scalars['String']['output'];
};

export type SubscriptionId = {
  productId: Scalars['Id']['output'];
  userId: Scalars['Id']['output'];
};

export type SubscriptionInfo = {
  activePeriod?: Maybe<SubscriptionPeriod>;
  endDate?: Maybe<Scalars['DateTime']['output']>;
  periods: Array<SubscriptionPeriod>;
  totalDays: Scalars['Int']['output'];
};

export type SubscriptionPeriod = {
  autoRenew: Scalars['Boolean']['output'];
  createdBy: SubscriptionPeriodCreatedBy;
  end: Scalars['DateTime']['output'];
  giftedBy?: Maybe<User>;
  giftedById?: Maybe<Scalars['Id']['output']>;
  id: Scalars['Id']['output'];
  isTrial: Scalars['Boolean']['output'];
  productId: Scalars['StripeProductId']['output'];
  providerId?: Maybe<ProviderSubscriptionId>;
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  start: Scalars['DateTime']['output'];
  subscription: Subscription;
  subscriptionId: SubscriptionId;
  subscriptionProduct: SubscriptionProduct;
  subscriptionProductVariant: SubscriptionProductVariant;
  updatedAt: Scalars['DateTime']['output'];
};

export type SubscriptionPeriodCreatedBy = SubscriptionPeriodCreatedByInvoice | SubscriptionPeriodCreatedByRedeemCode | SubscriptionPeriodCreatedBySystem;

export type SubscriptionPeriodCreatedByInvoice = {
  invoiceId: Scalars['InvoiceId']['output'];
};

export type SubscriptionPeriodCreatedByRedeemCode = {
  redeemCodeId: Scalars['Id']['output'];
};

export type SubscriptionPeriodCreatedBySystem = {
  reason?: Maybe<Scalars['String']['output']>;
};

export type SubscriptionProduct = {
  benefits: Array<SubscriptionBenefit>;
  defaultVariant: SubscriptionProductVariant;
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['Id']['output'];
  name: Scalars['String']['output'];
  providerId: Scalars['String']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  updatedAt: Scalars['DateTime']['output'];
  variants: Array<SubscriptionProductVariant>;
};

export enum SubscriptionProductKind {
  Monthly = 'MONTHLY',
  Yearly = 'YEARLY'
}

export type SubscriptionProductVariant = {
  id: Scalars['StripeProductId']['output'];
  kind: SubscriptionProductKind;
  paypalId?: Maybe<Scalars['String']['output']>;
  price: Price;
};


export type SubscriptionProductVariantPriceArgs = {
  preferredCurrency?: InputMaybe<Scalars['String']['input']>;
};

export enum SubscriptionProvider {
  PayPal = 'PAY_PAL',
  Stripe = 'STRIPE'
}

export enum SubscriptionState {
  Active = 'ACTIVE',
  CancelAtEnd = 'CANCEL_AT_END',
  Ended = 'ENDED'
}

export type Tags = {
  match: TagsMatch;
  tags: Array<Scalars['String']['input']>;
};

export enum TagsMatch {
  All = 'ALL',
  Any = 'ANY'
}

export type Ticket = {
  authorId: Scalars['Id']['output'];
  countryCode?: Maybe<Scalars['String']['output']>;
  id: Scalars['Id']['output'];
  kind: TicketKind;
  locked: Scalars['Boolean']['output'];
  members: Array<TicketMember>;
  open: Scalars['Boolean']['output'];
  priority: TicketPriority;
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  tags: Array<Scalars['String']['output']>;
  targets: Array<TicketTarget>;
  title: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export enum TicketKind {
  Abuse = 'ABUSE',
  Billing = 'BILLING',
  Generic = 'GENERIC'
}

export type TicketMember = {
  kind: TicketMemberKind;
  lastRead?: Maybe<Scalars['Id']['output']>;
  notifications: Scalars['Boolean']['output'];
  userId: Scalars['Id']['output'];
};

export enum TicketMemberKind {
  Assigned = 'ASSIGNED',
  Member = 'MEMBER',
  Watcher = 'WATCHER'
}

export type TicketMutation = {
  createAbuseTicket: Ticket;
};


export type TicketMutationCreateAbuseTicketArgs = {
  content?: InputMaybe<Scalars['String']['input']>;
  target: TicketTargetInput;
  title: Scalars['String']['input'];
};

export type TicketPermission = {
  admin: Scalars['Boolean']['output'];
  create: Scalars['Boolean']['output'];
  manageAbuse: Scalars['Boolean']['output'];
  manageBilling: Scalars['Boolean']['output'];
  manageGeneric: Scalars['Boolean']['output'];
  message: Scalars['Boolean']['output'];
};

export enum TicketPriority {
  High = 'HIGH',
  Low = 'LOW',
  Medium = 'MEDIUM',
  Urgent = 'URGENT'
}

export type TicketTarget = {
  id: Scalars['Id']['output'];
  kind: TicketTargetType;
};

export type TicketTargetInput = {
  id: Scalars['Id']['input'];
  kind: TicketTargetType;
};

export enum TicketTargetType {
  Emote = 'EMOTE',
  EmoteSet = 'EMOTE_SET',
  User = 'USER'
}

export type TimePeriod = {
  end: Scalars['DateTime']['output'];
  start: Scalars['DateTime']['output'];
};

export type TimePeriodInput = {
  end: Scalars['DateTime']['input'];
  start: Scalars['DateTime']['input'];
};

export type User = {
  billing: Billing;
  connections: Array<UserConnection>;
  createdAt: Scalars['DateTime']['output'];
  editableEmoteSetIds: Array<Scalars['Id']['output']>;
  editorFor: Array<UserEditor>;
  editors: Array<UserEditor>;
  emoteSets: Array<EmoteSet>;
  events: Array<UserEvent>;
  highestRoleColor?: Maybe<Color>;
  highestRoleRank: Scalars['Int']['output'];
  id: Scalars['Id']['output'];
  inventory: UserInventory;
  mainConnection?: Maybe<UserConnection>;
  ownedEmoteSets: Array<EmoteSet>;
  ownedEmotes: Array<Emote>;
  permissions: Permissions;
  personalEmoteSet?: Maybe<EmoteSet>;
  rawEntitlements: RawEntitlements;
  relatedEvents: Array<AnyEvent>;
  roleIds: Array<Scalars['Id']['output']>;
  roles: Array<Role>;
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  specialEmoteSets: Array<EmoteSet>;
  stripeCustomerId?: Maybe<Scalars['CustomerId']['output']>;
  style: UserStyle;
  updatedAt: Scalars['DateTime']['output'];
};


export type UserBillingArgs = {
  productId: Scalars['Id']['input'];
};


export type UserEventsArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
};


export type UserInventoryArgs = {
  includeInaccessible?: Scalars['Boolean']['input'];
};


export type UserRelatedEventsArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
};

export type UserConnection = {
  allowLogin: Scalars['Boolean']['output'];
  linkedAt: Scalars['DateTime']['output'];
  platform: Platform;
  platformAvatarUrl?: Maybe<Scalars['String']['output']>;
  platformDisplayName: Scalars['String']['output'];
  platformId: Scalars['String']['output'];
  platformUsername: Scalars['String']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type UserEditor = {
  addedAt: Scalars['DateTime']['output'];
  addedById: Scalars['Id']['output'];
  editor?: Maybe<User>;
  editorId: Scalars['Id']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  permissions: UserEditorPermissions;
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  state: UserEditorState;
  updatedAt: Scalars['DateTime']['output'];
  user?: Maybe<User>;
  userId: Scalars['Id']['output'];
};

export type UserEditorMutation = {
  create: UserEditor;
  editor: UserEditorOperation;
};


export type UserEditorMutationCreateArgs = {
  editorId: Scalars['Id']['input'];
  permissions: UserEditorPermissionsInput;
  userId: Scalars['Id']['input'];
};


export type UserEditorMutationEditorArgs = {
  editorId: Scalars['Id']['input'];
  userId: Scalars['Id']['input'];
};

export type UserEditorOperation = {
  delete: Scalars['Boolean']['output'];
  updatePermissions: UserEditor;
  updateState: UserEditor;
};


export type UserEditorOperationUpdatePermissionsArgs = {
  permissions: UserEditorPermissionsInput;
};


export type UserEditorOperationUpdateStateArgs = {
  state: UserEditorUpdateState;
};

export type UserEditorPermissions = {
  emote: EditorEmotePermission;
  emoteSet: EditorEmoteSetPermission;
  superAdmin: Scalars['Boolean']['output'];
  user: EditorUserPermission;
};

export type UserEditorPermissionsInput = {
  emote: EditorEmotePermissionInput;
  emoteSet: EditorEmoteSetPermissionInput;
  superAdmin: Scalars['Boolean']['input'];
  user: EditorUserPermissionInput;
};

export enum UserEditorState {
  Accepted = 'ACCEPTED',
  Pending = 'PENDING',
  Rejected = 'REJECTED'
}

export enum UserEditorUpdateState {
  Accept = 'ACCEPT',
  Reject = 'REJECT'
}

export type UserEvent = {
  actor?: Maybe<User>;
  actorId?: Maybe<Scalars['Id']['output']>;
  createdAt: Scalars['DateTime']['output'];
  data: EventUserData;
  id: Scalars['Id']['output'];
  searchUpdatedAt?: Maybe<Scalars['DateTime']['output']>;
  target?: Maybe<User>;
  targetId: Scalars['Id']['output'];
  updatedAt: Scalars['DateTime']['output'];
};

export type UserInventory = {
  badges: Array<InventoryEntitlementEdgeAnyBadge>;
  paints: Array<InventoryEntitlementEdgeAnyPaint>;
  products: Array<InventoryEntitlementEdgeAnyProduct>;
};

export type UserMutation = {
  user: UserOperation;
};


export type UserMutationUserArgs = {
  id: Scalars['Id']['input'];
};

export type UserOperation = {
  activeBadge: User;
  activeEmoteSet: User;
  activePaint: User;
  deleteAllSessions: Scalars['Int']['output'];
  mainConnection: User;
  manuallyLinkKick: User;
  removeConnection: User;
  removeProfilePicture: User;
};


export type UserOperationActiveBadgeArgs = {
  badgeId?: InputMaybe<Scalars['Id']['input']>;
};


export type UserOperationActiveEmoteSetArgs = {
  emoteSetId?: InputMaybe<Scalars['Id']['input']>;
};


export type UserOperationActivePaintArgs = {
  paintId?: InputMaybe<Scalars['Id']['input']>;
};


export type UserOperationMainConnectionArgs = {
  platform: Platform;
  platformId: Scalars['String']['input'];
};


export type UserOperationManuallyLinkKickArgs = {
  kickChannel: KickLinkInput;
};


export type UserOperationRemoveConnectionArgs = {
  platform: Platform;
  platformId: Scalars['String']['input'];
};

export type UserPermission = {
  admin: Scalars['Boolean']['output'];
  billing: Scalars['Boolean']['output'];
  inviteEditors: Scalars['Boolean']['output'];
  login: Scalars['Boolean']['output'];
  manageAny: Scalars['Boolean']['output'];
  manageBilling: Scalars['Boolean']['output'];
  manageSessions: Scalars['Boolean']['output'];
  moderate: Scalars['Boolean']['output'];
  useBadge: Scalars['Boolean']['output'];
  useCustomProfilePicture: Scalars['Boolean']['output'];
  usePaint: Scalars['Boolean']['output'];
  usePersonalEmoteSet: Scalars['Boolean']['output'];
  viewHidden: Scalars['Boolean']['output'];
};

export type UserProfilePicture = {
  id: Scalars['Id']['output'];
  images: Array<Image>;
  updatedAt: Scalars['DateTime']['output'];
  userId: Scalars['Id']['output'];
};

export type UserQuery = {
  me?: Maybe<User>;
  search: UserSearchResult;
  user?: Maybe<User>;
  userByConnection?: Maybe<User>;
};


export type UserQuerySearchArgs = {
  page?: InputMaybe<Scalars['Int']['input']>;
  perPage?: InputMaybe<Scalars['Int']['input']>;
  query: Scalars['String']['input'];
};


export type UserQueryUserArgs = {
  id: Scalars['Id']['input'];
};


export type UserQueryUserByConnectionArgs = {
  platform: Platform;
  platformId: Scalars['String']['input'];
};

export type UserSearchResult = {
  items: Array<User>;
  pageCount: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
};

export type UserSessionMutation = {
  create: Scalars['String']['output'];
};


export type UserSessionMutationCreateArgs = {
  expiresAt: Scalars['DateTime']['input'];
  userId: Scalars['Id']['input'];
};

export type UserStyle = {
  activeBadge?: Maybe<Badge>;
  activeBadgeId?: Maybe<Scalars['Id']['output']>;
  activeEmoteSet?: Maybe<EmoteSet>;
  activeEmoteSetId?: Maybe<Scalars['Id']['output']>;
  activePaint?: Maybe<Paint>;
  activePaintId?: Maybe<Scalars['Id']['output']>;
  activeProfilePicture?: Maybe<UserProfilePicture>;
  activeProfilePictureId?: Maybe<Scalars['Id']['output']>;
  pendingProfilePictureId?: Maybe<Scalars['Id']['output']>;
};

export type _Service = {
  sdl?: Maybe<Scalars['String']['output']>;
};

export type GetEmoteSetQueryVariables = Exact<{
  id: Scalars['Id']['input'];
}>;


export type GetEmoteSetQuery = { emoteSets: { emoteSet?: { id: any, name: string, emotes: { items: Array<{ id: any, alias: string, flags: { zeroWidth: boolean }, emote: { id: any, defaultName: string, aspectRatio: number, flags: { animated: boolean }, images: Array<{ url: string, mime: string, size: number, scale: number, width: number, height: number, frameCount: number }> } }> } } | null } };

export type GetUserByConnectionQueryVariables = Exact<{
  platform: Platform;
  platformId: Scalars['String']['input'];
}>;


export type GetUserByConnectionQuery = { users: { userByConnection?: { id: any, mainConnection?: { platform: Platform, platformId: string, platformUsername: string, platformDisplayName: string } | null, style: { activeEmoteSetId?: any | null, activeEmoteSet?: { id: any, name: string, emotes: { items: Array<{ id: any, alias: string, flags: { zeroWidth: boolean }, emote: { id: any, defaultName: string, aspectRatio: number, flags: { animated: boolean }, images: Array<{ url: string, mime: string, size: number, scale: number, width: number, height: number, frameCount: number }> } }> } } | null } } | null } };


export const GetEmoteSetDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetEmoteSet"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Id"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"emoteSets"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"emoteSet"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"emotes"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"perPage"},"value":{"kind":"IntValue","value":"1000"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"alias"}},{"kind":"Field","name":{"kind":"Name","value":"flags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"zeroWidth"}}]}},{"kind":"Field","name":{"kind":"Name","value":"emote"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"defaultName"}},{"kind":"Field","name":{"kind":"Name","value":"flags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"animated"}}]}},{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"scale"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"frameCount"}}]}}]}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetEmoteSetQuery, GetEmoteSetQueryVariables>;
export const GetUserByConnectionDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetUserByConnection"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"platform"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Platform"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"platformId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"users"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"userByConnection"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"platform"},"value":{"kind":"Variable","name":{"kind":"Name","value":"platform"}}},{"kind":"Argument","name":{"kind":"Name","value":"platformId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"platformId"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"mainConnection"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"platform"}},{"kind":"Field","name":{"kind":"Name","value":"platformId"}},{"kind":"Field","name":{"kind":"Name","value":"platformUsername"}},{"kind":"Field","name":{"kind":"Name","value":"platformDisplayName"}}]}},{"kind":"Field","name":{"kind":"Name","value":"style"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"activeEmoteSetId"}},{"kind":"Field","name":{"kind":"Name","value":"activeEmoteSet"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"emotes"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"perPage"},"value":{"kind":"IntValue","value":"1000"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"items"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"alias"}},{"kind":"Field","name":{"kind":"Name","value":"flags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"zeroWidth"}}]}},{"kind":"Field","name":{"kind":"Name","value":"emote"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"defaultName"}},{"kind":"Field","name":{"kind":"Name","value":"flags"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"animated"}}]}},{"kind":"Field","name":{"kind":"Name","value":"aspectRatio"}},{"kind":"Field","name":{"kind":"Name","value":"images"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"mime"}},{"kind":"Field","name":{"kind":"Name","value":"size"}},{"kind":"Field","name":{"kind":"Name","value":"scale"}},{"kind":"Field","name":{"kind":"Name","value":"width"}},{"kind":"Field","name":{"kind":"Name","value":"height"}},{"kind":"Field","name":{"kind":"Name","value":"frameCount"}}]}}]}}]}}]}}]}}]}}]}}]}}]}}]} as unknown as DocumentNode<GetUserByConnectionQuery, GetUserByConnectionQueryVariables>;