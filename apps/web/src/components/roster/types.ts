import type {
  BotAlwaysAllowedTool,
  BotEngine,
  ChannelBinding,
  GroupMembership,
  ImageProviderId,
  LibraryFolderId,
  McpServerId,
  SandboxSize,
  Visibility,
  WorkParticipant,
} from "@otto/contracts";

/**
 * Local mirror of the bot roster wire shape the server-side persistence work
 * is building in parallel. Field-for-field identical so integration becomes a
 * type-import swap to `@otto/contracts`; do not diverge from that shape
 * here.
 */

export type BotBlobShape =
  | "circle"
  | "squircle"
  | "square"
  | "pill"
  | "triangle"
  | "hex"
  | "cloud"
  | "drop";

export type BotAvatar =
  | { kind: "blob"; shape: BotBlobShape; color: string }
  | { kind: "dither"; seed: string }
  | { kind: "image"; assetPath: string; dithered: boolean };

export interface Bot {
  id: string;
  name: string;
  title: string;
  label: string | null;
  description: string | null;
  disabledMcpServerIds: readonly McpServerId[];
  /** Skills (Library folder ids) switched off for this bot. */
  disabledSkillIds?: readonly LibraryFolderId[] | undefined;
  /** Tools a person chose Always allow for; they run without asking. */
  alwaysAllowed?: readonly BotAlwaysAllowedTool[] | undefined;
  /** The person responsible for the bot; its personal connections and skills serve it. */
  owner?: WorkParticipant | null | undefined;
  /** `user` shows the bot only to its owner and the people in its groups. */
  visibility?: Visibility | undefined;
  avatar: BotAvatar;
  engine: BotEngine | null;
  sandbox: "local" | "boat" | null;
  /** Boat size override. Null or absent uses the global default. Local ignores it. */
  sandboxSize?: SandboxSize | null;
  runtimeMode: "approval-required" | "auto-accept-edits" | "auto" | "full-access";
  /** What this bot should do and how it should work; the server adds it to every chat. */
  instructions: string | null;
  voiceEnabled: boolean;
  /** Image provider override; null or absent uses the environment's image generation default. */
  imageProvider?: ImageProviderId | null;
  channelBindings?: ReadonlyArray<ChannelBinding>;
  groupId: string | null;
  pinned: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  name: string;
  bossBotId: string | null;
  members: ReadonlyArray<GroupMembership>;
  createdAt: string;
  updatedAt: string;
}
