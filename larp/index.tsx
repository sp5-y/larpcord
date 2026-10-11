// larp tool - vencord userplugin, client side only

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { RenderModalProps, User } from "@vencord/discord-types";
import type { Embed, Message } from "@vencord/discord-types";
import { waitFor, filters, findByCodeLazy, findByPropsLazy } from "@webpack";
import {
    AuthenticationStore, ConnectedAccount, Constants, FluxDispatcher,
    openModal, closeModal, Modal, TextInput, Button, Forms, Text,
    DisplayProfileUtils, ScrollerThin, UserProfileStore, UserStore,
    UsernameUtils, useStateFromStores, TabBar, useState, useRef, useEffect, useMemo,
    showToast, Toasts, ReactDOM, RestAPI, MessageStore, Parser,
} from "@webpack/common";

interface BadgeEntry {
    id: string;
    description: string;
    icon: string;
    link?: string;
}

interface LarpCustomConnection {
    id: string;
    type: string;
    name: string;
}

interface LarpAvatarDecorationSetting {
    skuId: string;
    asset: string;
    label?: string;
    previewUrl?: string;
}

interface LarpProfileEffectSetting {
    skuId: string;
    id?: string;
    title?: string;
    description?: string;
    accessibilityLabel?: string;
    animationType?: number;
    thumbnailPreviewSrc?: string;
    reducedMotionSrc?: string;
    staticFrameSrc?: string;
    effects?: unknown[];
    type?: number;
}

interface ShopAvatarDeco {
    skuId: string;
    asset: string;
    label: string;
    name: string;
    previewUrl: string;
}

interface ShopProfileEffect {
    skuId: string;
    name: string;
    previewUrl: string;
    effect: LarpProfileEffectSetting;
}

interface LarpNameplateSetting {
    skuId: string;
    asset: string;
    label?: string;
    palette?: string;
    previewUrl?: string;
}

interface ShopNameplate {
    skuId: string;
    asset: string;
    label: string;
    name: string;
    previewUrl: string;
    palette?: string;
}

let cachedOwnUserId = "";
let cachedCustomJoinDate: Date | null = null;
let cachedCustomJoinDateMs: number | null = null;
let cachedCustomJoinDateKey = "";

function getCurrentUserId() {
    const id = AuthenticationStore.getId() ?? "";
    cachedOwnUserId = id;
    return id;
}

function connKey(c: ConnectedAccount) {
    return `${c.type}:${c.id}`;
}

function connectionTypeLabel(type: string) {
    return type.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function connectionNeedsDomain(type: string) {
    return type === "domain";
}

function normalizeDomain(input?: string) {
    if (!input) return "";
    return input.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

const CONNECTION_TYPE_OPTIONS = [
    "amazon-music", "battlenet", "bluesky", "bungie", "crunchyroll", "domain",
    "ebay", "epicgames", "facebook", "github", "instagram", "leagueoflegends",
    "mastodon", "paypal", "playstation", "reddit", "riotgames", "roblox",
    "samsung", "skype", "soundcloud", "spotify", "steam", "tiktok",
    "twitch", "twitter", "xbox", "youtube",
].map(type => ({ value: type, label: connectionTypeLabel(type) }));

function buildFakeConnection(c: LarpCustomConnection): ConnectedAccount | null {
    const id = c.id || `larp-${c.type}-${Date.now()}`;

    if (c.type === "domain") {
        const domain = normalizeDomain(c.name);
        if (!domain) return null;
        return { type: "domain", id, name: domain, verified: true };
    }

    const handle = c.name.trim();
    if (!handle) return null;

    return {
        type: c.type as ConnectedAccount["type"],
        id,
        name: handle,
        verified: true,
    };
}

function getRealConnections() {
    const userId = getCurrentUserId() ?? "";
    if (!userId) return [] as ConnectedAccount[];
    return origGetUserProfile?.(userId)?.connectedAccounts ?? [];
}

async function refreshOwnProfile() {
    const userId = getCurrentUserId();
    if (!userId) return;

    try {
        const { body } = await RestAPI.get({
            url: Constants.Endpoints.USER_PROFILE(userId),
            query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            oldFormErrors: true,
        });

        FluxDispatcher.dispatch({ type: "USER_UPDATE", user: body.user });
        await FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_SUCCESS", userProfile: body });
    } catch { }
}

const UserFlags = Constants.UserFlags as Record<string, number>;

// badge icons from mezotv repo
const BADGE_ASSETS_BASE = "https://cdn.jsdelivr.net/gh/mezotv/discord-badges@main/assets";
const BADGE_ASSETS_FALLBACK = "https://raw.githubusercontent.com/mezotv/discord-badges/main/assets";

const NITRO_TIERS = ["bronze", "silver", "gold", "platinum", "diamond", "emerald", "ruby", "opal"] as const;
const GIFTING_TIERS = ["patron", "champion", "luminary", "icon", "hero", "legend"] as const;

const BADGE_ICON_MAP: Record<string, string> = {
    staff: "discordstaff.svg",
    partner: "discordpartner.svg",
    certified_moderator: "discordmod.svg",
    hypesquad: "hypesquadevents.svg",
    hypesquad_house_1: "hypesquadbravery.svg",
    hypesquad_house_2: "hypesquadbrilliance.svg",
    hypesquad_house_3: "hypesquadbalance.svg",
    bug_hunter_level_1: "discordbughunter1.svg",
    bug_hunter_level_2: "discordbughunter2.svg",
    active_developer: "activedeveloper.svg",
    verified_developer: "discordbotdev.svg",
    early_supporter: "discordearlysupporter.svg",
    premium: "subscriptions/badges/bronze.png",
    premium_early_supporter: "discordearlysupporter.svg",
    quest_completed: "quest.png",
    quest: "quest.png",
    legacy_username: "username.png",
    automod: "automod.svg",
    orb: "orb.svg",
    ...Object.fromEntries(NITRO_TIERS.map(t => [`premium_${t}`, `subscriptions/badges/${t}.png`])),
    ...Object.fromEntries(GIFTING_TIERS.map(t => [`gifting_${t}`, `gifting/${t}.png`])),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [
        `guild_booster_lvl${i + 1}`,
        `boosts/discord-boost-${i + 1}.svg`,
    ])),
};

const KNOWN_BADGES: Record<string, { description: string; icon: string; link?: string }> = {
    staff: { description: "Discord Staff", icon: "discordstaff.svg", link: "https://discord.com/company" },
    partner: { description: "Partnered Server Owner", icon: "discordpartner.svg", link: "https://discord.com/partners" },
    certified_moderator: { description: "Moderator Programs Alumni", icon: "discordmod.svg", link: "https://discord.com/safety" },
    hypesquad: { description: "HypeSquad Events", icon: "hypesquadevents.svg", link: "https://discord.com/hypesquad" },
    hypesquad_house_1: { description: "HypeSquad Bravery", icon: "hypesquadbravery.svg", link: "https://discord.com/settings/hypesquad-online" },
    hypesquad_house_2: { description: "HypeSquad Brilliance", icon: "hypesquadbrilliance.svg", link: "https://discord.com/settings/hypesquad-online" },
    hypesquad_house_3: { description: "HypeSquad Balance", icon: "hypesquadbalance.svg", link: "https://discord.com/settings/hypesquad-online" },
    bug_hunter_level_1: { description: "Discord Bug Hunter", icon: "discordbughunter1.svg", link: "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs" },
    bug_hunter_level_2: { description: "Discord Bug Hunter (Gold)", icon: "discordbughunter2.svg", link: "https://support.discord.com/hc/en-us/articles/360046057772-Discord-Bugs" },
    active_developer: { description: "Active Developer", icon: "activedeveloper.svg", link: "https://support-dev.discord.com/hc/en-us/articles/10113997751447" },
    verified_developer: { description: "Early Verified Bot Developer", icon: "discordbotdev.svg" },
    early_supporter: { description: "Early Supporter", icon: "discordearlysupporter.svg", link: "https://discord.com/settings/premium" },
    premium: { description: "Discord Nitro (Bronze)", icon: "subscriptions/badges/bronze.png", link: "https://discord.com/settings/premium" },
    premium_bronze: { description: "Nitro Bronze", icon: "subscriptions/badges/bronze.png", link: "https://discord.com/settings/premium" },
    premium_silver: { description: "Nitro Silver", icon: "subscriptions/badges/silver.png", link: "https://discord.com/settings/premium" },
    premium_gold: { description: "Nitro Gold", icon: "subscriptions/badges/gold.png", link: "https://discord.com/settings/premium" },
    premium_platinum: { description: "Nitro Platinum", icon: "subscriptions/badges/platinum.png", link: "https://discord.com/settings/premium" },
    premium_diamond: { description: "Nitro Diamond", icon: "subscriptions/badges/diamond.png", link: "https://discord.com/settings/premium" },
    premium_emerald: { description: "Nitro Emerald", icon: "subscriptions/badges/emerald.png", link: "https://discord.com/settings/premium" },
    premium_ruby: { description: "Nitro Ruby", icon: "subscriptions/badges/ruby.png", link: "https://discord.com/settings/premium" },
    premium_opal: { description: "Nitro Opal", icon: "subscriptions/badges/opal.png", link: "https://discord.com/settings/premium" },
    guild_booster_lvl1: { description: "Server Booster (1 month)", icon: "boosts/discord-boost-1.svg", link: "https://discord.com/settings/premium" },
    guild_booster_lvl2: { description: "Server Booster (2 months)", icon: "boosts/discord-boost-2.svg", link: "https://discord.com/settings/premium" },
    guild_booster_lvl3: { description: "Server Booster (3 months)", icon: "boosts/discord-boost-3.svg", link: "https://discord.com/settings/premium" },
    guild_booster_lvl4: { description: "Server Booster (6 months)", icon: "boosts/discord-boost-4.svg", link: "https://discord.com/settings/premium" },
    guild_booster_lvl5: { description: "Server Booster (9 months)", icon: "boosts/discord-boost-5.svg", link: "https://discord.com/settings/premium" },
    guild_booster_lvl6: { description: "Server Booster (12 months)", icon: "boosts/discord-boost-6.svg", link: "https://discord.com/settings/premium" },
    guild_booster_lvl7: { description: "Server Booster (15 months)", icon: "boosts/discord-boost-7.svg", link: "https://discord.com/settings/premium" },
    guild_booster_lvl8: { description: "Server Booster (18 months)", icon: "boosts/discord-boost-8.svg", link: "https://discord.com/settings/premium" },
    guild_booster_lvl9: { description: "Server Booster (24+ months)", icon: "boosts/discord-boost-9.svg", link: "https://discord.com/settings/premium" },
    quest_completed: { description: "Quest Completed", icon: "quest.png" },
    quest: { description: "Quest Completed", icon: "quest.png" },
    legacy_username: { description: "Legacy Username Badge", icon: "username.png" },
    automod: { description: "AutoMod", icon: "automod.svg" },
    orb: { description: "Orb", icon: "orb.svg" },
    ...Object.fromEntries(GIFTING_TIERS.map(t => [`gifting_${t}`, {
        description: `Gifting ${t.charAt(0).toUpperCase()}${t.slice(1)}`,
        icon: `gifting/${t}.png`,
        link: "https://discord.com/shop",
    }])),
};

const FLAG_BADGE_IDS: Record<string, string> = {
    active_developer: "active_developer",
    bug_hunter_level_1: "bug_hunter_level_1",
    bug_hunter_level_2: "bug_hunter_level_2",
    certified_moderator: "certified_moderator",
    discord_employee: "staff",
    hypesquad: "hypesquad",
    hypesquad_online_house_1: "hypesquad_house_1",
    hypesquad_online_house_2: "hypesquad_house_2",
    hypesquad_online_house_3: "hypesquad_house_3",
    partner: "partner",
    premium_early_supporter: "early_supporter",
    verified_developer: "verified_developer",
};

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable Larp Tool",
        default: true,
        restartNeeded: false,
    },
    openManager: {
        type: OptionType.COMPONENT,
        component: () => (
            <>
                <Forms.FormText>Ctrl+B to toggle.</Forms.FormText>
                <Button onClick={openBadgeManager} size="small" style={{ marginTop: 8 }}>
                    Open Larp Tool
                </Button>
            </>
        ),
    },
    hiddenBadges: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    addedBadges: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    customUsername: {
        type: OptionType.STRING,
        default: "",
    },
    connectionOverrides: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, { name?: string }>,
    },
    hiddenConnections: {
        type: OptionType.CUSTOM,
        default: [] as string[],
    },
    customConnections: {
        type: OptionType.CUSTOM,
        default: [] as LarpCustomConnection[],
    },
    larpAvatarDecoration: {
        type: OptionType.CUSTOM,
        default: null as LarpAvatarDecorationSetting | null,
    },
    larpProfileEffect: {
        type: OptionType.CUSTOM,
        default: null as LarpProfileEffectSetting | null,
    },
    larpNameplate: {
        type: OptionType.CUSTOM,
        default: null as LarpNameplateSetting | null,
    },
    hiddenAvatarDecoration: {
        type: OptionType.BOOLEAN,
        description: "Hide your real avatar decoration (local only).",
        default: false,
    },
    hiddenProfileEffect: {
        type: OptionType.BOOLEAN,
        description: "Hide your real profile effect (local only).",
        default: false,
    },
    hiddenNameplate: {
        type: OptionType.BOOLEAN,
        description: "Hide your real nameplate (local only).",
        default: false,
    },
    customJoinDate: {
        type: OptionType.STRING,
        description: "Fake Member Since date (YYYY-MM-DD). Leave empty for real.",
        default: "",
    },
});

const useLegacyPlatformType: (platform: string) => string = findByCodeLazy(".TWITTER_LEGACY:");
const connectionPlatforms: { get(type: string): { icon: { lightSVG: string; darkSVG: string; }; getPlatformUserUrl?(c: ConnectedAccount): string; }; } = findByPropsLazy("isSupported", "getByUrl");
const unpatchFns: (() => void)[] = [];

// discord cdn hashes for hiding badges when runtime id is wrong
const DISCORD_ICON_HASHES: Record<string, string> = {
    active_developer: "6bdc42827a38498929a4920da12695d9",
    bug_hunter_level_1: "2717692c7dca7289b35297368a940dd0",
    bug_hunter_level_2: "848f79194d4be5ff5f81505cbd0ce1e6",
    certified_moderator: "fee1624003e2fee35cb398e125dc479b",
    staff: "5e74e9b61934fc1f67c65515d1f7e60d",
    discord_employee: "5e74e9b61934fc1f67c65515d1f7e60d",
    hypesquad: "bf01d1073931f921909045f3a39fd264",
    hypesquad_house_1: "8a88d63823d8a71cd5e390baa45efa02",
    hypesquad_house_2: "011940fd013da3f7fb926e4a1cd2e618",
    hypesquad_house_3: "3aa41de486fa12454c3761e8e223442e",
    partner: "3f9748e53446a137a052f3454e2de41e",
    premium: "2ba85e8026a8614b640c2837bcdfe21b",
    premium_bronze: "2ba85e8026a8614b640c2837bcdfe21b",
    early_supporter: "7060786766c9c840eb3019e725d2b358",
    premium_early_supporter: "7060786766c9c840eb3019e725d2b358",
    verified_developer: "6df5892e0f35b051f8b61eace34f4967",
};

let unfilteredGetBadges: ((this: { userId: string }) => Array<{
    id?: string;
    key?: string;
    icon?: string;
    iconSrc?: string;
}>) | null = null;

let origGetUserProfile: typeof UserProfileStore.getUserProfile;
let origGetCurrentUser: typeof UserStore.getCurrentUser;
let origGetUser: typeof UserStore.getUser;
let origGetMessage: typeof MessageStore.getMessage;
let origGetMessages: typeof MessageStore.getMessages;
let origParserParse: typeof Parser.parse;
let MediaResolver: {
    getAvatarDecorationURL?: (opts: {
        avatarDecoration: { asset: string; skuId: string; };
        canAnimate?: boolean;
    }) => string | null;
} | undefined;
let CollectiblesAssets: {
    getCollectiblesItemAssetUrl?: (opts: {
        skuId: string;
        assetFormat: string;
        assetId?: string;
    }) => string | null;
    CollectiblesItemAssetFormat?: { STATIC: string; ANIMATED: string; VIDEO: string; };
} | undefined;
let cachedRealUsername = "";
const wrappedMessageCache = new Map<string, Message>();
const usernameProxyCache = new WeakMap<User, User & { __larpKey?: string; }>();
let userProxyGeneration = 0;
const displayProfileProxyCache = new WeakMap<object, unknown>();
const messageCollectionProxyCache = new WeakMap<object, ReturnType<typeof MessageStore.getMessages>>();
const wrappedProfileCache = new Map<string, { sig: string; value: NonNullable<ReturnType<typeof UserProfileStore.getUserProfile>>; }>();
let profileWrapDepth = 0;
let profileWrapGeneration = 0;
let messageCollectionGeneration = 0;
let hiddenBadgeSetCache: Set<string> | null = null;
let hiddenBadgeSetCacheKey = "";

interface UsernameSwapCtx {
    active: boolean;
    real: string;
    custom: string;
}

let profileRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let profileDomObserver: MutationObserver | null = null;
let profileDomObserverRafId = 0;
let profileDomObserverActive = false;
let profileDomObserverScheduled = false;
let usernameSwapCtx: UsernameSwapCtx = { active: false, real: "", custom: "" };
const HIDDEN_BADGE_STYLE_ID = "vc-larp-tool-hidden-badges";
const TAB_ANIM_STYLE_ID = "vc-larp-tool-tab-anim-v2";

const ModalTabs = {
    Username: 0,
    Badges: 1,
    Decorations: 2,
    MemberSince: 3,
    Connections: 4,
    Credits: 5,
} as const;
const DecorationSubTabs = { Avatar: 0, Banner: 1, Nameplate: 2 } as const;
const SHOP_CACHE_MS = 30 * 60 * 1000;
const DECORATION_BROWSE_LIMIT = 16;
const COLLECTIBLE_TYPE_BUNDLE = 1000;
const SHOP_SEARCH_CACHE_MAX = 12;

let shopCache: {
    avatar: ShopAvatarDeco[];
    banner: ShopProfileEffect[];
    nameplate: ShopNameplate[];
    fetchedAt: number;
    version?: number;
} | null = null;
const SHOP_CACHE_VERSION = 3;
const shopEnrichedTabs = new Set<number>();

const shopProductCache = new Map<string, {
    sku_id?: string;
    name?: string;
    type?: number;
    items?: Array<Record<string, unknown>>;
    variants?: Array<Record<string, unknown>>;
}>();
const shopProductInflight = new Map<string, Promise<{
    sku_id?: string;
    name?: string;
    type?: number;
    items?: Array<Record<string, unknown>>;
    variants?: Array<Record<string, unknown>>;
} | undefined>>();
const shopSearchCache = new Map<string, ShopAvatarDeco[] | ShopProfileEffect[] | ShopNameplate[]>();
const larpCollectibleProducts = new Map<string, Record<string, unknown>>();
const collectiblesProductStores = new Set<{
    products?: Record<string, unknown>;
    getProduct?: (id: string) => unknown;
    __larpPatched?: boolean;
}>();
const preloadedDecorationUrls = new Set<string>();
const SHOP_PRODUCT_BATCH_SIZE = 8;
const SHOP_ENRICH_CONCURRENCY = 2;
const SHOP_PRELOAD_LIMIT = 6;
const COLLECTIBLES_SHOP_CDN = "https://cdn.discordapp.com/media/v1/collectibles-shop";
const COLLECTIBLES_ASSET_CDN = "https://cdn.discordapp.com/assets/collectibles";
const AVATAR_DECORATION_CDN = "https://cdn.discordapp.com/avatar-decoration-presets";
const VALID_NAMEPLATE_PALETTES = new Set([
    "berry", "bubble_gum", "clover", "cobalt", "crimson", "forest", "lemon", "sky", "teal", "violet", "white",
]);
let larpNameplateReady = false;
let larpProfileEffectReady = false;
let CollectiblesProductClass: {
    fromServer(body: unknown): {
        skuId?: string;
        sku_id?: string;
        items?: unknown[];
        name?: string;
        type?: number;
        [key: string]: unknown;
    };
} | undefined;
let ProfileEffectClass: {
    fromServer(body: unknown): unknown;
} | undefined;
let CollectiblesProductParser: {
    fromServer(body: unknown): unknown;
} | undefined;

function isProfileEffectInstance(item: unknown) {
    if (!item || typeof item !== "object") return false;
    const typed = item as { effects?: unknown[]; animationType?: number; type?: number; };
    return Array.isArray(typed.effects) && typed.effects.length > 0;
}

function callProfileEffectFromServer(payload: Record<string, unknown>) {
    const cls = ProfileEffectClass as {
        fromServer?: (body: unknown) => unknown;
        Ay?: { fromServer?: (body: unknown) => unknown; };
    } | undefined;
    const fromServer = typeof cls?.fromServer === "function"
        ? cls.fromServer.bind(cls)
        : typeof cls?.Ay?.fromServer === "function"
            ? cls.Ay.fromServer.bind(cls.Ay)
            : null;
    if (!fromServer) return null;
    try {
        return fromServer(payload);
    } catch {
        return null;
    }
}

function callCollectibleProductFromServer(body: Record<string, unknown>) {
    const cls = CollectiblesProductParser as {
        fromServer?: (body: unknown) => unknown;
        A?: { fromServer?: (body: unknown) => unknown; };
    } | undefined;
    const fromServer = typeof cls?.fromServer === "function"
        ? cls.fromServer.bind(cls)
        : typeof cls?.A?.fromServer === "function"
            ? cls.A.fromServer.bind(cls.A)
            : null;
    if (!fromServer) return null;
    try {
        return fromServer(body);
    } catch {
        return null;
    }
}

interface LarpExportData {
    version?: number;
    name?: string;
    customUsername?: string;
    customJoinDate?: string;
    hiddenBadges?: string[];
    addedBadges?: string[];
    connectionOverrides?: Record<string, { name?: string }>;
    hiddenConnections?: string[];
    customConnections?: LarpCustomConnection[];
    larpAvatarDecoration?: LarpAvatarDecorationSetting | null;
    larpProfileEffect?: LarpProfileEffectSetting | null;
    larpNameplate?: LarpNameplateSetting | null;
    hiddenAvatarDecoration?: boolean;
    hiddenProfileEffect?: boolean;
    hiddenNameplate?: boolean;
}

const cardStyle = {
    padding: "12px 14px",
    borderRadius: 12,
    background: "transparent",
    border: "none",
    boxShadow: "0 1px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.12)",
};

const connectionRowStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "transparent",
    border: "none",
    boxShadow: "0 1px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.12)",
};

const sectionTitleStyle = {
    margin: "0 0 8px",
    color: "var(--header-secondary)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
};

const MODAL_BODY_MAX_HEIGHT = "38vh";

function FieldCard({ label, hint, children }: { label: string; hint?: string; children: any }) {
    return (
        <div style={cardStyle}>
            <Text variant="text-xs/medium" style={{ ...sectionTitleStyle, marginBottom: hint ? 4 : 8 }}>
                {label}
            </Text>
            {hint && (
                <Forms.FormText style={{ margin: "0 0 10px", color: "var(--text-muted)", fontSize: 12 }}>
                    {hint}
                </Forms.FormText>
            )}
            {children}
        </div>
    );
}

function applyLarpExportData(data: LarpExportData) {
    settings.store.customUsername = typeof data.customUsername === "string" ? data.customUsername.slice(0, 32) : "";
    settings.store.customJoinDate = typeof data.customJoinDate === "string"
        && /^\d{4}-\d{2}-\d{2}$/.test(data.customJoinDate.trim())
        ? data.customJoinDate.trim()
        : "";
    settings.store.hiddenBadges = Array.isArray(data.hiddenBadges)
        ? data.hiddenBadges.filter(x => typeof x === "string")
        : [];
    settings.store.addedBadges = Array.isArray(data.addedBadges)
        ? data.addedBadges.filter(x => typeof x === "string")
        : [];
    settings.store.connectionOverrides = data.connectionOverrides && typeof data.connectionOverrides === "object"
        ? { ...data.connectionOverrides }
        : {};
    settings.store.hiddenConnections = Array.isArray(data.hiddenConnections)
        ? data.hiddenConnections.filter(x => typeof x === "string")
        : [];
    settings.store.customConnections = Array.isArray(data.customConnections)
        ? data.customConnections.filter(c => c?.id && c?.type).map(c => ({
            id: String(c.id),
            type: String(c.type),
            name: typeof c.name === "string" ? c.name : "",
        }))
        : [];
    settings.store.larpAvatarDecoration = data.larpAvatarDecoration?.skuId && data.larpAvatarDecoration?.asset
        ? {
            skuId: String(data.larpAvatarDecoration.skuId),
            asset: String(data.larpAvatarDecoration.asset),
            label: typeof data.larpAvatarDecoration.label === "string"
                ? data.larpAvatarDecoration.label
                : undefined,
        }
        : null;
    settings.store.larpProfileEffect = data.larpProfileEffect?.skuId
        ? { ...data.larpProfileEffect, skuId: String(data.larpProfileEffect.skuId) }
        : null;
    settings.store.larpNameplate = data.larpNameplate?.skuId && data.larpNameplate?.asset
        ? {
            skuId: String(data.larpNameplate.skuId),
            asset: String(data.larpNameplate.asset),
            label: typeof data.larpNameplate.label === "string" ? data.larpNameplate.label : undefined,
            palette: typeof data.larpNameplate.palette === "string" ? data.larpNameplate.palette : undefined,
            previewUrl: typeof data.larpNameplate.previewUrl === "string" ? data.larpNameplate.previewUrl : undefined,
        }
        : null;
    settings.store.hiddenAvatarDecoration = !!data.hiddenAvatarDecoration;
    settings.store.hiddenProfileEffect = !!data.hiddenProfileEffect;
    settings.store.hiddenNameplate = !!data.hiddenNameplate;
    larpNameplateReady = !settings.store.larpNameplate?.skuId || !!settings.store.larpNameplate?.asset;
    larpProfileEffectReady = !settings.store.larpProfileEffect?.skuId;
    ensureLarpDecorationProductsFromSettings();
    updateHiddenBadgeStyles();
    void hydrateLarpProductsFromApi().then(() => triggerProfileRefresh());
}

function resetLarpConfig() {
    applyLarpExportData({
        customUsername: "",
        customJoinDate: "",
        hiddenBadges: [],
        addedBadges: [],
        connectionOverrides: {},
        hiddenConnections: [],
        customConnections: [],
        larpAvatarDecoration: null,
        larpProfileEffect: null,
        larpNameplate: null,
        hiddenAvatarDecoration: false,
        hiddenProfileEffect: false,
        hiddenNameplate: false,
    });
}

function ensureTabAnimStyles() {
    if (document.getElementById(TAB_ANIM_STYLE_ID)) return;
    document.getElementById("vc-larp-tool-tab-anim")?.remove();
    const style = document.createElement("style");
    style.id = TAB_ANIM_STYLE_ID;
    style.textContent = `
        @keyframes vc-larp-tab-in {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes vc-larp-skeleton {
            0% { background-position: 100% 0; }
            100% { background-position: -100% 0; }
        }
        .vc-larp-tab-panel {
            animation: vc-larp-tab-in 180ms cubic-bezier(0.2, 0, 0, 1) both;
        }
        .vc-larp-skeleton {
            background: linear-gradient(
                90deg,
                rgba(255,255,255,0.04) 0%,
                rgba(255,255,255,0.1) 45%,
                rgba(255,255,255,0.04) 90%
            );
            background-size: 200% 100%;
            animation: vc-larp-skeleton 1.1s ease-in-out infinite;
            border-radius: 10px;
        }
        .vc-larp-seg {
            display: flex;
            gap: 4px;
            padding: 4px;
            border-radius: 10px;
            box-shadow: 0 1px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.12);
            margin-bottom: 12px;
        }
        .vc-larp-seg-btn {
            flex: 1;
            border: none;
            background: transparent;
            color: var(--text-muted);
            font-size: 13px;
            font-weight: 600;
            padding: 8px 10px;
            border-radius: 8px;
            cursor: pointer;
        }
        .vc-larp-seg-btn[data-active="true"] {
            background: var(--background-modifier-selected);
            color: var(--header-primary);
        }
        .vc-larp-icon-btn {
            width: 28px;
            height: 28px;
            border: none;
            border-radius: 8px;
            background: transparent;
            color: var(--interactive-normal);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            line-height: 1;
            flex-shrink: 0;
        }
        .vc-larp-icon-btn:hover {
            background: var(--background-modifier-hover);
            color: var(--interactive-active);
        }
    `;
    document.head.appendChild(style);
}

function plainStoreObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object") return null;
    if (typeof (value as { toJS?: () => unknown; }).toJS === "function") {
        return (value as { toJS: () => unknown; }).toJS() as Record<string, unknown>;
    }
    return { ...(value as Record<string, unknown>) };
}

function isReadyLarpNameplateProduct(product: Record<string, unknown> | undefined) {
    if (!product?.name) return false;

    const items = product.items as Array<Record<string, unknown>> | undefined;
    const item = items?.find(i => i.type === 2 || product.type === 2) ?? items?.[0];
    if (typeof item?.asset !== "string") return false;

    if (product.__larpHydrated === true) return true;

    const palette = normalizeNameplatePalette(typeof item.palette === "string" ? item.palette : undefined);
    return VALID_NAMEPLATE_PALETTES.has(palette);
}

function isReadyLarpProfileEffectProduct(product: Record<string, unknown> | undefined) {
    if (!product?.name) return false;

    const item = getProfileEffectItemFromProduct(product);
    if (!item) return false;

    if (isProfileEffectInstance(item)) return true;

    const effects = (item as { effects?: unknown[] }).effects;
    return Array.isArray(effects) && effects.length > 0;
}

function getProfileEffectItemFromProduct(product: Record<string, unknown> | undefined) {
    const items = product?.items as unknown[] | undefined;
    return items?.find(entry => {
        const typed = entry as { type?: number; effects?: unknown[] };
        return typed?.type === 1 || Array.isArray(typed?.effects);
    }) ?? items?.[0] ?? null;
}

function parseProfileEffectItem(raw: Record<string, unknown>, skuId: string) {
    const payload = {
        ...raw,
        sku_id: skuId,
        skuId,
        type: typeof raw.type === "number" ? raw.type : 1,
    };

    return callProfileEffectFromServer(payload);
}

function registerParsedProfileEffectProduct(
    skuId: string,
    name: string,
    rawItem: Record<string, unknown>,
    rawProduct?: Record<string, unknown>,
) {
    const parsedItem = parseProfileEffectItem(rawItem, skuId);
    const fallbackItem = {
        ...rawItem,
        sku_id: skuId,
        skuId,
        type: typeof rawItem.type === "number" ? rawItem.type : 1,
    };

    const product: Record<string, unknown> = {
        ...(rawProduct ?? larpCollectibleProducts.get(skuId) ?? {}),
        sku_id: skuId,
        skuId,
        name: String(rawProduct?.name ?? name),
        type: 1,
        items: [parsedItem ?? fallbackItem],
        __larpHydrated: !!parsedItem,
    };

    larpCollectibleProducts.set(skuId, product);
    shopProductCache.set(skuId, product as {
        sku_id?: string;
        name?: string;
        type?: number;
        items?: Array<Record<string, unknown>>;
        variants?: Array<Record<string, unknown>>;
    });
    if (parsedItem) {
        injectLarpProductIntoStores(skuId, product);
        return true;
    }
    return false;
}

function parseCollectibleProductFromApi(body: Record<string, unknown>) {
    const parsed = callCollectibleProductFromServer(body);
    if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown> & { skuId?: string; items?: unknown[]; };
    }

    try {
        if (CollectiblesProductClass?.fromServer) {
            return CollectiblesProductClass.fromServer(body) as Record<string, unknown> & {
                skuId?: string;
                items?: unknown[];
            };
        }
    } catch { }
    return null;
}

function getLarpProductForStore(skuId: string) {
    const product = larpCollectibleProducts.get(String(skuId));
    if (!product) return null;
    if (product.type === 2 && !isReadyLarpNameplateProduct(product)) return null;
    if (product.type === 1 && !isReadyLarpProfileEffectProduct(product)) return null;
    return product;
}

function injectLarpProductIntoStores(skuId: string, product: Record<string, unknown>) {
    if (product.type === 2 && !isReadyLarpNameplateProduct(product)) return;
    if (product.type === 1 && !isReadyLarpProfileEffectProduct(product)) return;

    for (const store of collectiblesProductStores) {
        if (!store.products) continue;
        store.products[skuId] = product;
    }
}

function registerLarpCollectibleProduct(
    skuId: string,
    name: string,
    type: number,
    item: Record<string, unknown>,
) {
    const existing = larpCollectibleProducts.get(skuId);
    const product: Record<string, unknown> = {
        ...(existing ?? {}),
        sku_id: skuId,
        name: String(existing?.name ?? name),
        type: typeof existing?.type === "number" ? existing.type : type,
        summary: String(existing?.summary ?? existing?.name ?? name),
        items: Array.isArray(existing?.items)
            ? existing.items
            : [{ ...item, type, sku_id: skuId }],
    };
    larpCollectibleProducts.set(skuId, product);
    shopProductCache.set(skuId, product as {
        sku_id?: string;
        name?: string;
        type?: number;
        items?: Array<Record<string, unknown>>;
        variants?: Array<Record<string, unknown>>;
    });
    if (type !== 1) {
        injectLarpProductIntoStores(skuId, product);
    }
}

function registerFullCollectibleProduct(product: Record<string, unknown>) {
    const skuId = String(product.sku_id ?? product.skuId ?? "");
    if (!skuId) return;

    const parsed = parseCollectibleProductFromApi(product);
    const resolvedSkuId = String(parsed?.skuId ?? parsed?.sku_id ?? skuId);
    const merged = {
        ...(larpCollectibleProducts.get(resolvedSkuId) ?? {}),
        ...(parsed ?? product),
        sku_id: resolvedSkuId,
        skuId: resolvedSkuId,
        name: String(parsed?.name ?? product.name ?? larpCollectibleProducts.get(resolvedSkuId)?.name ?? "Collectible"),
        __larpHydrated: true,
    };

    const mergedItem = getProfileEffectItemFromProduct(merged);
    if (mergedItem && !isProfileEffectInstance(mergedItem)) {
        const rawItem = plainStoreObject(mergedItem) ?? mergedItem as Record<string, unknown>;
        registerParsedProfileEffectProduct(
            resolvedSkuId,
            String(merged.name ?? "Profile effect"),
            rawItem,
            merged,
        );
        return;
    }

    larpCollectibleProducts.set(resolvedSkuId, merged);
    shopProductCache.set(resolvedSkuId, merged as {
        sku_id?: string;
        name?: string;
        type?: number;
        items?: Array<Record<string, unknown>>;
        variants?: Array<Record<string, unknown>>;
    });
    injectLarpProductIntoStores(resolvedSkuId, merged);
}

function ensureLarpDecorationProductsFromSettings() {
    const plate = settings.store.larpNameplate;
    if (plate?.skuId && plate.asset && !larpCollectibleProducts.has(plate.skuId)) {
        const palette = resolveNameplatePalette(plate);
        registerLarpCollectibleProduct(plate.skuId, plate.label ?? "Nameplate", 2, {
            asset: plate.asset,
            label: plate.label ?? "",
            palette,
            sku_id: plate.skuId,
            type: 2,
        });
    }

    const deco = settings.store.larpAvatarDecoration;
    if (deco?.skuId && deco.asset && !larpCollectibleProducts.has(deco.skuId)) {
        registerLarpCollectibleProduct(deco.skuId, deco.label ?? "Avatar decoration", 0, {
            asset: deco.asset,
            label: deco.label ?? "",
            sku_id: deco.skuId,
            type: 0,
        });
    }

    const effect = settings.store.larpProfileEffect;
    if (effect?.skuId) {
        registerParsedProfileEffectProduct(
            effect.skuId,
            effect.title ?? "Profile effect",
            effect as Record<string, unknown>,
        );
    }
}

async function hydrateLarpProductsFromApi() {
    const skuIds = new Set<string>();
    const plate = settings.store.larpNameplate;
    const deco = settings.store.larpAvatarDecoration;
    const effect = settings.store.larpProfileEffect;
    if (plate?.skuId) skuIds.add(plate.skuId);
    if (deco?.skuId) skuIds.add(deco.skuId);
    if (effect?.skuId) skuIds.add(effect.skuId);
    if (!skuIds.size) {
        larpNameplateReady = true;
        larpProfileEffectReady = true;
        return;
    }

    await Promise.all([...skuIds].map(async skuId => {
        try {
            const product = await fetchShopProduct(skuId, true);
            if (product?.sku_id) registerFullCollectibleProduct(product as Record<string, unknown>);
        } catch { }
    }));

    if (plate?.skuId && plate.asset) {
        const palette = resolveNameplatePalette(plate);
        if (palette !== plate.palette) {
            settings.store.larpNameplate = { ...plate, palette };
        }
        ensureLarpDecorationProductsFromSettings();
    }

    larpNameplateReady = !plate?.skuId || !!plate?.asset;
    larpProfileEffectReady = !effect?.skuId || isReadyLarpProfileEffectProduct(larpCollectibleProducts.get(effect.skuId));
    if (larpNameplateReady || larpProfileEffectReady) userProxyGeneration++;
}

function getRealUserCollectiblesNameplate() {
    const user = origGetCurrentUser?.();
    if (!user?.collectibles) return null;
    return plainStoreObject((user.collectibles as { nameplate?: unknown; }).nameplate);
}

function normalizeNameplatePalette(palette: string | undefined) {
    const value = palette?.trim().toLowerCase();
    if (value && VALID_NAMEPLATE_PALETTES.has(value)) return value;
    return "crimson";
}

function resolveNameplatePalette(plate: LarpNameplateSetting): string {
    if (plate.palette) return normalizeNameplatePalette(plate.palette);

    const real = getRealUserCollectiblesNameplate();
    if (real?.palette) return normalizeNameplatePalette(String(real.palette));

    const product = larpCollectibleProducts.get(plate.skuId);
    const items = product?.items as Array<{ palette?: string; }> | undefined;
    const item = items?.find(i => i.palette) ?? items?.[0];
    if (item?.palette) return normalizeNameplatePalette(item.palette);

    return "crimson";
}

function buildLarpNameplateCollectible(plate: LarpNameplateSetting) {
    return {
        asset: plate.asset,
        skuId: plate.skuId,
        expires_at: null,
        label: plate.label ?? "",
        palette: resolveNameplatePalette(plate),
        type: 2,
    };
}

function buildLarpCollectibles(plate: LarpNameplateSetting) {
    const user = origGetCurrentUser?.();
    const realCollectibles = plainStoreObject(user?.collectibles);
    const { nameplate: _realNameplate, ...rest } = realCollectibles ?? {};
    return {
        ...(Object.keys(rest).length ? rest : {}),
        nameplate: buildLarpNameplateCollectible(plate),
    };
}

function stripRealNameplateCollectibles() {
    const user = origGetCurrentUser?.();
    const realCollectibles = plainStoreObject(user?.collectibles);
    if (!realCollectibles) return null;
    const { nameplate: _realNameplate, ...rest } = realCollectibles;
    return Object.keys(rest).length ? rest : null;
}

function applyLarpNameplateOverride(
    user: User | null | undefined,
    _member: { collectibles?: { nameplate?: unknown; }; } | null | undefined,
    normalizeNameplate: (value: unknown) => unknown,
) {
    if (!user?.id || user.id !== getCurrentUserId() || !settings.store.enabled) return undefined;

    if (isNameplateHidden()) return null;

    const plate = getLarpNameplate();
    if (!plate) return undefined;

    if (!canSpoofLarpNameplate(plate)) return null;

    const raw = buildLarpNameplateCollectible(plate);
    return normalizeNameplate(raw) ?? raw;
}

function resolveRenderedNameplate(
    user: User | null | undefined,
    member: { collectibles?: { nameplate?: unknown; }; } | null | undefined,
    wk: (value: unknown) => unknown,
) {
    const override = applyLarpNameplateOverride(user, member, wk);
    if (override !== undefined) return override;
    return wk(member?.collectibles?.nameplate) ?? user?.nameplate ?? null;
}

function getCollectiblesAssetFormat(format: "static" | "animated" | "video") {
    const map = CollectiblesAssets?.CollectiblesItemAssetFormat;
    if (!map) return format;
    if (format === "animated") return map.ANIMATED;
    if (format === "video") return map.VIDEO;
    return map.STATIC;
}

function resolveNameplatePreviewUrl(asset: string) {
    if (!asset) return "";
    if (asset.startsWith("http")) return asset;

    const path = asset.replace(/^\/+/, "").replace(/\/?$/, "/");
    return `${COLLECTIBLES_ASSET_CDN}/${path}static.png`;
}

function resolveNameplateAnimatedUrl(asset: string) {
    if (!asset) return "";
    if (asset.startsWith("http")) {
        if (asset.endsWith("static.png")) return asset.replace(/static\.png$/, "asset.webm");
        if (asset.endsWith("img.png")) return asset.replace(/img\.png$/, "asset.webm");
        return asset;
    }

    const path = asset.replace(/^\/+/, "").replace(/\/?$/, "/");
    return `${COLLECTIBLES_ASSET_CDN}/${path}asset.webm`;
}

function resolveNameplateAssetCandidates(asset: string) {
    if (!asset) return [] as string[];
    if (asset.startsWith("http")) return [asset];

    const path = asset.replace(/^\/+/, "").replace(/\/?$/, "/");
    return [
        `${COLLECTIBLES_ASSET_CDN}/${path}static.png`,
        `${COLLECTIBLES_ASSET_CDN}/${path}img.png`,
        `${COLLECTIBLES_ASSET_CDN}/${path}asset.webm`,
    ];
}

function getCollectiblesShopAssetUrl(
    skuId: string,
    format: "static" | "animated" | "video" = "static",
    assetId?: string,
) {
    if (!skuId) return "";
    try {
        const url = CollectiblesAssets?.getCollectiblesItemAssetUrl?.({
            skuId,
            assetFormat: getCollectiblesAssetFormat(format),
            ...(assetId ? { assetId } : {}),
        });
        if (url) return url;
    } catch { }
    const segment = assetId ? `${skuId}/${assetId}/${format}` : `${skuId}/${format}`;
    return `${COLLECTIBLES_SHOP_CDN}/${segment}`;
}

function absolutizeCollectibleUrl(url: string) {
    if (!url) return "";
    if (url.startsWith("http")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("/")) return `https://cdn.discordapp.com${url}`;
    return url;
}

function resolveAvatarDecorationPreviewUrl(skuId: string, asset: string) {
    try {
        const url = MediaResolver?.getAvatarDecorationURL?.({
            avatarDecoration: { asset, skuId },
            canAnimate: false,
        });
        if (url) return url;
    } catch { }
    return `${AVATAR_DECORATION_CDN}/${asset}.png?size=96&passthrough=true`;
}

function resolveShopPreviewUrl(
    skuId: string,
    type: number,
    item: Record<string, unknown>,
    assets?: { static_image_url?: string; animated_image_url?: string; },
) {
    const fromAssets = assets?.static_image_url ?? assets?.animated_image_url;
    if (fromAssets) return absolutizeCollectibleUrl(String(fromAssets));

    if (type === 0 && typeof item.asset === "string") {
        return resolveAvatarDecorationPreviewUrl(skuId, item.asset);
    }

    if (type === 1) {
        const thumb = item.thumbnailPreviewSrc ?? item.staticFrameSrc;
        if (typeof thumb === "string" && thumb) return absolutizeCollectibleUrl(thumb);
        if (typeof item.asset === "string") {
            return getCollectiblesShopAssetUrl(skuId, "static", item.asset);
        }
        return getCollectiblesShopAssetUrl(skuId, "static");
    }

    if (type === 2) {
        if (typeof item.asset === "string") {
            return resolveNameplatePreviewUrl(item.asset);
        }
        return getCollectiblesShopAssetUrl(skuId, "static");
    }

    return getCollectiblesShopAssetUrl(skuId, "static");
}

function shopPreviewNeedsEnrichment(previewUrl: string, type: number, item?: { effect?: { effects?: unknown[]; }; asset?: string; }) {
    if (type === 1 && !(item?.effect?.effects && item.effect.effects.length > 0)) return true;
    if (!previewUrl) return true;
    const url = absolutizeCollectibleUrl(previewUrl);
    if (type === 0) return !url.includes("avatar-decoration-presets");
    if (type === 1) {
        return !url.startsWith("http")
            || /\/collectibles-shop\/[^/]+\/static(?:\?|$|\/)/.test(url);
    }
    if (type === 2) {
        // Nameplates must use assets/collectibles/{asset}/static.png — shop CDN URLs are wrong
        if (url.includes("/assets/collectibles/") && url.endsWith("static.png")) return false;
        if (typeof item?.asset === "string" && item.asset.includes("nameplates")) return false;
        return !url.includes("/assets/collectibles/");
    }
    return false;
}

async function runWithConcurrency<T>(jobs: Array<() => Promise<T>>, limit: number) {
    if (!jobs.length) return [] as T[];
    const results: T[] = new Array(jobs.length);
    let next = 0;

    async function worker() {
        while (next < jobs.length) {
            const idx = next++;
            results[idx] = await jobs[idx]();
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, () => worker()));
    return results;
}

async function enrichShopItemPreview<T extends { skuId: string; previewUrl: string; effect?: LarpProfileEffectSetting; }>(
    item: T,
    type: number,
): Promise<T> {
    if (!shopPreviewNeedsEnrichment(item.previewUrl, type, item)) return item;

    try {
        const product = await fetchShopProduct(item.skuId);
        const avatar: ShopAvatarDeco[] = [];
        const banner: ShopProfileEffect[] = [];
        const nameplate: ShopNameplate[] = [];
        collectShopItemsFromProduct(product, avatar, banner, nameplate);
        const pool = type === 0 ? avatar : type === 1 ? banner : nameplate;
        const match = pool.find(entry => entry.skuId === item.skuId);
        if (!match) return item;

        if (type === 1) {
            const bannerMatch = match as ShopProfileEffect;
            return {
                ...item,
                previewUrl: bannerMatch.previewUrl || item.previewUrl,
                effect: {
                    ...(item.effect ?? {}),
                    ...bannerMatch.effect,
                    skuId: item.skuId,
                    effects: bannerMatch.effect.effects?.length
                        ? bannerMatch.effect.effects
                        : item.effect?.effects,
                },
            };
        }

        if (match.previewUrl) return { ...item, previewUrl: match.previewUrl };
    } catch { }

    return item;
}

async function enrichShopPreviews(cache: NonNullable<typeof shopCache>, type?: number) {
    const enrichType = (list: Array<{ skuId: string; previewUrl: string; effect?: LarpProfileEffectSetting; }>, itemType: number, mutate: (idx: number, item: typeof list[number]) => void) => {
        const jobs: Array<() => Promise<void>> = [];
        for (let i = 0; i < Math.min(list.length, DECORATION_BROWSE_LIMIT); i++) {
            if (!shopPreviewNeedsEnrichment(list[i].previewUrl, itemType, list[i])) continue;
            const idx = i;
            jobs.push(async () => {
                const item = await enrichShopItemPreview(list[idx], itemType);
                mutate(idx, item);
            });
        }
        return jobs;
    };

    const jobs: Array<() => Promise<void>> = [];
    if (type === undefined || type === 0) {
        jobs.push(...enrichType(cache.avatar, 0, (idx, item) => { cache.avatar[idx] = item as ShopAvatarDeco; }));
    }
    if (type === undefined || type === 1) {
        jobs.push(...enrichType(cache.banner, 1, (idx, item) => { cache.banner[idx] = item as ShopProfileEffect; }));
    }
    if (type === undefined || type === 2) {
        jobs.push(...enrichType(cache.nameplate, 2, (idx, item) => { cache.nameplate[idx] = item as ShopNameplate; }));
    }

    if (jobs.length) await runWithConcurrency(jobs, SHOP_ENRICH_CONCURRENCY);
    return cache;
}

async function enrichShopPreviewsForSubTab(cache: NonNullable<typeof shopCache>, subTab: number) {
    const type = subTab === DecorationSubTabs.Banner ? 1 : subTab === DecorationSubTabs.Nameplate ? 2 : 0;
    return enrichShopPreviews(cache, type);
}

function preloadDecorationUrls(urls: string[], limit = SHOP_PRELOAD_LIMIT) {
    let count = 0;
    for (const url of urls) {
        if (!url || preloadedDecorationUrls.has(url)) continue;
        if (count++ >= limit) break;

        const img = new Image();
        img.decoding = "async";
        if ("fetchPriority" in img) {
            (img as HTMLImageElement & { fetchPriority?: string; }).fetchPriority = count <= 8 ? "high" : "low";
        }
        img.onload = () => preloadedDecorationUrls.add(url);
        img.onerror = () => preloadedDecorationUrls.add(url);
        img.src = url;
    }
}

function filterShopCatalog<T extends { name: string; label?: string; }>(items: T[], query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.label?.toLowerCase().includes(q) ?? false)
    );
}

function decorationSubTabItemType(subTab: number) {
    if (subTab === DecorationSubTabs.Banner) return "PROFILE_EFFECT" as const;
    if (subTab === DecorationSubTabs.Nameplate) return "NAMEPLATE" as const;
    return "AVATAR_DECORATION" as const;
}

function dedupeShopAvatar(items: ShopAvatarDeco[]) {
    const seen = new Set<string>();
    return items.filter(i => {
        if (seen.has(i.skuId)) return false;
        seen.add(i.skuId);
        return true;
    });
}

function dedupeShopBanner(items: ShopProfileEffect[]) {
    const seen = new Set<string>();
    return items.filter(i => {
        if (seen.has(i.skuId)) return false;
        seen.add(i.skuId);
        return true;
    });
}

function dedupeShopNameplate(items: ShopNameplate[]) {
    const seen = new Set<string>();
    return items.filter(i => {
        if (seen.has(i.skuId)) return false;
        seen.add(i.skuId);
        return true;
    });
}

function getBrowseDecorationItems<T extends { skuId: string; }>(
    items: T[],
    selectedSkuId: string | null,
    limit: number,
) {
    const base = items.slice(0, limit);
    if (!selectedSkuId || base.some(i => i.skuId === selectedSkuId)) return base;
    const equipped = items.find(i => i.skuId === selectedSkuId);
    if (!equipped) return base;
    return [equipped, ...base.slice(0, limit - 1)];
}

function resolveCollectibleItemType(
    item: Record<string, unknown>,
    product: { type?: number; },
): number | undefined {
    if (typeof item.type === "number") return item.type;
    if (typeof product.type === "number" && product.type !== COLLECTIBLE_TYPE_BUNDLE) return product.type;
    if (Array.isArray(item.effects) || item.thumbnailPreviewSrc || item.staticFrameSrc || item.reducedMotionSrc) {
        return 1;
    }
    if (typeof item.asset === "string" && typeof item.palette === "string") return 2;
    if (typeof item.asset === "string") return 0;
    return undefined;
}

function collectShopItemsFromProduct(
    product: {
        sku_id?: string;
        name?: string;
        type?: number;
        items?: Array<Record<string, unknown>>;
        variants?: Array<Record<string, unknown>>;
    },
    avatar: ShopAvatarDeco[],
    banner: ShopProfileEffect[],
    nameplate: ShopNameplate[],
) {
    const visit = (p: typeof product) => {
        if (p.type === COLLECTIBLE_TYPE_BUNDLE) return;

        const items = p.items?.length
            ? p.items
            : (typeof p.type === "number" ? [p as unknown as Record<string, unknown>] : []);

        for (const item of items) {
            if (item.type === COLLECTIBLE_TYPE_BUNDLE) continue;

            const skuId = String(p.sku_id ?? item.sku_id ?? "");
            if (!skuId) continue;

            const assets = item.assets as { static_image_url?: string; animated_image_url?: string; } | undefined;
            const resolvedType = resolveCollectibleItemType(item, p);

            if (resolvedType === 0 && typeof item.asset === "string") {
                const label = String(item.label ?? p.name ?? "Avatar decoration");
                const name = String(p.name ?? item.label ?? "Avatar decoration");
                avatar.push({
                    skuId,
                    asset: item.asset,
                    label,
                    name,
                    previewUrl: resolveShopPreviewUrl(skuId, 0, item, assets),
                });
            }

            if (resolvedType === 1) {
                const name = String(item.title ?? p.name ?? "Profile effect");
                const previewUrl = absolutizeCollectibleUrl(String(
                    item.thumbnailPreviewSrc
                    ?? item.staticFrameSrc
                    ?? item.reducedMotionSrc
                    ?? resolveShopPreviewUrl(skuId, 1, item, assets)
                ));
                banner.push({
                    skuId,
                    name,
                    previewUrl,
                    effect: {
                        skuId,
                        id: typeof item.id === "string" ? item.id : skuId,
                        title: typeof item.title === "string" ? item.title : name,
                        description: typeof item.description === "string" ? item.description : undefined,
                        accessibilityLabel: typeof item.accessibilityLabel === "string"
                            ? item.accessibilityLabel
                            : undefined,
                        animationType: typeof item.animationType === "number" ? item.animationType : undefined,
                        thumbnailPreviewSrc: typeof item.thumbnailPreviewSrc === "string"
                            ? absolutizeCollectibleUrl(item.thumbnailPreviewSrc)
                            : undefined,
                        reducedMotionSrc: typeof item.reducedMotionSrc === "string"
                            ? absolutizeCollectibleUrl(item.reducedMotionSrc)
                            : undefined,
                        staticFrameSrc: typeof item.staticFrameSrc === "string"
                            ? absolutizeCollectibleUrl(item.staticFrameSrc)
                            : undefined,
                        effects: Array.isArray(item.effects) ? item.effects : undefined,
                        type: 1,
                    },
                });
            }

            if (resolvedType === 2 && typeof item.asset === "string") {
                const label = String(item.label ?? p.name ?? "Nameplate");
                const name = String(p.name ?? item.label ?? "Nameplate");
                nameplate.push({
                    skuId,
                    asset: item.asset,
                    label,
                    name,
                    previewUrl: resolveShopPreviewUrl(skuId, 2, item, assets),
                    palette: typeof item.palette === "string" ? item.palette : undefined,
                });
            }
        }

        for (const variant of p.variants ?? []) visit(variant);
    };

    visit(product);
}

async function fetchShopDecorations(force = false) {
    // Bust stale caches that were built before banner type parsing was fixed
    if (!force && shopCache
        && shopCache.version === SHOP_CACHE_VERSION
        && Date.now() - shopCache.fetchedAt < SHOP_CACHE_MS
        && (shopCache.banner.length > 0 || shopCache.avatar.length === 0)) {
        return shopCache;
    }

    const avatar: ShopAvatarDeco[] = [];
    const banner: ShopProfileEffect[] = [];
    const nameplate: ShopNameplate[] = [];

    try {
        const { body } = await RestAPI.get({
            url: "/collectibles-categories/v2",
            query: { variants_return_style: 1 },
        });

        for (const category of body.categories ?? []) {
            for (const product of category.products ?? []) {
                collectShopItemsFromProduct(product, avatar, banner, nameplate);
            }
        }
    } catch (e) {
        console.warn("larp: collectibles-categories fetch failed", e);
    }

    if (!avatar.length && !banner.length && !nameplate.length) {
        try {
            const { body } = await RestAPI.get({
                url: "/collectibles-shop",
                query: { variants_return_style: 1 },
            });

            for (const category of body.categories ?? []) {
                for (const product of category.products ?? []) {
                    collectShopItemsFromProduct(product, avatar, banner, nameplate);
                }
            }
        } catch (e) {
            console.warn("larp: collectibles-shop fetch failed", e);
        }
    }

    shopCache = {
        avatar: dedupeShopAvatar(avatar),
        banner: dedupeShopBanner(banner),
        nameplate: dedupeShopNameplate(nameplate),
        fetchedAt: Date.now(),
        version: SHOP_CACHE_VERSION,
    };
    shopEnrichedTabs.clear();
    return shopCache;
}

async function ensureShopPreviewsForSubTab(subTab: number) {
    if (!shopCache) return null;
    if (!shopEnrichedTabs.has(subTab)) {
        await enrichShopPreviewsForSubTab(shopCache, subTab);
        shopEnrichedTabs.add(subTab);
    }
    const list = subTab === DecorationSubTabs.Banner
        ? shopCache.banner
        : subTab === DecorationSubTabs.Nameplate
            ? shopCache.nameplate
            : shopCache.avatar;
    preloadDecorationUrls(list.slice(0, DECORATION_BROWSE_LIMIT).map(i => i.previewUrl));
    return shopCache;
}

async function fetchShopProduct(skuId: string, force = false) {
    const cached = shopProductCache.get(skuId);
    if (!force && cached && (cached as Record<string, unknown>).__larpHydrated === true) {
        return cached;
    }

    const inflight = shopProductInflight.get(skuId);
    if (!force && inflight) return inflight;

    const request = (async () => {
        const { body } = await RestAPI.get({
            url: `/collectibles-products/${skuId}`,
            query: { variants_return_style: 1 },
        });
        const product = (body?.sku_id ? body : body?.product ?? body) as {
            sku_id?: string;
            name?: string;
            type?: number;
            items?: Array<Record<string, unknown>>;
            variants?: Array<Record<string, unknown>>;
        };
        if (product?.sku_id) registerFullCollectibleProduct(product as Record<string, unknown>);
        return shopProductCache.get(skuId) ?? product;
    })();

    shopProductInflight.set(skuId, request);
    try {
        return await request;
    } finally {
        shopProductInflight.delete(skuId);
    }
}

async function searchShopDecorations(
    query: string,
    itemType: "AVATAR_DECORATION" | "PROFILE_EFFECT" | "NAMEPLATE",
) {
    const { body } = await RestAPI.get({
        url: "/shop/search",
        query: {
            search: query,
            item_types: [itemType],
            limit: 100,
        },
    });

    const avatar: ShopAvatarDeco[] = [];
    const banner: ShopProfileEffect[] = [];
    const nameplate: ShopNameplate[] = [];
    const skuIds: string[] = body.skus ?? [];

    for (let i = 0; i < skuIds.length; i += SHOP_PRODUCT_BATCH_SIZE) {
        const batch = skuIds.slice(i, i + SHOP_PRODUCT_BATCH_SIZE);
        await Promise.all(batch.map(async skuId => {
            try {
                const product = await fetchShopProduct(skuId);
                if (product?.type === COLLECTIBLE_TYPE_BUNDLE) return;
                collectShopItemsFromProduct(product, avatar, banner, nameplate);
            } catch { }
        }));
    }

    if (itemType === "AVATAR_DECORATION") return dedupeShopAvatar(avatar);
    if (itemType === "PROFILE_EFFECT") return dedupeShopBanner(banner);
    return dedupeShopNameplate(nameplate);
}

function getRealAvatarDecoration(): { skuId: string; asset: string; label?: string; previewUrl?: string; } | null {
    const user = origGetCurrentUser?.();
    const deco = (user as { avatarDecorationData?: { skuId?: string; asset?: string; }; avatarDecoration?: { skuId?: string; asset?: string; }; } | null | undefined)
        ?.avatarDecorationData
        ?? (user as { avatarDecoration?: { skuId?: string; asset?: string; }; } | null | undefined)?.avatarDecoration;
    if (!deco?.skuId || !deco.asset) return null;
    return {
        skuId: String(deco.skuId),
        asset: String(deco.asset),
        previewUrl: resolveAvatarDecorationPreviewUrl(String(deco.skuId), String(deco.asset)),
    };
}

function getRealNameplate(): LarpNameplateSetting | null {
    const user = origGetCurrentUser?.();
    const plate = (user as { nameplate?: { skuId?: string; asset?: string; label?: string; palette?: string; }; } | null | undefined)?.nameplate
        ?? getRealUserCollectiblesNameplate();
    if (!plate?.skuId || !plate.asset) return null;
    return {
        skuId: String(plate.skuId),
        asset: String(plate.asset),
        label: typeof plate.label === "string" ? plate.label : undefined,
        palette: typeof plate.palette === "string" ? plate.palette : undefined,
        previewUrl: resolveNameplatePreviewUrl(String(plate.asset)),
    };
}

function getRealProfileEffect(): LarpProfileEffectSetting | null {
    const userId = getCurrentUserId();
    if (!userId) return null;
    const profile = origGetUserProfile?.(userId);
    const effect = (profile as { profileEffect?: LarpProfileEffectSetting | null; } | null | undefined)?.profileEffect;
    if (!effect) return null;
    const skuId = (effect as { skuId?: string; id?: string; }).skuId
        ?? (effect as { id?: string; }).id;
    if (!skuId) return null;
    return {
        ...effect,
        skuId: String(skuId),
        id: (effect as { id?: string; }).id ?? String(skuId),
        title: (effect as { title?: string; }).title ?? "Profile effect",
    };
}

function isAvatarDecorationHidden() {
    return !!settings.store.hiddenAvatarDecoration;
}

function isProfileEffectHidden() {
    return !!settings.store.hiddenProfileEffect;
}

function isNameplateHidden() {
    return !!settings.store.hiddenNameplate;
}

function setAvatarDecorationHidden(hidden: boolean) {
    settings.store.hiddenAvatarDecoration = hidden;
    if (hidden) settings.store.larpAvatarDecoration = null;
    userProxyGeneration++;
    triggerProfileRefresh();
}

function setProfileEffectHidden(hidden: boolean) {
    settings.store.hiddenProfileEffect = hidden;
    if (hidden) {
        settings.store.larpProfileEffect = null;
        larpProfileEffectReady = true;
    }
    triggerProfileRefresh();
}

function setNameplateHidden(hidden: boolean) {
    settings.store.hiddenNameplate = hidden;
    if (hidden) {
        settings.store.larpNameplate = null;
        larpNameplateReady = true;
    }
    userProxyGeneration++;
    triggerProfileRefresh();
}

function getLarpAvatarDecoration() {
    if (!settings.store.enabled || isAvatarDecorationHidden()) return null;
    const deco = settings.store.larpAvatarDecoration;
    if (!deco?.skuId || !deco.asset) return null;
    return { asset: deco.asset, skuId: deco.skuId, expires_at: null };
}

function getLarpProfileEffect() {
    if (!settings.store.enabled || isProfileEffectHidden()) return null;
    if (!canSpoofLarpProfileEffect()) return null;

    const configured = settings.store.larpProfileEffect;
    if (!configured?.skuId) return null;

    const product = larpCollectibleProducts.get(configured.skuId);
    const item = getProfileEffectItemFromProduct(product);
    if (item && (isProfileEffectInstance(item) || (Array.isArray((item as { effects?: unknown[]; }).effects) && (item as { effects: unknown[]; }).effects.length > 0))) {
        return item as LarpProfileEffectSetting;
    }

    if (Array.isArray(configured.effects) && configured.effects.length > 0) {
        const parsed = parseProfileEffectItem(configured as Record<string, unknown>, configured.skuId);
        if (parsed) return parsed as LarpProfileEffectSetting;
        return {
            ...configured,
            skuId: configured.skuId,
            id: configured.id ?? configured.skuId,
        };
    }

    return null;
}

function getLarpProfileEffectItemBySkuId(skuId: string | null | undefined) {
    if (!skuId || !settings.store.enabled) return undefined;
    if (!canSpoofLarpProfileEffect()) return undefined;

    const configured = settings.store.larpProfileEffect;
    if (!configured?.skuId || configured.skuId !== String(skuId)) return undefined;

    const product = larpCollectibleProducts.get(String(skuId));
    const item = getProfileEffectItemFromProduct(product);
    if (item && isProfileEffectInstance(item)) return item;

    const raw = item
        ? (plainStoreObject(item) ?? item as Record<string, unknown>)
        : (Array.isArray(configured.effects) && configured.effects.length > 0
            ? (configured as Record<string, unknown>)
            : null);
    if (!raw) return undefined;
    return parseProfileEffectItem(raw, String(skuId)) ?? undefined;
}

function canSpoofLarpProfileEffect() {
    const effect = settings.store.larpProfileEffect;
    if (!effect?.skuId) return false;
    return isReadyLarpProfileEffectProduct(larpCollectibleProducts.get(effect.skuId))
        || (Array.isArray(effect.effects) && effect.effects.length > 0);
}

function hasLarpProfileEffectConfigured() {
    return !!settings.store.larpProfileEffect?.skuId;
}

function isLarpOwnedAvatarDecoration(deco: { skuId?: string; } | null | undefined) {
    const larp = settings.store.larpAvatarDecoration;
    return !!larp?.skuId && deco?.skuId === larp.skuId;
}

function isLarpOwnedProfileEffect(effect: { skuId?: string; id?: string; } | null | undefined) {
    const larp = settings.store.larpProfileEffect;
    if (!larp?.skuId || !effect) return false;
    return effect.skuId === larp.skuId || effect.id === larp.id || effect.id === larp.skuId;
}

function equipAvatarDecoration(item: ShopAvatarDeco | null) {
    settings.store.hiddenAvatarDecoration = false;
    settings.store.larpAvatarDecoration = item
        ? { skuId: item.skuId, asset: item.asset, label: item.label, previewUrl: item.previewUrl }
        : null;
    if (item) {
        registerLarpCollectibleProduct(item.skuId, item.name, 0, {
            asset: item.asset,
            label: item.label,
            sku_id: item.skuId,
            type: 0,
        });
    }
    userProxyGeneration++;
    triggerProfileRefresh();
}

function equipProfileEffect(item: ShopProfileEffect | null) {
    settings.store.hiddenProfileEffect = false;
    if (!item) {
        settings.store.larpProfileEffect = null;
        larpProfileEffectReady = true;
        triggerProfileRefresh(50);
        return;
    }

    const applyEffect = (effect: LarpProfileEffectSetting, name: string) => {
        settings.store.larpProfileEffect = {
            ...effect,
            skuId: item.skuId,
            id: effect.id ?? item.skuId,
            title: effect.title ?? name,
            type: 1,
        };
        const registered = registerParsedProfileEffectProduct(
            item.skuId,
            name,
            settings.store.larpProfileEffect as Record<string, unknown>,
        );
        larpProfileEffectReady = registered || canSpoofLarpProfileEffect();
        triggerProfileRefresh(50);
        return larpProfileEffectReady;
    };

    applyEffect({
        ...item.effect,
        thumbnailPreviewSrc: item.effect.thumbnailPreviewSrc ?? item.previewUrl,
    }, item.name);

    void (async () => {
        try {
            const hasEffects = Array.isArray(item.effect.effects) && item.effect.effects.length > 0;
            if (hasEffects && canSpoofLarpProfileEffect()) return;

            const product = await fetchShopProduct(item.skuId, true);
            if (product?.sku_id) registerFullCollectibleProduct(product as Record<string, unknown>);

            const avatar: ShopAvatarDeco[] = [];
            const banner: ShopProfileEffect[] = [];
            const nameplate: ShopNameplate[] = [];
            collectShopItemsFromProduct(product as Parameters<typeof collectShopItemsFromProduct>[0], avatar, banner, nameplate);
            const match = banner.find(b => b.skuId === item.skuId);
            const productItem = getProfileEffectItemFromProduct(larpCollectibleProducts.get(item.skuId));
            const hydrated = match?.effect
                ?? (productItem
                    ? (plainStoreObject(productItem) as LarpProfileEffectSetting | null)
                    : null)
                ?? item.effect;

            const ready = applyEffect({
                ...hydrated,
                effects: (hydrated as LarpProfileEffectSetting).effects?.length
                    ? (hydrated as LarpProfileEffectSetting).effects
                    : item.effect.effects,
            }, item.name);

            if (!ready) {
                showToast("Banner effect still loading — click it again in a second", Toasts.Type.SUCCESS);
            }
        } catch (e) {
            console.warn("larp: equip profile effect failed", e);
            showToast("Couldn't load that banner effect", Toasts.Type.FAILURE);
        }
    })();
}

function canSpoofLarpNameplate(plate: LarpNameplateSetting | null) {
    if (!plate?.skuId || !plate.asset || !larpNameplateReady) return false;
    return true;
}

function getLarpNameplate() {
    if (!settings.store.enabled || isNameplateHidden()) return null;
    const plate = settings.store.larpNameplate;
    if (!plate?.skuId || !plate.asset) return null;
    return plate;
}

function getLarpNameplateProduct(skuId: string | null | undefined) {
    if (!skuId) return null;
    const product = getLarpProductForStore(String(skuId));
    if (!product?.name) return null;
    return product;
}

function isLarpOwnedNameplate(plate: { skuId?: string; } | null | undefined) {
    const larp = settings.store.larpNameplate;
    return !!larp?.skuId && plate?.skuId === larp.skuId;
}

function equipNameplate(item: ShopNameplate | null) {
    settings.store.hiddenNameplate = false;
    settings.store.larpNameplate = item
        ? {
            skuId: item.skuId,
            asset: item.asset,
            label: item.label,
            palette: normalizeNameplatePalette(item.palette),
            previewUrl: item.previewUrl,
        }
        : null;

    if (!item) {
        larpNameplateReady = true;
        userProxyGeneration++;
        triggerProfileRefresh();
        return;
    }

    larpNameplateReady = true;
    userProxyGeneration++;
    triggerProfileRefresh();

    registerLarpCollectibleProduct(item.skuId, item.name, 2, {
        asset: item.asset,
        label: item.label,
        palette: normalizeNameplatePalette(item.palette),
        sku_id: item.skuId,
        type: 2,
    });

    void fetchShopProduct(item.skuId, true).then(product => {
        if (product?.sku_id) registerFullCollectibleProduct(product as Record<string, unknown>);
        userProxyGeneration++;
        triggerProfileRefresh();
    });
}

function getRawUserProfile(userId: string) {
    return origGetUserProfile?.(userId) ?? UserProfileStore.getUserProfile(userId);
}

function badgeAlreadyPresent(
    badges: Array<{ id?: string; key?: string; icon?: string; iconSrc?: string; }>,
    id: string,
) {
    for (const badge of badges) {
        const key = getBadgeKey(badge);
        if (!key) continue;
        if (key === id) return true;

        for (const group of BADGE_ALIAS_GROUPS) {
            if (group.includes(id) && group.includes(key)) return true;
        }

        const targetHash = DISCORD_ICON_HASHES[id];
        if (targetHash && getBadgeIconHash(badge) === targetHash) return true;
    }
    return false;
}

function buildNativeProfileBadge(id: string) {
    const known = KNOWN_BADGES[id];
    const hash = DISCORD_ICON_HASHES[id];
    const badge: {
        id: string;
        key: string;
        description: string;
        icon?: string;
        iconSrc?: string;
        link?: string;
    } = {
        id,
        key: id,
        description: known?.description ?? id.replace(/_/g, " "),
        link: known?.link,
    };

    if (hash) {
        badge.icon = hash;
    }

    const iconSrc = resolveBadgeIcon(id, known?.icon);
    if (iconSrc) badge.iconSrc = iconSrc;

    return badge;
}

function buildDisplayBadge(id: string, profile: { userId?: string; }) {
    const known = KNOWN_BADGES[id];
    const hash = DISCORD_ICON_HASHES[id];
    const iconSrc = buildBadgeImageCandidates(id, known?.icon)[0];

    if (!iconSrc) return null;

    return {
        id,
        userId: profile.userId,
        key: id,
        description: known?.description ?? id.replace(/_/g, " "),
        iconSrc,
        icon: hash,
        link: known?.link,
    };
}

function badgeAssetUrls(relativePath: string) {
    const urls = [
        `${BADGE_ASSETS_BASE}/${relativePath}`,
        `${BADGE_ASSETS_FALLBACK}/${relativePath}`,
    ];
    if (relativePath.endsWith(".png")) {
        const webp = relativePath.replace(/\.png$/i, ".webp");
        urls.push(`${BADGE_ASSETS_BASE}/${webp}`, `${BADGE_ASSETS_FALLBACK}/${webp}`);
    }
    return urls;
}

function badgeIconUrl(icon: string) {
    if (!icon) return "";
    if (icon.startsWith("http")) return icon;
    if (icon.includes("/") || /\.(svg|png|webp)$/i.test(icon)) {
        return badgeAssetUrls(icon)[0];
    }
    return `https://cdn.discordapp.com/badge-icons/${icon}.png?size=96`;
}

function buildBadgeImageCandidates(id: string, fallbackIcon?: string) {
    const urls: string[] = [];
    const catalogId = canonicalBadgeId(id);

    const pushMapped = (mapped?: string) => {
        if (mapped) urls.push(...badgeAssetUrls(mapped));
    };

    const hash = DISCORD_ICON_HASHES[id] ?? DISCORD_ICON_HASHES[catalogId];
    if (hash) urls.push(`https://cdn.discordapp.com/badge-icons/${hash}.png?size=96`);

    pushMapped(BADGE_ICON_MAP[id] ?? BADGE_ICON_MAP[catalogId]);

    const boost = catalogId.match(/^guild_booster_lvl(\d+)$/);
    if (boost) pushMapped(`boosts/discord-boost-${boost[1]}.svg`);

    const nitro = catalogId.match(/^premium_(bronze|silver|gold|platinum|diamond|emerald|ruby|opal)$/);
    if (nitro) pushMapped(`subscriptions/badges/${nitro[1]}.png`);

    const gifting = catalogId.match(/^gifting_(patron|champion|luminary|icon|hero|legend)$/);
    if (gifting) pushMapped(`gifting/${gifting[1]}.png`);

    if (catalogId === "premium" || catalogId.startsWith("premium_tenure")) {
        pushMapped("subscriptions/badges/bronze.png");
    }

    if (catalogId.includes("quest")) pushMapped("quest.png");

    pushMapped(KNOWN_BADGES[catalogId]?.icon ?? KNOWN_BADGES[id]?.icon);

    if (fallbackIcon) {
        if (fallbackIcon.startsWith("http")) {
            urls.push(fallbackIcon);
        } else if (fallbackIcon.includes("/") || /\.(svg|png|webp)$/i.test(fallbackIcon)) {
            urls.push(...badgeAssetUrls(fallbackIcon));
        } else {
            urls.push(`https://cdn.discordapp.com/badge-icons/${fallbackIcon}.png?size=96`);
        }
    }

    return [...new Set(urls.filter(Boolean))];
}

function resolveBadgeIcon(id: string, fallbackIcon?: string) {
    return buildBadgeImageCandidates(id, fallbackIcon)[0] ?? "";
}

function BadgeIcon({ id, icon, size = 24 }: { id: string; icon?: string; size?: number; }) {
    const candidates = useMemo(() => buildBadgeImageCandidates(id, icon), [id, icon]);
    const [candidateIndex, setCandidateIndex] = useState(0);
    const src = candidates[candidateIndex] ?? "";

    useEffect(() => {
        setCandidateIndex(0);
    }, [id, icon]);

    if (!src) {
        return (
            <div style={{
                width: size,
                height: size,
                borderRadius: 4,
                background: "var(--background-tertiary)",
            }} />
        );
    }

    return (
        <img
            src={src}
            alt=""
            width={size}
            height={size}
            onError={() => {
                if (candidateIndex + 1 < candidates.length) {
                    setCandidateIndex(candidateIndex + 1);
                }
            }}
        />
    );
}

function isVencordBadge(id: string) {
    return id.startsWith("vencord_") || id.startsWith("vc-") || id.startsWith("vc-custom-");
}

function getBadgeExclusiveGroup(id: string): string | null {
    if (id.startsWith("guild_booster_lvl")) return "boost";
    if (id.startsWith("hypesquad")) return "hypesquad";
    return null;
}

function getActiveExclusiveBadge(group: string) {
    for (const id of settings.store.addedBadges) {
        if (getBadgeExclusiveGroup(id) === group) return id;
    }

    for (const id of getNativeBadgeIds()) {
        if (getBadgeExclusiveGroup(id) === group && isOwnedBadgeVisible(id)) return id;
    }

    return null;
}

function isBadgeExclusiveBlocked(id: string) {
    const group = getBadgeExclusiveGroup(id);
    if (!group) return false;

    const active = getActiveExclusiveBadge(group);
    return !!active && active !== id;
}

const BADGE_ALIAS_GROUPS = [ // discord loves duplicate ids for the same badge
    ["quest", "quest_completed"],
    ["staff", "discord_employee"],
    ["premium", "premium_bronze", "premium_subscriber"],
    ["early_supporter", "premium_early_supporter"],
    ["hypesquad_house_1", "hypesquad_online_house_1"],
    ["hypesquad_house_2", "hypesquad_online_house_2"],
    ["hypesquad_house_3", "hypesquad_online_house_3"],
    ["verified_developer", "verified_bot_developer"],
    ["bug_hunter_level_1", "bug_hunter"],
    ["bug_hunter_level_2", "bug_hunter_gold"],
];

function canonicalBadgeId(id: string) {
    for (const group of BADGE_ALIAS_GROUPS) {
        if (!group.includes(id)) continue;
        return group.find(member => KNOWN_BADGES[member]) ?? group[0];
    }

    for (const [flag, badgeId] of Object.entries(FLAG_BADGE_IDS)) {
        if (id === flag) return badgeId;
    }

    return id;
}

function badgeIdsEquivalent(a: string, b: string) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (canonicalBadgeId(a) === canonicalBadgeId(b)) return true;

    for (const group of BADGE_ALIAS_GROUPS) {
        if (group.includes(a) && group.includes(b)) return true;
    }

    for (const [flag, badgeId] of Object.entries(FLAG_BADGE_IDS)) {
        if ((a === flag || a === badgeId) && (b === flag || b === badgeId)) return true;
    }

    const iconA = BADGE_ICON_MAP[a] ?? KNOWN_BADGES[a]?.icon;
    const iconB = BADGE_ICON_MAP[b] ?? KNOWN_BADGES[b]?.icon;
    if (iconA && iconB && iconA === iconB) return true;

    const hashA = DISCORD_ICON_HASHES[a];
    const hashB = DISCORD_ICON_HASHES[b];
    return !!hashA && !!hashB && hashA === hashB;
}

function isBadgeIdOwned(id: string, ownedIds: Set<string>) {
    if (ownedIds.has(id)) return true;
    for (const owned of ownedIds) {
        if (badgeIdsEquivalent(id, owned)) return true;
    }
    return false;
}

function getBadgeKey(badge: { id?: string; key?: string; }) {
    return badge.id ?? badge.key ?? "";
}

function getBadgeIconHash(badge: { icon?: string; iconSrc?: string; }) {
    if (badge.icon && !badge.icon.includes("/") && !badge.icon.includes(".")) return badge.icon;

    const src = badge.iconSrc ?? (badge.icon?.startsWith("http") ? badge.icon : null);
    if (!src) return null;

    return src.match(/badge-icons\/([a-f0-9]+)/i)?.[1]
        ?? src.match(/\/([a-f0-9]{32})\./i)?.[1]
        ?? null;
}

function hideKey(kind: "icon" | "url", val: string) {
    return kind === "icon" ? `icon:${val}` : `url:${val}`;
}

function getBadgeImageUrls(badge: { icon?: string; iconSrc?: string; }) {
    const urls = new Set<string>();
    if (badge.iconSrc) urls.add(badge.iconSrc);

    const hash = getBadgeIconHash(badge);
    if (hash) {
        urls.add(`https://cdn.discordapp.com/badge-icons/${hash}.png`);
        urls.add(`https://cdn.discordapp.com/badge-icons/${hash}.webp`);
    }

    return [...urls];
}

function expandBadgeHideIds(id: string): string[] {
    const result = new Set<string>([id]);

    for (const group of BADGE_ALIAS_GROUPS) {
        if (group.includes(id)) group.forEach(alias => result.add(alias));
    }

    const userId = getCurrentUserId();
    if (!userId) return [...result];

    const idIcon = BADGE_ICON_MAP[id] ?? KNOWN_BADGES[id]?.icon;

    for (const badge of getRawUserProfile(userId)?.badges ?? []) {
        const bid = getBadgeKey(badge);
        if (!bid) continue;

        if (idIcon && (BADGE_ICON_MAP[bid] ?? KNOWN_BADGES[bid]?.icon) === idIcon) result.add(bid);
        if (id.includes("quest") && bid.includes("quest")) result.add(bid);
        if (id.startsWith("premium") && bid.startsWith("premium")) result.add(bid);
        if (id.startsWith("guild_booster") && bid.startsWith("guild_booster")) result.add(bid);

        const hash = getBadgeIconHash(badge);
        const idHash = DISCORD_ICON_HASHES[id];
        if (hash && idHash && hash === idHash) result.add(bid);
    }

    for (const alias of [...result]) {
        const hash = DISCORD_ICON_HASHES[alias];
        if (hash) result.add(hideKey("icon", hash));
    }

    return [...result];
}

function getHiddenBadgeSet() {
    const key = settings.store.hiddenBadges.join("\0");
    if (hiddenBadgeSetCache && key === hiddenBadgeSetCacheKey) return hiddenBadgeSetCache;

    hiddenBadgeSetCacheKey = key;
    hiddenBadgeSetCache = new Set<string>();
    for (const id of settings.store.hiddenBadges) {
        for (const expanded of expandBadgeHideIds(id)) hiddenBadgeSetCache.add(expanded);
    }
    return hiddenBadgeSetCache;
}

function invalidateHiddenBadgeCache() {
    hiddenBadgeSetCache = null;
}

function isBadgeHiddenKey(key: string) {
    const hidden = getHiddenBadgeSet();
    if (hidden.has(key)) return true;

    if (key.startsWith("icon:")) return hidden.has(key);

    const keyHash = DISCORD_ICON_HASHES[key];
    if (keyHash && hidden.has(hideKey("icon", keyHash))) return true;

    const keyIcon = BADGE_ICON_MAP[key] ?? KNOWN_BADGES[key]?.icon;
    if (keyIcon) {
        for (const hid of hidden) {
            const hidIcon = BADGE_ICON_MAP[hid] ?? KNOWN_BADGES[hid]?.icon;
            if (hidIcon === keyIcon) return true;
        }
    }

    if (key.includes("quest") && [...hidden].some(h => h.includes("quest"))) return true;
    if (key.startsWith("premium") && [...hidden].some(h => h.startsWith("premium"))) return true;
    if (key.startsWith("guild_booster") && [...hidden].some(h => h.startsWith("guild_booster"))) return true;

    return false;
}

function isBadgeHiddenObject(badge: { id?: string; key?: string; icon?: string; iconSrc?: string; }) {
    const key = getBadgeKey(badge);
    if (key && isBadgeHiddenKey(key)) return true;

    const hash = getBadgeIconHash(badge);
    if (hash && getHiddenBadgeSet().has(hideKey("icon", hash))) return true;

    if (hash) {
        for (const hid of settings.store.hiddenBadges) {
            const knownHash = DISCORD_ICON_HASHES[hid];
            if (knownHash === hash) return true;
        }
    }

    return false;
}

function getLiveNativeBadges() {
    const userId = getCurrentUserId();
    if (!userId) return [] as Array<{ id?: string; key?: string; icon?: string; iconSrc?: string; }>;

    try {
        const profile = DisplayProfileUtils.getDisplayProfile(userId);
        if (profile) {
            if (unfilteredGetBadges) return unfilteredGetBadges.call(profile);
            return profile.getBadges?.() ?? [];
        }
    } catch { }

    return getRawUserProfile(userId)?.badges ?? [];
}

function getUnfilteredOwnedBadges() {
    const userId = getCurrentUserId();
    if (!userId) return [] as Array<{ id?: string; key?: string; description?: string; icon?: string; iconSrc?: string; link?: string; }>;

    if (unfilteredGetBadges) {
        try {
            const profile = DisplayProfileUtils.getDisplayProfile(userId);
            if (profile) return unfilteredGetBadges.call(profile);
        } catch { }
    }

    return origGetUserProfile?.(userId)?.badges ?? getRawUserProfile(userId)?.badges ?? [];
}

function captureHiddenIdentifiers(id: string) {
    const ids = new Set(expandBadgeHideIds(id));
    const userId = getCurrentUserId();

    for (const alias of ids) {
        const hash = DISCORD_ICON_HASHES[alias];
        if (hash) ids.add(hideKey("icon", hash));
    }

    if (!userId) return [...ids];

    for (const badge of getRawUserProfile(userId)?.badges ?? []) {
        const bid = getBadgeKey(badge);
        if (!bid) continue;
        if ([...ids].some(hid => expandBadgeHideIds(hid).includes(bid))) {
            ids.add(bid);
            const hash = getBadgeIconHash(badge);
            if (hash) ids.add(hideKey("icon", hash));
            for (const url of getBadgeImageUrls(badge)) ids.add(hideKey("url", url));
        }
    }

    for (const badge of getLiveNativeBadges()) {
        const bid = getBadgeKey(badge);
        if (!bid) continue;
        if ([...ids].some(hid => expandBadgeHideIds(hid).includes(bid))) {
            ids.add(bid);
            const hash = getBadgeIconHash(badge);
            if (hash) ids.add(hideKey("icon", hash));
            for (const url of getBadgeImageUrls(badge)) ids.add(hideKey("url", url));
        }
    }

    return [...ids];
}

function updateHiddenBadgeStyles() {
    let style = document.getElementById(HIDDEN_BADGE_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement("style");
        style.id = HIDDEN_BADGE_STYLE_ID;
        document.head.appendChild(style);
    }

    if (!settings.store.enabled || !settings.store.hiddenBadges.length) {
        style.textContent = "";
        syncProfileDomObserver(false);
        return;
    }

    syncProfileDomObserver(true);

    const userId = getCurrentUserId();
    if (!userId) {
        style.textContent = "";
        return;
    }

    const selectors = new Set<string>();

    for (const entry of settings.store.hiddenBadges) {
        if (entry.startsWith("icon:")) {
            const hash = entry.slice(5);
            selectors.add(`img[src*="badge-icons/${hash}"]`);
            continue;
        }

        if (entry.startsWith("url:")) {
            const url = entry.slice(4);
            selectors.add(`img[src="${url}"]`);
            const tail = url.split("/").pop();
            if (tail) selectors.add(`img[src*="${tail}"]`);
            continue;
        }

        const hash = DISCORD_ICON_HASHES[entry];
        if (hash) selectors.add(`img[src*="badge-icons/${hash}"]`);

        const asset = BADGE_ICON_MAP[entry] ?? KNOWN_BADGES[entry]?.icon;
        if (asset) selectors.add(`img[src*="${asset.split("/").pop()}"]`);
    }

    // Only hide inside profiles we explicitly marked as the current user.
    // Do not use bare [data-user-id] — that can appear outside own-profile contexts.
    const scope = `[data-larp-user="${userId}"]`;
    style.textContent = [...selectors]
        .map(sel => `${scope} ${sel} { display: none !important; }`)
        .join("\n");
}

function wrapDisplayProfile<T extends { userId: string; getBadges(): unknown[]; }>(profile: T | null): T | null {
    if (!profile?.userId || profile.userId !== getCurrentUserId() || !settings.store.enabled) return profile;

    const cached = displayProfileProxyCache.get(profile);
    if (cached) return cached as T;

    const userId = profile.userId;
    const origGetBadges = profile.getBadges.bind(profile);

    const proxy = new Proxy(profile, {
        get(target, prop, receiver) {
            if (prop === "getBadges") {
                return () => mergeLarpDisplayBadges({ userId }, origGetBadges() as Array<{
                    id?: string;
                    key?: string;
                    icon?: string;
                    iconSrc?: string;
                }>);
            }
            if (prop === "profileEffect") {
                if (isProfileEffectHidden()) return null;
                if (canSpoofLarpProfileEffect()) {
                    return getLarpProfileEffect();
                }
            }
            if (prop === "profileEffectId") {
                if (isProfileEffectHidden()) return null;
                if (canSpoofLarpProfileEffect()) {
                    const larp = getLarpProfileEffect();
                    if (larp) return (larp as { id?: string; skuId?: string; }).id ?? (larp as { skuId?: string; }).skuId;
                }
            }
            if (prop === "createdAt") {
                const custom = getCustomJoinDate();
                if (custom) return custom;
            }
            if (prop === "getCreatedAt") {
                const custom = getCustomJoinDate();
                if (custom) return () => custom;
            }
            if (prop === "__larpToolWrapped") return true;
            return Reflect.get(target, prop, receiver);
        },
    }) as T;

    displayProfileProxyCache.set(profile, proxy);
    return proxy;
}


function getCustomName() {
    if (!settings.store.enabled) return null;
    const n = settings.store.customUsername.trim();
    return n || null;
}

function parseJoinDate(raw: string): Date | null {
    const match = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
}

function refreshCustomJoinDateCache() {
    const raw = settings.store.enabled ? (settings.store.customJoinDate?.trim() ?? "") : "";
    const key = raw;
    if (key === cachedCustomJoinDateKey) return;
    cachedCustomJoinDateKey = key;
    const date = raw ? parseJoinDate(raw) : null;
    cachedCustomJoinDate = date;
    cachedCustomJoinDateMs = date ? date.getTime() : null;
}

function getCustomJoinDate(): Date | null {
    refreshCustomJoinDateCache();
    return cachedCustomJoinDate;
}

function getCustomJoinDateMs(): number | null {
    refreshCustomJoinDateCache();
    return cachedCustomJoinDateMs;
}

function formatJoinDateInput(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    if (!digits.length) return "";
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function isCompleteJoinDate(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function JoinDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [draft, setDraft] = useState(() => formatJoinDateInput(value));

    useEffect(() => {
        setDraft(formatJoinDateInput(value));
    }, [value]);

    const formatted = formatJoinDateInput(draft);
    const complete = isCompleteJoinDate(formatted);
    const valid = !complete || parseJoinDate(formatted) != null;

    const handleChange = (v: string) => {
        const next = formatJoinDateInput(v);
        setDraft(next);
        if (!next || isCompleteJoinDate(next)) onChange(next);
    };

    return (
        <>
            <TextInput
                value={formatted}
                onChange={handleChange}
                placeholder="YYYY-MM-DD"
                maxLength={10}
            />
            {complete && !valid && (
                <Forms.FormText style={{ margin: "8px 0 0", color: "var(--text-danger)", fontSize: 12 }}>
                    that date isn't valid
                </Forms.FormText>
            )}
        </>
    );
}

function withLarpUser(user: User | null | undefined): User | null | undefined {
    if (!user?.id || user.id !== getCurrentUserId() || !settings.store.enabled) return user;

    const custom = getCustomName();
    const joinDate = getCustomJoinDate();
    const hideDeco = isAvatarDecorationHidden();
    const hidePlate = isNameplateHidden();
    const deco = hideDeco ? null : getLarpAvatarDecoration();
    const plate = hidePlate ? null : getLarpNameplate();
    const hasLarpNameplate = !!plate?.skuId;
    const canSpoofNameplate = canSpoofLarpNameplate(plate);
    const needsUsername = !!custom && user.username !== custom;
    const needsJoinDate = !!joinDate;
    const realDecoSku = user.avatarDecorationData?.skuId;
    const needsDeco = hideDeco
        ? !!realDecoSku
        : (!!deco && realDecoSku !== deco.skuId);
    const realPlate = user.nameplate;
    const needsNameplate = hidePlate
        ? !!realPlate
        : (hasLarpNameplate && (
            canSpoofNameplate
                ? (!realPlate || realPlate.skuId !== plate!.skuId || realPlate.asset !== plate!.asset)
                : !!realPlate
        ));

    if (!needsUsername && !needsJoinDate && !needsDeco && !needsNameplate) return user;

    const cacheKey = `${userProxyGeneration}:${custom ?? ""}:${settings.store.customJoinDate?.trim() ?? ""}:${hideDeco ? "hide-deco" : (deco?.skuId ?? "")}:${hidePlate ? "hide-plate" : (hasLarpNameplate ? `${plate!.skuId}:${plate!.asset}:${canSpoofNameplate}` : "")}`;
    const cached = usernameProxyCache.get(user);
    if (cached?.__larpKey === cacheKey) return cached;

    const nameplateCollectible = canSpoofNameplate ? buildLarpNameplateCollectible(plate!) : null;

    const proxy = new Proxy(user, {
        get(target, prop, receiver) {
            if (prop === "username" && custom) return custom;
            if (prop === "avatarDecorationData" || prop === "avatarDecoration") {
                if (hideDeco) return null;
                if (deco) return deco;
            }
            if (prop === "nameplate") {
                if (hidePlate) return null;
                if (hasLarpNameplate) {
                    if (nameplateCollectible) {
                        return {
                            asset: nameplateCollectible.asset,
                            skuId: nameplateCollectible.skuId,
                            label: nameplateCollectible.label,
                            palette: nameplateCollectible.palette,
                        };
                    }
                    return null;
                }
            }
            if (prop === "collectibles") {
                if (hidePlate) return stripRealNameplateCollectibles();
                if (hasLarpNameplate) {
                    if (canSpoofNameplate && plate) return buildLarpCollectibles(plate);
                    return stripRealNameplateCollectibles();
                }
            }
            if (prop === "createdAt" && joinDate) return joinDate;
            if (prop === "getCreatedAt" && joinDate) return () => joinDate;
            return Reflect.get(target, prop, receiver);
        },
    }) as User & { __larpKey?: string; };

    proxy.__larpKey = cacheKey;
    usernameProxyCache.set(user, proxy);
    return proxy;
}

function withCustomUsernameOnly(user: User | null | undefined): User | null | undefined {
    return withLarpUser(user);
}

function resolveRenderedProfileEffect(
    user: User | null | undefined,
    guildId: string | null | undefined,
    profileStore: typeof UserProfileStore,
) {
    if (!user?.id) return null;

    const readProfileEffect = () => guildId == null
        ? profileStore.getUserProfile(user.id)?.profileEffect
        : profileStore.getGuildMemberProfile(user.id, guildId)?.profileEffect;

    if (user.id !== getCurrentUserId() || !settings.store.enabled) {
        return readProfileEffect();
    }

    if (isProfileEffectHidden()) return null;

    if (canSpoofLarpProfileEffect()) {
        return getLarpProfileEffect();
    }

    return readProfileEffect();
}

const LARP_AVATAR_REMOVED = { __larpRemoved: true as const };

function useLarpAvatarDecoration(user: User | null | undefined) {
    settings.use(["larpAvatarDecoration", "hiddenAvatarDecoration", "enabled"]);
    if (!user?.id || user.id !== getCurrentUserId() || !settings.store.enabled) return undefined;
    if (isAvatarDecorationHidden()) return LARP_AVATAR_REMOVED;
    return getLarpAvatarDecoration() ?? undefined;
}

function resolveLarpAvatarDecorationValue(
    larp: ReturnType<typeof useLarpAvatarDecoration>,
    fallback: unknown,
) {
    if (larp && typeof larp === "object" && "__larpRemoved" in larp) return null;
    return larp !== undefined ? larp : fallback;
}

function pickLarpAvatarDecoration(user: User | null | undefined, fallback: unknown) {
    return resolveLarpAvatarDecorationValue(useLarpAvatarDecoration(user), fallback);
}

function useLarpProfileEffect(userId: string | null | undefined) {
    settings.use(["larpProfileEffect", "hiddenProfileEffect", "enabled"]);
    if (!userId || userId !== getCurrentUserId()) return null;
    if (isProfileEffectHidden()) return null;
    return getLarpProfileEffect();
}

function useLarpNameplate(user: User | null | undefined) {
    settings.use(["larpNameplate", "hiddenNameplate", "enabled"]);
    if (!user?.id || user.id !== getCurrentUserId()) return undefined;
    if (isNameplateHidden()) return null;
    const plate = getLarpNameplate();
    if (!plate) return undefined;
    if (!canSpoofLarpNameplate(plate)) return null;
    const item = buildLarpNameplateCollectible(plate);
    return {
        asset: item.asset as string,
        skuId: item.skuId as string,
        label: item.label as string,
        palette: item.palette as string,
    };
}

function pickLarpNameplateUserValue(
    user: User | null | undefined,
    fallback: unknown,
) {
    const value = useLarpNameplate(user);
    return value !== undefined ? value : fallback;
}

function resolveSnowflakeUserId(id: string | { id?: string; toString?: () => string; } | null | undefined) {
    if (typeof id === "string") return id;
    if (id && typeof id === "object") {
        if (typeof id.id === "string") return id.id;
        if (typeof id.toString === "function") return id.toString();
    }
    return "";
}

function getLarpCreatedAt(userId: string | null | undefined, fallback: number | Date | null | undefined) {
    if (userId && cachedCustomJoinDateMs != null && userId === cachedOwnUserId) {
        return cachedCustomJoinDateMs;
    }
    if (fallback instanceof Date) return fallback.getTime();
    if (typeof fallback === "number") return fallback;
    if (typeof fallback === "string") {
        const parsed = Date.parse(fallback);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return fallback ?? 0;
}

function getAccountSettingsUsername(user: User) {
    if (!settings.store.enabled || user.id !== getCurrentUserId()) return user.username;
    return getCustomName() ?? user.username;
}

function refreshUsernameSwapCtx() {
    const prev = usernameSwapCtx;

    if (!settings.store.enabled) {
        usernameSwapCtx = { active: false, real: "", custom: "" };
    } else {
        const custom = settings.store.customUsername.trim();
        const real = cachedRealUsername || origGetCurrentUser?.()?.username || "";
        usernameSwapCtx = !custom || !real || real === custom
            ? { active: false, real, custom }
            : { active: true, real, custom };
    }

    if (prev.active !== usernameSwapCtx.active || prev.real !== usernameSwapCtx.real || prev.custom !== usernameSwapCtx.custom) {
        wrappedMessageCache.clear();
        messageCollectionGeneration++;
        profileWrapGeneration++;
    }
}

function getRealUsername() {
    if (cachedRealUsername) return cachedRealUsername;
    return origGetCurrentUser?.()?.username ?? "";
}

function swapRealUsernameInText(text: string | null | undefined) {
    if (!text || !usernameSwapCtx.active || !text.includes(usernameSwapCtx.real)) return text ?? "";
    return text.split(usernameSwapCtx.real).join(usernameSwapCtx.custom);
}

function embedMentionsRealUsername(embed: Embed, real: string) {
    if (embed.rawTitle?.includes(real)) return true;
    if (embed.rawDescription?.includes(real)) return true;
    if (embed.author?.name?.includes(real)) return true;
    if (embed.footer?.text?.includes(real)) return true;
    if (embed.provider?.name?.includes(real)) return true;
    return embed.fields?.some(f => f.rawName?.includes(real) || f.rawValue?.includes(real)) ?? false;
}

function messageMentionsRealUsername(message: Message, real: string) {
    if (message.content?.includes(real)) return true;
    if (message.embeds?.some(e => embedMentionsRealUsername(e, real))) return true;
    return message.messageSnapshots?.some(s => s.message && messageMentionsRealUsername(s.message as Message, real)) ?? false;
}

function mapEmbed(embed: Embed): Embed {
    const { active, real } = usernameSwapCtx;
    if (!active || !embedMentionsRealUsername(embed, real)) return embed;

    return {
        ...embed,
        rawTitle: swapRealUsernameInText(embed.rawTitle),
        rawDescription: swapRealUsernameInText(embed.rawDescription),
        author: embed.author ? { ...embed.author, name: swapRealUsernameInText(embed.author.name) } : embed.author,
        footer: embed.footer ? { ...embed.footer, text: swapRealUsernameInText(embed.footer.text) } : embed.footer,
        provider: embed.provider ? { ...embed.provider, name: swapRealUsernameInText(embed.provider.name ?? "") } : embed.provider,
        fields: embed.fields?.map(f => ({
            ...f,
            rawName: swapRealUsernameInText(f.rawName),
            rawValue: swapRealUsernameInText(f.rawValue),
        })) ?? embed.fields,
    };
}

function wrapMessageForDisplay(message: Message | null | undefined): Message | null | undefined {
    if (!message?.id || !usernameSwapCtx.active) return message;

    const { real, custom } = usernameSwapCtx;
    if (!messageMentionsRealUsername(message, real)) return message;

    const cacheKey = `${message.id}:${message.edited_timestamp ?? message.timestamp}:${custom}:${real}`;
    const cached = wrappedMessageCache.get(cacheKey);
    if (cached) return cached;

    const content = swapRealUsernameInText(message.content);
    const embeds = message.embeds?.map(mapEmbed) ?? message.embeds;
    const messageSnapshots = message.messageSnapshots?.map(s => ({
        ...s,
        message: s.message ? wrapMessageForDisplay(s.message as Message) : s.message,
    })) ?? message.messageSnapshots;

    const wrapped = new Proxy(message, {
        get(target, prop, receiver) {
            if (prop === "content") return content;
            if (prop === "embeds") return embeds;
            if (prop === "messageSnapshots") return messageSnapshots;
            return Reflect.get(target, prop, receiver);
        },
    }) as Message;

    wrappedMessageCache.set(cacheKey, wrapped);
    if (wrappedMessageCache.size > 200) {
        wrappedMessageCache.delete(wrappedMessageCache.keys().next().value!);
    }

    return wrapped;
}

function invalidateRuntimeCaches() {
    invalidateHiddenBadgeCache();
    cachedOwnUserId = AuthenticationStore.getId() ?? "";
    cachedCustomJoinDateKey = "";
    refreshCustomJoinDateCache();
    profileWrapGeneration++;
    messageCollectionGeneration++;
    userProxyGeneration++;
    wrappedMessageCache.clear();
    refreshUsernameSwapCtx();
}

function refreshCachedUsername() {
    const user = origGetCurrentUser?.() ?? UserStore.getCurrentUser();
    if (!user?.id || user.id !== getCurrentUserId()) return;

    const custom = getCustomName();
    if (!custom || user.username !== custom) {
        cachedRealUsername = user.username;
    }
    refreshUsernameSwapCtx();
}

function applyLarpConnections(connections: ConnectedAccount[] | undefined) {
    if (!settings.store.enabled) return connections;

    const overrides = settings.store.connectionOverrides;
    const hidden = new Set(settings.store.hiddenConnections ?? []);
    const custom = settings.store.customConnections ?? [];
    const base = connections ?? [];

    if (!base.length && !custom.length && !Object.keys(overrides).length && !hidden.size) return connections;

    const usedTypes = new Set(base.map(c => c.type));

    const mapped = base
        .filter(connection => !hidden.has(connKey(connection)))
        .map(connection => {
            const key = connKey(connection);
            const override = overrides[key] ?? overrides[connection.type];
            const name = override?.name?.trim();
            if (!name) return connection;
            return { ...connection, name };
        });

    for (const cc of custom) {
        if (!cc.type || usedTypes.has(cc.type)) continue;
        const built = buildFakeConnection(cc);
        if (!built) continue;
        mapped.push(built);
        usedTypes.add(cc.type);
    }

    return mapped;
}

function swapUsernameTag(user: User | null | undefined, tag: string) {
    if (!user?.id || user.id !== getCurrentUserId()) return tag;

    const custom = getCustomName();
    if (!custom || typeof tag !== "string") return tag;

    const real = getRealUsername();
    if (real && tag.includes(real)) return tag.replace(real, custom);
    return tag.includes(user.username) ? tag.replace(user.username, custom) : tag;
}

function getNativeBadgeIds(): Set<string> {
    const userId = getCurrentUserId();
    if (!userId) return new Set();

    const ids = new Set<string>();

    for (const badge of getUnfilteredOwnedBadges()) {
        const key = getBadgeKey(badge);
        if (key) ids.add(key);
    }

    for (const badge of origGetUserProfile?.(userId)?.badges ?? getRawUserProfile(userId)?.badges ?? []) {
        const key = getBadgeKey(badge);
        if (key) ids.add(key);
    }

    const user = UserStore.getCurrentUser();
    if (user) {
        for (const [key, flag] of Object.entries(UserFlags)) {
            if (typeof flag !== "number") continue;
            if (!user.hasFlag(flag)) continue;
            const badgeId = FLAG_BADGE_IDS[key.toLowerCase()];
            if (badgeId) ids.add(badgeId);
        }
        if (user.premiumType) ids.add("premium_bronze");
    }

    const normalized = new Set<string>();
    for (const id of ids) {
        normalized.add(id);
        normalized.add(canonicalBadgeId(id));
    }

    return normalized;
}

function runtimeBadgeToEntry(badge: {
    id?: string;
    key?: string;
    description?: string;
    icon?: string;
    iconSrc?: string;
    link?: string;
}): BadgeEntry | null {
    const id = getBadgeKey(badge);
    if (!id) return null;

    const known = KNOWN_BADGES[id];
    return {
        id,
        description: badge.description ?? known?.description ?? id.replace(/_/g, " "),
        icon: badge.iconSrc?.startsWith("http")
            ? badge.iconSrc
            : BADGE_ICON_MAP[id] ?? known?.icon ?? (badge.icon ?? ""),
        link: badge.link ?? known?.link,
    };
}

function isOwnedBadgeVisible(id: string) {
    return !expandBadgeHideIds(id).some(alias => isBadgeHiddenKey(alias));
}

function isAddedBadgeVisible(id: string) {
    return settings.store.addedBadges.includes(id);
}

function setOwnedBadgeVisible(id: string, visible: boolean) {
    const expanded = captureHiddenIdentifiers(id);
    let hidden = [...settings.store.hiddenBadges];

    if (visible) {
        hidden = hidden.filter(x => !expanded.includes(x));
    } else {
        for (const badgeId of expanded) {
            if (!hidden.includes(badgeId)) hidden.push(badgeId);
        }
    }

    settings.store.hiddenBadges = hidden;
    settings.store.addedBadges = settings.store.addedBadges.filter(x => !expanded.includes(x));
    invalidateHiddenBadgeCache();
    updateHiddenBadgeStyles();
    triggerProfileRefresh();
}

function setAddedBadgeVisible(id: string, visible: boolean) {
    let added = [...settings.store.addedBadges];

    if (visible) {
        const group = getBadgeExclusiveGroup(id);
        if (group) added = added.filter(x => getBadgeExclusiveGroup(x) !== group);
        if (!added.includes(id)) added.push(id);
    } else {
        added = added.filter(x => x !== id);
    }

    settings.store.addedBadges = added;
    triggerProfileRefresh();
}

function needsProfileRefreshOnLoad() {
    return !!(
        settings.store.customJoinDate?.trim()
        || settings.store.larpNameplate
        || settings.store.larpAvatarDecoration
        || settings.store.larpProfileEffect
    );
}

function buildUserUpdatePayload() {
    const user = origGetCurrentUser?.();
    if (!user) return null;
    return withLarpUser(user) ?? user;
}

function triggerProfileRefresh(debounceMs = 100) {
    if (debounceMs > 0) {
        if (profileRefreshTimer) clearTimeout(profileRefreshTimer);
        profileRefreshTimer = setTimeout(() => {
            profileRefreshTimer = null;
            triggerProfileRefresh(0);
        }, debounceMs);
        return;
    }

    invalidateRuntimeCaches();
    const userId = getCurrentUserId();
    if (!userId) return;

    const payload = buildUserUpdatePayload();
    if (payload) FluxDispatcher.dispatch({ type: "USER_UPDATE", user: payload });

    const profile = origGetUserProfile?.(userId);
    if (profile && settings.store.enabled) {
        FluxDispatcher.dispatch({
            type: "USER_PROFILE_UPDATE",
            userProfile: wrapOwnUserProfile(profile, userId),
        });
    } else if (profile) {
        FluxDispatcher.dispatch({ type: "USER_PROFILE_UPDATE", userProfile: profile });
    }
}

function patchCollectiblesProductStore(store: {
    products?: Record<string, unknown>;
    getProduct?: (id: string) => unknown;
    getCollectiblesProduct?: (id: string) => unknown;
    __larpPatched?: boolean;
}) {
    if (store.__larpPatched) return;

    collectiblesProductStores.add(store);

    for (const [skuId, product] of larpCollectibleProducts) {
        if (!store.products) continue;
        if (product.type === 2 && !isReadyLarpNameplateProduct(product)) continue;
        if (product.type === 1 && !isReadyLarpProfileEffectProduct(product)) continue;
        store.products[skuId] = product;
    }

    if (store.getProduct) {
        const orig = store.getProduct.bind(store);
        store.getProduct = (skuId: string) => {
            const hit = getLarpProductForStore(String(skuId));
            if (hit) return hit;
            const result = orig(skuId);
            return result ?? null;
        };
    }

    if (store.getCollectiblesProduct) {
        const orig = store.getCollectiblesProduct.bind(store);
        store.getCollectiblesProduct = (skuId: string) => {
            const hit = getLarpProductForStore(String(skuId));
            if (hit) return hit;
            const result = orig(skuId);
            return result ?? null;
        };
    }

    store.__larpPatched = true;
    unpatchFns.push(() => {
        collectiblesProductStores.delete(store);
        delete store.__larpPatched;
    });
}

function patchCollectiblesProductLookup() {
    ensureLarpDecorationProductsFromSettings();

    try {
        const store = findByPropsLazy("getProduct", "products") as {
            products?: Record<string, unknown>;
            getProduct?: (id: string) => unknown;
            __larpPatched?: boolean;
        };
        patchCollectiblesProductStore(store);
    } catch { }

    waitFor(filters.byProps("getProduct", "products"), patchCollectiblesProductStore);
    waitFor(filters.byProps("products"), patchCollectiblesProductStore);
    waitFor(filters.byProps("getCollectiblesProduct"), patchCollectiblesProductStore);
}

function filterBadges(
    profile: { userId?: string; user?: { id: string; }; },
    badges: Array<{ id?: string; key?: string; icon?: string; iconSrc?: string; userId?: string; }>
) {
    const userId = profile?.userId ?? profile?.user?.id;

    if (!settings.store.enabled) return badges;
    if (!userId || userId !== getCurrentUserId()) return badges;

    return badges.filter(b => {
        const key = getBadgeKey(b);
        if (key && isVencordBadge(key)) return true;
        return !isBadgeHiddenObject(b);
    });
}

function mergeLarpDisplayBadges(
    profile: { userId?: string; user?: { id: string; }; },
    badges: Array<{ id?: string; key?: string; icon?: string; iconSrc?: string; link?: string; userId?: string; }> | null | undefined,
) {
    const safeBadges = Array.isArray(badges) ? badges : [];
    const userId = profile?.userId ?? profile?.user?.id;
    const result = [...filterBadges(profile, safeBadges)];
    if (!settings.store.enabled) return result;
    if (!userId || userId !== getCurrentUserId()) return result;

    for (const id of settings.store.addedBadges) {
        if (!isAddedBadgeVisible(id) || badgeAlreadyPresent(result, id)) continue;

        const group = getBadgeExclusiveGroup(id);
        if (group && result.some(b => getBadgeExclusiveGroup(getBadgeKey(b)) === group)) continue;

        const built = buildDisplayBadge(id, { userId });
        if (built) result.push(built);
    }

    // Stamp owner so icon rendering never leaks hide rules onto other profiles
    return result.map(b => (b.userId ? b : { ...b, userId }));
}

function mergeProfileBadges(
    userId: string,
    badges: Array<{ id?: string; key?: string; icon?: string; iconSrc?: string; link?: string; }> | undefined,
) {
    const result = [...filterBadges({ userId }, badges ?? [])];
    if (!settings.store.enabled || userId !== getCurrentUserId()) return result;

    for (const id of settings.store.addedBadges) {
        if (!isAddedBadgeVisible(id) || badgeAlreadyPresent(result, id)) continue;

        const group = getBadgeExclusiveGroup(id);
        if (group && result.some(b => getBadgeExclusiveGroup(getBadgeKey(b)) === group)) continue;

        result.push(buildNativeProfileBadge(id));
    }

    return result;
}

function getModalBadgeLists() {
    const ownedIds = getNativeBadgeIds();
    const yours: BadgeEntry[] = [];
    const seen = new Set<string>();
    const addedIds = new Set(settings.store.addedBadges);

    const markSeen = (id: string) => {
        seen.add(id);
        seen.add(canonicalBadgeId(id));
    };

    const isSeen = (id: string) => seen.has(id) || seen.has(canonicalBadgeId(id));

    const isAdded = (id: string) => {
        if (addedIds.has(id)) return true;
        for (const added of addedIds) {
            if (badgeIdsEquivalent(id, added)) return true;
        }
        return false;
    };

    for (const badge of getUnfilteredOwnedBadges()) {
        const entry = runtimeBadgeToEntry(badge);
        if (!entry || isSeen(entry.id) || isAdded(entry.id)) continue;
        markSeen(entry.id);
        ownedIds.add(entry.id);
        ownedIds.add(canonicalBadgeId(entry.id));
        yours.push({ ...entry, id: canonicalBadgeId(entry.id) });
    }

    const userId = getCurrentUserId() ?? "";
    for (const badge of origGetUserProfile?.(userId)?.badges ?? getRawUserProfile(userId)?.badges ?? []) {
        const entry = runtimeBadgeToEntry(badge);
        if (!entry || isSeen(entry.id) || isAdded(entry.id)) continue;
        markSeen(entry.id);
        ownedIds.add(entry.id);
        ownedIds.add(canonicalBadgeId(entry.id));
        yours.push({ ...entry, id: canonicalBadgeId(entry.id) });
    }

    for (const id of ownedIds) {
        const catalogId = canonicalBadgeId(id);
        if (isSeen(catalogId) || isAdded(catalogId)) continue;
        markSeen(catalogId);
        const known = KNOWN_BADGES[catalogId];
        yours.push(known
            ? { id: catalogId, ...known }
            : { id: catalogId, description: catalogId.replace(/_/g, " "), icon: BADGE_ICON_MAP[catalogId] ?? "" });
    }

    yours.sort((a, b) => a.description.localeCompare(b.description));

    const other = Object.entries(KNOWN_BADGES)
        .filter(([id]) => !isBadgeIdOwned(id, ownedIds))
        .map(([id, def]) => ({ id, ...def }))
        .sort((a, b) => a.description.localeCompare(b.description));

    return { ownedIds, yours, other };
}

let larpModalKey: string | null = null;

function closeBadgeManager() {
    if (!larpModalKey) return;
    closeModal(larpModalKey);
    larpModalKey = null;
}

function openBadgeManager() {
    if (larpModalKey) {
        closeBadgeManager();
        return;
    }

    larpModalKey = openModal(props => (
        <BadgeModal
            {...props}
            onClose={() => {
                larpModalKey = null;
                props.onClose();
            }}
        />
    ));
}

function handleKeyDown(e: KeyboardEvent) {
    if (!settings.store.enabled) return;

    const key = e.key.toLowerCase();
    if (key !== "b" || !(e.ctrlKey || e.metaKey) || e.altKey) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    openBadgeManager();
}

function BadgeRow({ badge, active, locked, muted, onClick }: {
    badge: BadgeEntry;
    active: boolean;
    locked?: boolean;
    muted?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            title={badge.description + (locked ? " (exclusive)" : "")}
            disabled={locked}
            onClick={onClick}
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "10px 8px",
                borderRadius: 12,
                border: active
                    ? "2px solid var(--brand-experiment-560)"
                    : "2px solid transparent",
                background: "transparent",
                boxShadow: "0 1px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.12)",
                opacity: locked ? 0.35 : muted ? 0.45 : 1,
                cursor: locked ? "not-allowed" : "pointer",
                filter: locked ? "grayscale(1)" : undefined,
                minWidth: 0,
            }}
        >
            <div style={{
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
            }}>
                <BadgeIcon id={badge.id} icon={badge.icon} size={28} />
            </div>
            <Text
                variant="text-xxs/normal"
                style={{
                    color: "var(--text-muted)",
                    textAlign: "center",
                    lineHeight: "13px",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    width: "100%",
                }}
            >
                {badge.description}
            </Text>
        </button>
    );
}

function ProfilePreview({ asTitle }: { asTitle?: boolean }) {
    settings.use([
        "customUsername",
        "hiddenBadges",
        "addedBadges",
        "larpAvatarDecoration",
        "larpNameplate",
        "hiddenAvatarDecoration",
        "hiddenNameplate",
    ]);
    const user = UserStore.getCurrentUser();
    const realDeco = useStateFromStores([UserStore], () => getRealAvatarDecoration());
    const realPlate = useStateFromStores([UserStore], () => getRealNameplate());

    const spoofDeco = settings.store.larpAvatarDecoration;
    const hideDeco = isAvatarDecorationHidden();
    const avatarDecoPreview = hideDeco
        ? null
        : (spoofDeco?.previewUrl
            ?? (spoofDeco?.skuId && spoofDeco.asset
                ? resolveAvatarDecorationPreviewUrl(spoofDeco.skuId, spoofDeco.asset)
                : null)
            ?? realDeco?.previewUrl
            ?? null);

    const spoofPlate = settings.store.larpNameplate;
    const hidePlate = isNameplateHidden();
    const nameplate = hidePlate ? null : (spoofPlate ?? realPlate);
    const nameplatePreview = nameplate?.asset
        ? resolveNameplatePreviewUrl(nameplate.asset)
        : (nameplate?.previewUrl ?? null);
    const nameplateAnimated = nameplate?.asset
        ? resolveNameplateAnimatedUrl(nameplate.asset)
        : null;
    const [nameplateHover, setNameplateHover] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const { yours, other } = useStateFromStores(
        [UserProfileStore, UserStore],
        () => getModalBadgeLists()
    );

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (nameplateHover) {
            void video.play().catch(() => undefined);
        } else {
            video.pause();
            video.currentTime = 0;
        }
    }, [nameplateHover]);

    const handle = settings.store.customUsername.trim() || user?.username || "username";
    const visible = [
        ...yours.filter(b => isOwnedBadgeVisible(b.id)),
        ...other.filter(b => isAddedBadgeVisible(b.id)),
    ];

    const avatarSize = asTitle ? 56 : 48;
    const badgeSize = asTitle ? 22 : 18;

    const avatar = (
        <div style={{
            width: avatarSize, height: avatarSize, borderRadius: "50%",
            background: "var(--background-tertiary)",
            backgroundImage: user ? `url(${user.getAvatarURL(undefined, 96, true)})` : undefined,
            backgroundSize: "cover",
            flexShrink: 0,
            position: "relative",
        }}>
            {avatarDecoPreview && (
                <img
                    src={avatarDecoPreview}
                    alt=""
                    style={{
                        position: "absolute",
                        inset: -7,
                        width: "calc(100% + 14px)",
                        height: "calc(100% + 14px)",
                        pointerEvents: "none",
                    }}
                />
            )}
        </div>
    );

    const identity = (
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <Text
                variant="text-lg/semibold"
                style={{
                    position: "relative",
                    zIndex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                }}
            >
                @{handle}
            </Text>
            {visible.length > 0 && (
                <div style={{
                    display: "flex",
                    flexWrap: "nowrap",
                    gap: 5,
                    marginTop: 5,
                    overflow: "hidden",
                }}>
                    {visible.slice(0, 8).map(b => (
                        <BadgeIcon key={b.id} id={b.id} icon={b.icon} size={badgeSize} />
                    ))}
                </div>
            )}
        </div>
    );

    if (asTitle) {
        const fadeMask = "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)";
        const mediaStyle = {
            width: "100%",
            height: "100%",
            objectFit: "cover" as const,
            objectPosition: "left center",
            display: "block",
        };
        return (
            <div
                onMouseEnter={() => setNameplateHover(true)}
                onMouseLeave={() => setNameplateHover(false)}
                style={{
                    position: "relative",
                    height: 72,
                    margin: 0,
                    padding: 0,
                    overflow: "hidden",
                    borderRadius: 8,
                }}
            >
                {nameplatePreview && (
                    <div
                        aria-hidden
                        style={{
                            position: "absolute",
                            inset: 0,
                            zIndex: 0,
                            pointerEvents: "none",
                            opacity: nameplateHover ? 0.62 : 0.5,
                            transition: "opacity 160ms ease",
                            WebkitMaskImage: fadeMask,
                            maskImage: fadeMask,
                            WebkitMaskSize: "100% 100%",
                            maskSize: "100% 100%",
                        }}
                    >
                        <img
                            src={nameplatePreview}
                            alt=""
                            style={{
                                ...mediaStyle,
                                position: "absolute",
                                inset: 0,
                                opacity: nameplateHover && nameplateAnimated ? 0 : 1,
                                transition: "opacity 140ms ease",
                            }}
                        />
                        {nameplateAnimated && (
                            <video
                                ref={videoRef}
                                src={nameplateAnimated}
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                style={{
                                    ...mediaStyle,
                                    position: "absolute",
                                    inset: 0,
                                    opacity: nameplateHover ? 1 : 0,
                                    transition: "opacity 140ms ease",
                                }}
                            />
                        )}
                    </div>
                )}
                <div style={{
                    position: "relative",
                    zIndex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    height: "100%",
                    width: "100%",
                    minWidth: 0,
                    padding: "0 2px",
                    boxSizing: "border-box",
                }}>
                    {avatar}
                    {identity}
                </div>
            </div>
        );
    }

    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            ...cardStyle,
            marginBottom: 16,
        }}>
            {avatar}
            {identity}
        </div>
    );
}

function ConnectionPlatformIcon({ type, size = 28 }: { type: string; size?: number }) {
    try {
        const platform = connectionPlatforms.get(useLegacyPlatformType(type));
        if (!platform) return null;

        return (
            <img
                src={platform.icon.darkSVG}
                alt={connectionTypeLabel(type)}
                title={connectionTypeLabel(type)}
                width={size}
                height={size}
                style={{ flexShrink: 0, display: "block" }}
            />
        );
    } catch {
        return (
            <div style={{
                width: size,
                height: size,
                borderRadius: 4,
                background: "var(--background-tertiary)",
                flexShrink: 0,
            }} />
        );
    }
}

function ConnectionTypePicker({ options, value, onChange, placeholder }: {
    options: { value: string; label: string; }[];
    value: string | null;
    onChange: (value: string | null) => void;
    placeholder: string;
}) {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number; } | null>(null);

    const selected = options.find(o => o.value === value);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return options;
        return options.filter(o =>
            o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
        );
    }, [options, query]);

    const syncMenuRect = () => {
        const el = anchorRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const menuHeight = 280;
        const spaceBelow = window.innerHeight - rect.bottom;
        const openUp = spaceBelow < menuHeight && rect.top > spaceBelow;
        setMenuRect({
            left: rect.left,
            width: Math.max(rect.width, 240),
            top: openUp ? Math.max(8, rect.top - menuHeight - 6) : rect.bottom + 6,
        });
    };

    const closePicker = () => {
        setOpen(false);
        setQuery("");
        setMenuRect(null);
    };

    const openPicker = () => {
        syncMenuRect();
        setQuery("");
        setOpen(true);
    };

    useEffect(() => {
        if (!open) return;
        syncMenuRect();
        const onUpdate = () => syncMenuRect();
        window.addEventListener("resize", onUpdate);
        window.addEventListener("scroll", onUpdate, true);
        return () => {
            window.removeEventListener("resize", onUpdate);
            window.removeEventListener("scroll", onUpdate, true);
        };
    }, [open, filtered.length]);

    const pick = (type: string) => {
        onChange(type);
        closePicker();
    };

    const menu = open && menuRect ? ReactDOM.createPortal(
        <>
            <div
                onMouseDown={e => { e.preventDefault(); closePicker(); }}
                style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 10050,
                    background: "transparent",
                }}
            />
            <div
                onMouseDown={e => e.stopPropagation()}
                style={{
                    position: "fixed",
                    left: menuRect.left,
                    top: menuRect.top,
                    width: menuRect.width,
                    zIndex: 10051,
                    background: "var(--background-floating, var(--modal-background, #111214))",
                    borderRadius: 12,
                    boxShadow: "0 10px 28px rgba(0,0,0,0.5)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <div style={{ padding: "10px 10px 8px" }}>
                    <TextInput
                        value={query}
                        onChange={setQuery}
                        placeholder={placeholder}
                    />
                </div>
                <ScrollerThin style={{ maxHeight: 220, padding: "0 6px 8px" }}>
                    {filtered.length ? filtered.map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => pick(opt.value)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                width: "100%",
                                padding: "9px 10px",
                                borderRadius: 8,
                                border: "none",
                                cursor: "pointer",
                                textAlign: "left",
                                background: opt.value === value
                                    ? "var(--background-modifier-selected)"
                                    : "transparent",
                                color: "var(--text-normal)",
                            }}
                            onMouseEnter={e => {
                                if (opt.value !== value)
                                    (e.currentTarget as HTMLButtonElement).style.background = "var(--background-modifier-hover)";
                            }}
                            onMouseLeave={e => {
                                (e.currentTarget as HTMLButtonElement).style.background = opt.value === value
                                    ? "var(--background-modifier-selected)"
                                    : "transparent";
                            }}
                        >
                            <ConnectionPlatformIcon type={opt.value} size={22} />
                            <Text variant="text-sm/medium">{opt.label}</Text>
                        </button>
                    )) : (
                        <Text
                            variant="text-sm/normal"
                            style={{ display: "block", padding: "12px", color: "var(--text-muted)" }}
                        >
                            No matches
                        </Text>
                    )}
                </ScrollerThin>
            </div>
        </>,
        document.body
    ) : null;

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                onClick={() => open ? closePicker() : openPicker()}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: "transparent",
                    boxShadow: "0 1px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.12)",
                    cursor: "pointer",
                    color: "var(--text-normal)",
                    textAlign: "left",
                }}
            >
                {selected ? (
                    <ConnectionPlatformIcon type={selected.value} size={22} />
                ) : (
                    <div
                        title="Choose platform"
                        aria-hidden="true"
                        style={{
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            flexShrink: 0,
                            display: "grid",
                            placeItems: "center",
                            background: "var(--background-modifier-hover)",
                            color: "var(--text-muted)",
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <rect x="1.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
                            <rect x="9.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
                            <rect x="1.5" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
                            <path d="M12 9.5v5M9.5 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                    </div>
                )}
                <Text
                    variant="text-sm/medium"
                    style={{ flex: 1, color: selected ? "var(--text-normal)" : "var(--text-muted)" }}
                >
                    {selected?.label ?? "Choose platform"}
                </Text>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{open ? "▴" : "▾"}</span>
            </button>
            {menu}
        </>
    );
}

function ConnectionRow({ type, value, onChange, placeholder, disabled, actionLabel, onAction }: {
    type: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    disabled?: boolean;
    actionLabel: string;
    onAction: () => void;
}) {
    return (
        <div style={connectionRowStyle}>
            <ConnectionPlatformIcon type={type} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    disabled={disabled}
                />
            </div>
            <button
                type="button"
                className="vc-larp-icon-btn"
                title={actionLabel}
                aria-label={actionLabel}
                onClick={onAction}
            >
                ×
            </button>
        </div>
    );
}

function ConnectionsSection() {
    settings.use(["connectionOverrides", "hiddenConnections", "customConnections"]);
    const [pickType, setPickType] = useState<string | null>(null);
    const [newName, setNewName] = useState("");

    const realConnections = useStateFromStores(
        [UserProfileStore],
        () => getRealConnections()
    );
    const overrides = settings.store.connectionOverrides;
    const hidden = settings.store.hiddenConnections;
    const hiddenSet = new Set(hidden);
    const custom = settings.store.customConnections;

    const usedTypes = new Set([
        ...realConnections.filter(c => !hiddenSet.has(connKey(c))).map(c => c.type),
        ...custom.map(c => c.type),
    ]);
    const availableTypes = CONNECTION_TYPE_OPTIONS.filter(o => !usedTypes.has(o.value));

    const updateOverride = (key: string, value: string) => {
        const next = { ...overrides };
        if (!value.trim()) delete next[key];
        else next[key] = { name: value };
        settings.store.connectionOverrides = next;
        triggerProfileRefresh();
    };

    const hideRealConnection = (key: string) => {
        if (hiddenSet.has(key)) return;
        settings.store.hiddenConnections = [...hidden, key];
        triggerProfileRefresh();
    };

    const restoreRealConnection = (key: string) => {
        settings.store.hiddenConnections = hidden.filter(k => k !== key);
        triggerProfileRefresh();
    };

    const updateCustom = (id: string, name: string) => {
        settings.store.customConnections = custom.map(c =>
            c.id === id ? { ...c, name: connectionNeedsDomain(c.type) ? normalizeDomain(name) : name } : c
        );
        triggerProfileRefresh();
    };

    const removeCustom = (id: string) => {
        settings.store.customConnections = custom.filter(c => c.id !== id);
        triggerProfileRefresh();
    };

    const addCustom = () => {
        if (!pickType) return;
        const name = connectionNeedsDomain(pickType)
            ? normalizeDomain(newName)
            : newName.trim();
        if (!name) {
            showToast(connectionNeedsDomain(pickType) ? "Enter a domain" : "Enter a handle", Toasts.Type.FAILURE);
            return;
        }

        settings.store.customConnections = [...custom, {
            id: `larp-${pickType}-${Date.now()}`,
            type: pickType,
            name,
        }];

        setPickType(null);
        setNewName("");
        triggerProfileRefresh();
    };

    const activeReal = realConnections.filter(c => !hiddenSet.has(connKey(c)));
    const hiddenReal = realConnections.filter(c => hiddenSet.has(connKey(c)));

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: MODAL_BODY_MAX_HEIGHT }}>
            <ScrollerThin style={{ flex: 1, minHeight: 0, paddingRight: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {!activeReal.length && !custom.length && !hiddenReal.length && (
                        <Forms.FormText style={{ margin: "8px 0", color: "var(--text-muted)" }}>
                            No linked accounts yet. Add one below.
                        </Forms.FormText>
                    )}

                    {activeReal.map(connection => {
                        const key = connKey(connection);
                        const override = overrides[key] ?? overrides[connection.type];
                        return (
                            <ConnectionRow
                                key={key}
                                type={connection.type}
                                value={override?.name ?? connection.name}
                                onChange={v => updateOverride(key, v)}
                                placeholder={connection.name}
                                actionLabel="Hide"
                                onAction={() => hideRealConnection(key)}
                            />
                        );
                    })}

                    {custom.map(cc => (
                        <ConnectionRow
                            key={cc.id}
                            type={cc.type}
                            value={cc.name}
                            onChange={v => updateCustom(cc.id, v)}
                            placeholder={connectionNeedsDomain(cc.type) ? "example.com" : "Handle"}
                            actionLabel="Remove"
                            onAction={() => removeCustom(cc.id)}
                        />
                    ))}

                    {hiddenReal.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                            <div style={sectionTitleStyle}>Hidden</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {hiddenReal.map(connection => {
                                    const key = connKey(connection);
                                    return (
                                        <div
                                            key={key}
                                            style={{
                                                ...connectionRowStyle,
                                                opacity: 0.7,
                                                padding: "8px 12px",
                                            }}
                                        >
                                            <ConnectionPlatformIcon type={connection.type} size={22} />
                                            <Text variant="text-sm/normal" style={{ color: "var(--text-muted)", flex: 1 }}>
                                                {connection.name}
                                            </Text>
                                            <Button size="tiny" variant="secondary" onClick={() => restoreRealConnection(key)}>
                                                Restore
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </ScrollerThin>

            {availableTypes.length > 0 && (
                <div style={{
                    ...cardStyle,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    flexShrink: 0,
                }}>
                    <Text variant="text-xs/medium" style={{ ...sectionTitleStyle, marginBottom: 0 }}>
                        Add connection
                    </Text>
                    <ConnectionTypePicker
                        options={availableTypes}
                        value={pickType}
                        onChange={v => {
                            setPickType(v);
                            setNewName("");
                        }}
                        placeholder="Search platforms..."
                    />
                    {pickType && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <TextInput
                                    value={newName}
                                    onChange={setNewName}
                                    placeholder={connectionNeedsDomain(pickType) ? "example.com" : "Handle"}
                                />
                            </div>
                            <Button
                                size="small"
                                variant="primary"
                                disabled={!newName.trim()}
                                onClick={addCustom}
                            >
                                Add
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function BadgeSection({ title, badges, emptyLabel, onBadgeClick, isActive, isLocked, isMuted }: {
    title: string;
    badges: BadgeEntry[];
    emptyLabel?: string;
    onBadgeClick: (badge: BadgeEntry) => void;
    isActive: (badge: BadgeEntry) => boolean;
    isLocked?: (badge: BadgeEntry) => boolean;
    isMuted?: (badge: BadgeEntry) => boolean;
}) {
    if (!badges.length) {
        return (
            <div style={{ marginBottom: 12 }}>
                <div style={sectionTitleStyle}>{title}</div>
                <Forms.FormText style={{ margin: 0, color: "var(--text-muted)" }}>
                    {emptyLabel ?? "Nothing here."}
                </Forms.FormText>
            </div>
        );
    }

    return (
        <div style={{ marginBottom: 12 }}>
            <div style={sectionTitleStyle}>
                {title}
                <span style={{ marginLeft: 8, opacity: 0.5, fontWeight: 600 }}>{badges.length}</span>
            </div>
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
                gap: 8,
            }}>
                {badges.map(badge => {
                    const locked = isLocked?.(badge) ?? false;
                    return (
                        <BadgeRow
                            key={badge.id}
                            badge={badge}
                            active={isActive(badge)}
                            locked={locked}
                            muted={isMuted?.(badge)}
                            onClick={() => {
                                if (!locked) onBadgeClick(badge);
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
}

function buildPreviewUrlCandidates(src: string, staticOnly = false, assetHint?: string) {
    const normalized = absolutizeCollectibleUrl(src);
    const urls: string[] = [];

    if (assetHint && (assetHint.includes("nameplates") || src.includes("nameplates") || src.includes("/assets/collectibles/"))) {
        urls.push(...resolveNameplateAssetCandidates(assetHint.includes("nameplates") ? assetHint : src.replace(/^.*\/assets\/collectibles\//, "").replace(/static\.png$/, "")));
    }

    if (normalized) urls.push(normalized);

    if (!staticOnly && normalized) {
        if (normalized.includes("/static")) urls.push(normalized.replace(/\/static(?=$|\?|\/)/, "/animated"));
        if (normalized.includes("/animated")) urls.push(normalized.replace(/\/animated(?=$|\?|\/)/, "/video"));
        if (normalized.endsWith("static.png")) {
            urls.push(normalized.replace(/static\.png$/, "img.png"));
            urls.push(normalized.replace(/static\.png$/, "asset.webm"));
        }
    }
    if (normalized.includes("avatar-decoration-presets") && !normalized.includes("size=")) {
        urls.push(`${normalized}${normalized.includes("?") ? "&" : "?"}size=96&passthrough=true`);
    }
    const skuOnly = normalized.match(/^(https:\/\/cdn\.discordapp\.com\/media\/v1\/collectibles-shop\/[^/]+)\/static(?:\?.*)?$/);
    if (skuOnly) {
        urls.push(`${skuOnly[1]}/animated`);
        urls.push(`${skuOnly[1]}/video`);
    }
    return [...new Set(urls.filter(Boolean))];
}

function DecorationPreviewImage({
    src,
    eager,
    staticOnly,
    wide,
    assetHint,
}: {
    src: string;
    eager?: boolean;
    staticOnly?: boolean;
    wide?: boolean;
    assetHint?: string;
}) {
    const candidates = buildPreviewUrlCandidates(src, staticOnly, assetHint);
    const [candidateIndex, setCandidateIndex] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const activeSrc = candidates[candidateIndex] ?? "";

    useEffect(() => {
        setCandidateIndex(0);
        setLoaded(!activeSrc || preloadedDecorationUrls.has(activeSrc));
    }, [src, assetHint]);

    useEffect(() => {
        if (!activeSrc) return;

        if (preloadedDecorationUrls.has(activeSrc)) {
            setLoaded(true);
            return;
        }

        let cancelled = false;
        const img = new Image();
        img.decoding = "async";
        if (eager && "fetchPriority" in img) {
            (img as HTMLImageElement & { fetchPriority?: string; }).fetchPriority = "high";
        }
        img.onload = () => {
            if (cancelled) return;
            preloadedDecorationUrls.add(activeSrc);
            setLoaded(true);
        };
        img.onerror = () => {
            if (cancelled) return;
            if (candidateIndex + 1 < candidates.length) {
                setCandidateIndex(candidateIndex + 1);
                return;
            }
            setLoaded(true);
        };
        img.src = activeSrc;

        return () => { cancelled = true; };
    }, [activeSrc, candidateIndex, candidates.length, eager]);

    if (!activeSrc) {
        return (
            <div style={{
                width: wide ? 72 : 52,
                height: wide ? 24 : 52,
                borderRadius: wide ? 4 : 8,
                background: "var(--background-secondary)",
            }} />
        );
    }

    return (
        <img
            src={activeSrc}
            alt=""
            width={wide ? 72 : 52}
            height={wide ? 24 : 52}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            style={{
                objectFit: wide ? "cover" : "contain",
                opacity: loaded ? 1 : 0.2,
                transition: "opacity 120ms ease-out",
            }}
        />
    );
}

function DecorationSkeletonGrid({ wide }: { wide?: boolean }) {
    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
            gap: 8,
        }}>
            {Array.from({ length: DECORATION_BROWSE_LIMIT }, (_, i) => (
                <div
                    key={i}
                    className="vc-larp-skeleton"
                    style={{ height: wide ? 68 : 88 }}
                />
            ))}
        </div>
    );
}

function EquippedDecorationCard({
    label,
    previewUrl,
    assetHint,
    wide,
    status = "Equipped",
    muted,
    clearLabel = "Unequip",
    onClear,
}: {
    label: string;
    previewUrl?: string | null;
    assetHint?: string;
    wide?: boolean;
    status?: string;
    muted?: boolean;
    clearLabel?: string;
    onClear: () => void;
}) {
    return (
        <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 12,
            background: "transparent",
            boxShadow: "0 1px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.12)",
            opacity: muted ? 0.55 : 1,
        }}>
            <div style={{
                width: wide ? 96 : 52,
                height: wide ? 32 : 52,
                borderRadius: wide ? 6 : 10,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: "var(--background-modifier-hover)",
            }}>
                {previewUrl ? (
                    <DecorationPreviewImage
                        src={previewUrl}
                        eager
                        wide={wide}
                        assetHint={assetHint}
                    />
                ) : (
                    <div className="vc-larp-skeleton" style={{ width: "100%", height: "100%" }} />
                )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <Text
                    variant="text-sm/semibold"
                    style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {label}
                </Text>
                <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                    {status}
                </Text>
            </div>
            <button
                type="button"
                className="vc-larp-icon-btn"
                title={clearLabel}
                aria-label={clearLabel}
                onClick={onClear}
            >
                {clearLabel === "Restore" ? "↺" : "×"}
            </button>
        </div>
    );
}

function DecorationGrid({
    items,
    selectedSkuId,
    onSelect,
    emptyLabel,
    staticOnlyPreview,
    widePreview,
}: {
    items: Array<{ skuId: string; name: string; previewUrl: string; asset?: string; }>;
    selectedSkuId: string | null;
    onSelect: (skuId: string) => void;
    emptyLabel: string;
    staticOnlyPreview?: boolean;
    widePreview?: boolean;
}) {
    const previewKey = items.map(i => `${i.skuId}:${i.previewUrl}`).join(",");
    useEffect(() => {
        const urls = items.flatMap(i => {
            if (i.asset && i.asset.includes("nameplates")) return resolveNameplateAssetCandidates(i.asset);
            return i.previewUrl ? [i.previewUrl] : [];
        });
        preloadDecorationUrls(urls.filter(Boolean));
    }, [previewKey]);

    if (!items.length) {
        return (
            <Forms.FormText style={{ margin: 0, color: "var(--text-muted)" }}>
                {emptyLabel}
            </Forms.FormText>
        );
    }

    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))",
            gap: 8,
        }}>
            {items.map((item, index) => {
                const selected = selectedSkuId === item.skuId;
                return (
                    <button
                        key={item.skuId}
                        type="button"
                        title={item.name}
                        onClick={() => onSelect(item.skuId)}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 4,
                            padding: 8,
                            borderRadius: 10,
                            border: selected
                                ? "2px solid var(--brand-experiment-560)"
                                : "2px solid transparent",
                            background: "transparent",
                            boxShadow: selected
                                ? "0 2px 10px rgba(0,0,0,0.28)"
                                : "0 1px 0 rgba(0,0,0,0.18), 0 4px 14px rgba(0,0,0,0.12)",
                            cursor: "pointer",
                            minHeight: widePreview ? 68 : 88,
                        }}
                    >
                        <DecorationPreviewImage
                            src={item.previewUrl}
                            eager={index < DECORATION_BROWSE_LIMIT}
                            staticOnly={staticOnlyPreview}
                            wide={widePreview}
                            assetHint={item.asset}
                        />
                        <Text
                            variant="text-xxs/normal"
                            style={{
                                color: "var(--text-muted)",
                                textAlign: "center",
                                lineHeight: "14px",
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {item.name}
                        </Text>
                    </button>
                );
            })}
        </div>
    );
}

function DecorationsSection() {
    const [subTab, setSubTab] = useState<number>(DecorationSubTabs.Avatar);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);
    const [shop, setShop] = useState<{
        avatar: ShopAvatarDeco[];
        banner: ShopProfileEffect[];
        nameplate: ShopNameplate[];
    }>({
        avatar: [],
        banner: [],
        nameplate: [],
    });
    const [searchResults, setSearchResults] = useState<{
        avatar: ShopAvatarDeco[];
        banner: ShopProfileEffect[];
        nameplate: ShopNameplate[];
    }>({ avatar: [], banner: [], nameplate: [] });

    settings.use([
        "larpAvatarDecoration",
        "larpProfileEffect",
        "larpNameplate",
        "hiddenAvatarDecoration",
        "hiddenProfileEffect",
        "hiddenNameplate",
    ]);

    const realAvatar = useStateFromStores([UserStore], () => getRealAvatarDecoration());
    const realBanner = useStateFromStores([UserProfileStore, UserStore], () => getRealProfileEffect());
    const realNameplate = useStateFromStores([UserStore], () => getRealNameplate());

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void fetchShopDecorations().then(async data => {
            if (!alive) return;
            await ensureShopPreviewsForSubTab(subTab);
            if (!alive) return;
            setShop({ avatar: data.avatar, banner: data.banner, nameplate: data.nameplate });
            setLoading(false);
        });
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        if (loading) return;
        let alive = true;
        void ensureShopPreviewsForSubTab(subTab).then(data => {
            if (!alive || !data) return;
            setShop({ avatar: data.avatar, banner: data.banner, nameplate: data.nameplate });
        });
        return () => { alive = false; };
    }, [subTab, loading]);

    useEffect(() => {
        const q = search.trim();
        if (!q) {
            setSearchResults({ avatar: [], banner: [], nameplate: [] });
            setSearching(false);
            return;
        }

        const activeKey = subTab === DecorationSubTabs.Banner
            ? "banner"
            : subTab === DecorationSubTabs.Nameplate
                ? "nameplate"
                : "avatar";
        const source = activeKey === "banner"
            ? shop.banner
            : activeKey === "nameplate"
                ? shop.nameplate
                : shop.avatar;
        const activeLocal = filterShopCatalog(source, q);
        setSearchResults(prev => ({ ...prev, [activeKey]: activeLocal }));

        if (activeLocal.length > 0) {
            setSearching(false);
            return;
        }

        let alive = true;
        setSearching(true);
        const itemType = decorationSubTabItemType(subTab);
        const cacheKey = `${itemType}:${q.toLowerCase()}`;
        const cached = shopSearchCache.get(cacheKey);
        if (cached) {
            setSearchResults(prev => ({ ...prev, [activeKey]: cached as typeof prev[typeof activeKey] }));
            setSearching(false);
            return () => { alive = false; };
        }

        const timer = setTimeout(() => {
            void searchShopDecorations(q, itemType).then(results => {
                if (!alive) return;
                shopSearchCache.set(cacheKey, results);
                if (shopSearchCache.size > SHOP_SEARCH_CACHE_MAX) {
                    const oldest = shopSearchCache.keys().next().value;
                    if (oldest) shopSearchCache.delete(oldest);
                }
                setSearchResults(prev => ({ ...prev, [activeKey]: results as typeof prev[typeof activeKey] }));
                setSearching(false);
            });
        }, 150);

        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [search, subTab, shop]);

    const q = search.trim();
    const selectedAvatarSku = settings.store.larpAvatarDecoration?.skuId ?? null;
    const selectedBannerSku = settings.store.larpProfileEffect?.skuId ?? null;
    const selectedNameplateSku = settings.store.larpNameplate?.skuId ?? null;

    const avatarCatalog = q ? searchResults.avatar : shop.avatar;
    const bannerCatalog = q ? searchResults.banner : shop.banner;
    const nameplateCatalog = q ? searchResults.nameplate : shop.nameplate;
    const avatarItems = q
        ? avatarCatalog
        : getBrowseDecorationItems(shop.avatar, selectedAvatarSku ?? realAvatar?.skuId ?? null, DECORATION_BROWSE_LIMIT);
    const bannerItems = q
        ? bannerCatalog
        : getBrowseDecorationItems(shop.banner, selectedBannerSku ?? realBanner?.skuId ?? null, DECORATION_BROWSE_LIMIT);
    const nameplateItems = q
        ? nameplateCatalog
        : getBrowseDecorationItems(shop.nameplate, selectedNameplateSku ?? realNameplate?.skuId ?? null, DECORATION_BROWSE_LIMIT);
    const avatarTotal = shop.avatar.length;
    const bannerTotal = shop.banner.length;
    const nameplateTotal = shop.nameplate.length;

    const searchPlaceholder = subTab === DecorationSubTabs.Avatar
        ? "Search avatar decorations..."
        : subTab === DecorationSubTabs.Banner
            ? "Search banner effects..."
            : "Search nameplates...";

    const spoofAvatar = settings.store.larpAvatarDecoration;
    const spoofBanner = settings.store.larpProfileEffect;
    const spoofNameplate = settings.store.larpNameplate;
    const hideAvatar = isAvatarDecorationHidden();
    const hideBanner = isProfileEffectHidden();
    const hideNameplate = isNameplateHidden();

    const avatarEquippedCard = (() => {
        if (hideAvatar) {
            if (!realAvatar) return null;
            return {
                label: "Your decoration",
                previewUrl: realAvatar.previewUrl
                    ?? resolveAvatarDecorationPreviewUrl(realAvatar.skuId, realAvatar.asset),
                status: "Hidden",
                muted: true,
                clearLabel: "Restore",
                onClear: () => setAvatarDecorationHidden(false),
            };
        }
        if (spoofAvatar) {
            return {
                label: spoofAvatar.label ?? "Avatar decoration",
                previewUrl: spoofAvatar.previewUrl
                    ?? resolveAvatarDecorationPreviewUrl(spoofAvatar.skuId, spoofAvatar.asset),
                status: "Spoofed",
                clearLabel: "Use real",
                onClear: () => equipAvatarDecoration(null),
            };
        }
        if (realAvatar) {
            return {
                label: "Your decoration",
                previewUrl: realAvatar.previewUrl
                    ?? resolveAvatarDecorationPreviewUrl(realAvatar.skuId, realAvatar.asset),
                status: "Equipped",
                clearLabel: "Hide",
                onClear: () => setAvatarDecorationHidden(true),
            };
        }
        return null;
    })();

    const bannerEquippedCard = (() => {
        if (hideBanner) {
            if (!realBanner) return null;
            return {
                label: realBanner.title ?? "Profile effect",
                previewUrl: realBanner.thumbnailPreviewSrc
                    ?? realBanner.staticFrameSrc
                    ?? realBanner.reducedMotionSrc
                    ?? shop.banner.find(i => i.skuId === realBanner.skuId)?.previewUrl
                    ?? null,
                status: "Hidden",
                muted: true,
                clearLabel: "Restore",
                onClear: () => setProfileEffectHidden(false),
            };
        }
        if (spoofBanner) {
            return {
                label: spoofBanner.title ?? "Profile effect",
                previewUrl: spoofBanner.thumbnailPreviewSrc
                    ?? spoofBanner.staticFrameSrc
                    ?? spoofBanner.reducedMotionSrc
                    ?? shop.banner.find(i => i.skuId === spoofBanner.skuId)?.previewUrl
                    ?? null,
                status: "Spoofed",
                clearLabel: "Use real",
                onClear: () => equipProfileEffect(null),
            };
        }
        if (realBanner) {
            return {
                label: realBanner.title ?? "Profile effect",
                previewUrl: realBanner.thumbnailPreviewSrc
                    ?? realBanner.staticFrameSrc
                    ?? realBanner.reducedMotionSrc
                    ?? shop.banner.find(i => i.skuId === realBanner.skuId)?.previewUrl
                    ?? null,
                status: "Equipped",
                clearLabel: "Hide",
                onClear: () => setProfileEffectHidden(true),
            };
        }
        return null;
    })();

    const nameplateEquippedCard = (() => {
        if (hideNameplate) {
            if (!realNameplate) return null;
            return {
                label: realNameplate.label ?? "Nameplate",
                previewUrl: realNameplate.previewUrl
                    ?? (realNameplate.asset ? resolveNameplatePreviewUrl(realNameplate.asset) : null),
                assetHint: realNameplate.asset,
                status: "Hidden",
                muted: true,
                clearLabel: "Restore",
                onClear: () => setNameplateHidden(false),
            };
        }
        if (spoofNameplate) {
            return {
                label: spoofNameplate.label ?? "Nameplate",
                previewUrl: spoofNameplate.previewUrl
                    ?? (spoofNameplate.asset ? resolveNameplatePreviewUrl(spoofNameplate.asset) : null),
                assetHint: spoofNameplate.asset,
                status: "Spoofed",
                clearLabel: "Use real",
                onClear: () => equipNameplate(null),
            };
        }
        if (realNameplate) {
            return {
                label: realNameplate.label ?? "Nameplate",
                previewUrl: realNameplate.previewUrl
                    ?? (realNameplate.asset ? resolveNameplatePreviewUrl(realNameplate.asset) : null),
                assetHint: realNameplate.asset,
                status: "Equipped",
                clearLabel: "Hide",
                onClear: () => setNameplateHidden(true),
            };
        }
        return null;
    })();

    const showSkeleton = loading || searching;

    return (
        <div>
            <div className="vc-larp-seg">
                {([
                    [DecorationSubTabs.Avatar, "Avatar"],
                    [DecorationSubTabs.Banner, "Banner"],
                    [DecorationSubTabs.Nameplate, "Nameplate"],
                ] as const).map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        className="vc-larp-seg-btn"
                        data-active={subTab === id}
                        onClick={() => setSubTab(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div style={{ marginBottom: 12 }}>
                <TextInput
                    value={search}
                    onChange={setSearch}
                    placeholder={searchPlaceholder}
                />
            </div>

            <div key={subTab} className="vc-larp-tab-panel">
                {subTab === DecorationSubTabs.Avatar && (
                    <>
                        {avatarEquippedCard && (
                            <EquippedDecorationCard
                                label={avatarEquippedCard.label}
                                previewUrl={avatarEquippedCard.previewUrl}
                                status={avatarEquippedCard.status}
                                muted={avatarEquippedCard.muted}
                                clearLabel={avatarEquippedCard.clearLabel}
                                onClear={avatarEquippedCard.onClear}
                            />
                        )}
                        {showSkeleton ? (
                            <DecorationSkeletonGrid />
                        ) : (
                            <>
                                {!q && avatarTotal > DECORATION_BROWSE_LIMIT && (
                                    <Forms.FormText style={{ margin: "0 0 10px", color: "var(--text-muted)", fontSize: 12 }}>
                                        Showing {avatarItems.length} of {avatarTotal}. Search to find more.
                                    </Forms.FormText>
                                )}
                                <DecorationGrid
                                    items={avatarItems}
                                    selectedSkuId={selectedAvatarSku}
                                    onSelect={skuId => {
                                        if (selectedAvatarSku === skuId) {
                                            equipAvatarDecoration(null);
                                            return;
                                        }
                                        const item = avatarCatalog.find(i => i.skuId === skuId)
                                            ?? shop.avatar.find(i => i.skuId === skuId);
                                        if (item) equipAvatarDecoration(item);
                                    }}
                                    emptyLabel={q
                                        ? "No avatar decorations match your search."
                                        : "No avatar decorations found. Try reopening the tab."}
                                />
                            </>
                        )}
                    </>
                )}

                {subTab === DecorationSubTabs.Banner && (
                    <>
                        {bannerEquippedCard && (
                            <EquippedDecorationCard
                                label={bannerEquippedCard.label}
                                previewUrl={bannerEquippedCard.previewUrl}
                                status={bannerEquippedCard.status}
                                muted={bannerEquippedCard.muted}
                                clearLabel={bannerEquippedCard.clearLabel}
                                onClear={bannerEquippedCard.onClear}
                            />
                        )}
                        {showSkeleton ? (
                            <DecorationSkeletonGrid />
                        ) : (
                            <>
                                {!q && bannerTotal > DECORATION_BROWSE_LIMIT && (
                                    <Forms.FormText style={{ margin: "0 0 10px", color: "var(--text-muted)", fontSize: 12 }}>
                                        Showing {bannerItems.length} of {bannerTotal}. Search to find more.
                                    </Forms.FormText>
                                )}
                                <DecorationGrid
                                    items={bannerItems}
                                    selectedSkuId={selectedBannerSku}
                                    onSelect={skuId => {
                                        if (selectedBannerSku === skuId) {
                                            equipProfileEffect(null);
                                            return;
                                        }
                                        const item = bannerCatalog.find(i => i.skuId === skuId)
                                            ?? shop.banner.find(i => i.skuId === skuId);
                                        if (item) equipProfileEffect(item);
                                    }}
                                    emptyLabel={q
                                        ? "No banner effects match your search."
                                        : "No banner effects found. Try reopening the tab."}
                                />
                            </>
                        )}
                    </>
                )}

                {subTab === DecorationSubTabs.Nameplate && (
                    <>
                        {nameplateEquippedCard && (
                            <EquippedDecorationCard
                                label={nameplateEquippedCard.label}
                                previewUrl={nameplateEquippedCard.previewUrl}
                                assetHint={nameplateEquippedCard.assetHint}
                                status={nameplateEquippedCard.status}
                                muted={nameplateEquippedCard.muted}
                                clearLabel={nameplateEquippedCard.clearLabel}
                                wide
                                onClear={nameplateEquippedCard.onClear}
                            />
                        )}
                        {showSkeleton ? (
                            <DecorationSkeletonGrid wide />
                        ) : (
                            <>
                                {!q && nameplateTotal > DECORATION_BROWSE_LIMIT && (
                                    <Forms.FormText style={{ margin: "0 0 10px", color: "var(--text-muted)", fontSize: 12 }}>
                                        Showing {nameplateItems.length} of {nameplateTotal}. Search to find more.
                                    </Forms.FormText>
                                )}
                                <DecorationGrid
                                    items={nameplateItems}
                                    selectedSkuId={selectedNameplateSku}
                                    widePreview
                                    onSelect={skuId => {
                                        if (selectedNameplateSku === skuId) {
                                            equipNameplate(null);
                                            return;
                                        }
                                        const item = nameplateCatalog.find(i => i.skuId === skuId)
                                            ?? shop.nameplate.find(i => i.skuId === skuId);
                                        if (item) equipNameplate(item);
                                    }}
                                    emptyLabel={q
                                        ? "No nameplates match your search."
                                        : "No nameplates found. Try reopening the tab."}
                                />
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function CreditsSection() {
    return (
        <div style={{ ...cardStyle, textAlign: "center", padding: "28px 16px" }}>
            <Text variant="text-md/semibold" style={{ color: "var(--header-primary)", marginBottom: 4 }}>
                Larp Tool
            </Text>
            <Forms.FormText style={{ margin: "0 0 12px", color: "var(--text-muted)" }}>
                Client-side profile larp for Vencord
            </Forms.FormText>
            <a
                href="https://github.com/sp5-y/discord-larp-plugin"
                target="_blank"
                rel="noreferrer noopener"
                style={{
                    color: "var(--text-link)",
                    fontSize: 13,
                    textDecoration: "none",
                }}
                onMouseEnter={e => { e.currentTarget.style.textDecoration = "underline"; }}
                onMouseLeave={e => { e.currentTarget.style.textDecoration = "none"; }}
            >
                github.com/sp5-y/discord-larp-plugin
            </a>
            <Forms.FormText style={{ margin: "12px 0 0", color: "var(--text-muted)", fontSize: 11 }}>
                made by sp5 · Ctrl+B
            </Forms.FormText>
        </div>
    );
}

const BadgeModal = ErrorBoundary.wrap(function BadgeModal(props: RenderModalProps) {
    const [tab, setTab] = useState<number>(ModalTabs.Username);
    const [profileReady, setProfileReady] = useState(false);

    useEffect(() => {
        ensureTabAnimStyles();
        let alive = true;
        const userId = getCurrentUserId();
        const alreadyHaveProfile = !!(userId && (origGetUserProfile?.(userId) ?? UserProfileStore.getUserProfile(userId)));
        if (alreadyHaveProfile) {
            setProfileReady(true);
            return () => { alive = false; };
        }
        void refreshOwnProfile().finally(() => {
            if (alive) setProfileReady(true);
        });
        return () => { alive = false; };
    }, []);

    settings.use([
        "customUsername",
        "customJoinDate",
        "hiddenBadges",
        "addedBadges",
        "connectionOverrides",
        "hiddenConnections",
        "customConnections",
        "larpAvatarDecoration",
        "larpProfileEffect",
        "larpNameplate",
    ]);
    void profileReady;
    const { yours, other } = useStateFromStores(
        [UserProfileStore, UserStore],
        () => getModalBadgeLists()
    );

    const spoofedBadges = other.filter(b => isAddedBadgeVisible(b.id));
    const yourBadgeList = [...yours, ...spoofedBadges];
    const addBadgeList = other.filter(b => !isAddedBadgeVisible(b.id));
    const ownedIds = new Set(yours.map(b => b.id));

    return (
        <Modal
            {...props}
            title={<ProfilePreview asTitle />}
            size="lg"
            actions={[
                {
                    text: "Reset",
                    variant: "secondary",
                    onClick: () => {
                        if (!confirm("Reset all larp settings? This clears your username, badges, decorations, and connections.")) return;
                        resetLarpConfig();
                        showToast("All settings reset", Toasts.Type.SUCCESS);
                    },
                },
                {
                    text: "Close",
                    variant: "primary",
                    onClick: props.onClose,
                },
            ]}
        >
            <div style={{ padding: "0 16px 16px" }}>
                <TabBar
                    type="top"
                    look="brand"
                    selectedItem={tab}
                    onItemSelect={setTab}
                    style={{ marginBottom: 12 }}
                >
                    <TabBar.Item id={ModalTabs.Username}>Username</TabBar.Item>
                    <TabBar.Item id={ModalTabs.Badges}>Badges</TabBar.Item>
                    <TabBar.Item id={ModalTabs.Decorations}>Decorations</TabBar.Item>
                    <TabBar.Item id={ModalTabs.MemberSince}>Joined</TabBar.Item>
                    <TabBar.Item id={ModalTabs.Connections}>Connections</TabBar.Item>
                    <TabBar.Item id={ModalTabs.Credits}>Credits</TabBar.Item>
                </TabBar>

                {tab === ModalTabs.Connections ? (
                    <div key={tab} className="vc-larp-tab-panel">
                        <ConnectionsSection />
                    </div>
                ) : (
                    <ScrollerThin style={{ maxHeight: MODAL_BODY_MAX_HEIGHT, paddingTop: 2 }}>
                        <div key={tab} className="vc-larp-tab-panel">
                            {tab === ModalTabs.Username && (
                                <FieldCard label="Custom username" hint="Shown as your @handle in profiles and messages.">
                                    <TextInput
                                        value={settings.store.customUsername}
                                        onChange={v => {
                                            settings.store.customUsername = v;
                                            triggerProfileRefresh(200);
                                        }}
                                        placeholder="Your @username"
                                        maxLength={32}
                                    />
                                </FieldCard>
                            )}

                            {tab === ModalTabs.Badges && (
                                <div>
                                    <BadgeSection
                                        title="Your Badges"
                                        badges={yourBadgeList}
                                        emptyLabel="No badges yet."
                                        isActive={badge => ownedIds.has(badge.id)
                                            ? isOwnedBadgeVisible(badge.id)
                                            : true}
                                        isMuted={badge => ownedIds.has(badge.id) && !isOwnedBadgeVisible(badge.id)}
                                        onBadgeClick={badge => {
                                            if (ownedIds.has(badge.id)) {
                                                setOwnedBadgeVisible(badge.id, !isOwnedBadgeVisible(badge.id));
                                            } else {
                                                setAddedBadgeVisible(badge.id, false);
                                            }
                                        }}
                                    />
                                    <BadgeSection
                                        title="Add Badges"
                                        badges={addBadgeList}
                                        emptyLabel="Nothing left to add."
                                        isActive={() => false}
                                        isLocked={badge => isBadgeExclusiveBlocked(badge.id)}
                                        onBadgeClick={badge => setAddedBadgeVisible(badge.id, true)}
                                    />
                                </div>
                            )}

                            {tab === ModalTabs.Decorations && <DecorationsSection />}

                            {tab === ModalTabs.MemberSince && (
                                <FieldCard label="Member since" hint="Overrides the date on your profile.">
                                    <JoinDateInput
                                        value={settings.store.customJoinDate}
                                        onChange={v => {
                                            settings.store.customJoinDate = v;
                                            triggerProfileRefresh(200);
                                        }}
                                    />
                                </FieldCard>
                            )}

                            {tab === ModalTabs.Credits && <CreditsSection />}
                        </div>
                    </ScrollerThin>
                )}
            </div>
        </Modal>
    );
}, { noop: true });

function applyGetLegacyUsernameFilter(proto: { getLegacyUsername: () => string | null; userId?: string; }) {
    if ((proto as { __larpLegacyPatched?: boolean; }).__larpLegacyPatched) return;

    const original = proto.getLegacyUsername;
    proto.getLegacyUsername = function (this: { userId: string; }) {
        if (settings.store.enabled && this.userId === getCurrentUserId()) {
            const custom = getCustomName();
            if (custom) return custom;
        }
        return original.call(this);
    };

    (proto as { __larpLegacyPatched?: boolean; }).__larpLegacyPatched = true;
    unpatchFns.push(() => {
        proto.getLegacyUsername = original;
        delete (proto as { __larpLegacyPatched?: boolean; }).__larpLegacyPatched;
    });
}

function applyGetBadgesFilter(proto: { getBadges: () => unknown[]; getLegacyUsername?: () => string | null; }) {
    if ((proto as { __larpToolPatched?: boolean; }).__larpToolPatched) return;

    if (proto.getLegacyUsername) applyGetLegacyUsernameFilter(proto as { getLegacyUsername: () => string | null; });

    const original = proto.getBadges;
    unfilteredGetBadges = function (this: { userId: string; }) {
        return original.call(this) as Array<{ id?: string; key?: string; icon?: string; iconSrc?: string; }>;
    };

    proto.getBadges = function (this: { userId: string; }) {
        return mergeLarpDisplayBadges(this, unfilteredGetBadges!.call(this));
    };

    (proto as { __larpToolPatched?: boolean; }).__larpToolPatched = true;
    unpatchFns.push(() => {
        proto.getBadges = original;
        delete (proto as { __larpToolPatched?: boolean; }).__larpToolPatched;
        if (unfilteredGetBadges) unfilteredGetBadges = null;
    });
}

function patchDisplayProfile() {
    try {
        const userId = getCurrentUserId();
        if (userId) {
            const profile = DisplayProfileUtils.getDisplayProfile(userId);
            if (profile) applyGetBadgesFilter(Object.getPrototypeOf(profile) as { getBadges: () => unknown[]; });
        }
    } catch { }

    waitFor(
        m => typeof m === "function" && m.prototype?.getBadges && m.prototype?.getLegacyUsername,
        (DisplayProfile: { prototype: { getBadges: () => unknown[]; }; }) => {
            applyGetBadgesFilter(DisplayProfile.prototype);
        }
    );
}

function patchDisplayProfileUtils() {
    const origGet = DisplayProfileUtils.getDisplayProfile;
    const origUse = DisplayProfileUtils.useDisplayProfile;

    DisplayProfileUtils.getDisplayProfile = (userId, guildId, customStores) =>
        wrapDisplayProfile(origGet(userId, guildId, customStores));

    DisplayProfileUtils.useDisplayProfile = (userId, guildId, customStores) =>
        wrapDisplayProfile(origUse(userId, guildId, customStores));

    unpatchFns.push(() => {
        DisplayProfileUtils.getDisplayProfile = origGet;
        DisplayProfileUtils.useDisplayProfile = origUse;
    });
}

function ownProfileWrapSig(profile: { bio?: string | null; profileEffectId?: string | null; connectedAccounts?: unknown[]; badges?: unknown[]; }, userId: string) {
    return [
        profileWrapGeneration,
        userId,
        profile.bio ?? "",
        profile.profileEffectId ?? "",
        profile.connectedAccounts?.length ?? 0,
        profile.badges?.length ?? 0,
    ].join("\u0001");
}

function wrapOwnUserProfile(profile: NonNullable<ReturnType<typeof UserProfileStore.getUserProfile>>, userId: string) {
    // FakeProfileThemes returns a fresh virtualMerge proxy whenever the bio
    // contains a 3y3 code. Keying the cache on that object made every
    // getUserProfile() return a new profile and Discord re-rendered until it crashed.
    const sig = ownProfileWrapSig(profile, userId);
    const cached = wrappedProfileCache.get(userId);
    if (cached?.sig === sig) return cached.value;

    const hideEffect = isProfileEffectHidden();
    const canSpoofEffect = !hideEffect && canSpoofLarpProfileEffect();
    const larpEffect = canSpoofEffect ? getLarpProfileEffect() : null;
    const joinDate = getCustomJoinDate();
    const badges = mergeProfileBadges(userId, profile.badges);
    const connectedAccounts = applyLarpConnections(profile.connectedAccounts);
    const createdAt = joinDate ? joinDate.toISOString() : undefined;

    const wrapped = new Proxy(profile, {
        get(target, prop, receiver) {
            if (prop === "badges") return badges;
            if (prop === "connectedAccounts") return connectedAccounts;
            if (hideEffect && (prop === "profileEffect" || prop === "profileEffectId" || prop === "profileEffectExpiresAt")) {
                return null;
            }
            if (canSpoofEffect && larpEffect && prop === "profileEffect") return larpEffect;
            if (canSpoofEffect && larpEffect && prop === "profileEffectId") {
                return (larpEffect as { id?: string; skuId?: string; }).id
                    ?? (larpEffect as { skuId?: string; }).skuId;
            }
            if (canSpoofEffect && larpEffect && prop === "profileEffectExpiresAt") return null;
            if (createdAt && prop === "createdAt") return createdAt;
            if (joinDate && prop === "getCreatedAt") return () => joinDate;
            return Reflect.get(target, prop, receiver);
        },
    });

    wrappedProfileCache.set(userId, { sig, value: wrapped });
    return wrapped;
}

function patchUserProfileStore() {
    origGetUserProfile = UserProfileStore.getUserProfile.bind(UserProfileStore);

    UserProfileStore.getUserProfile = (userId: string) => {
        const profile = origGetUserProfile(userId);
        if (!profile || userId !== getCurrentUserId() || !settings.store.enabled) return profile;
        // Object.assign/proxy reads can re-enter the store. Don't wrap again.
        if (profileWrapDepth > 0) return profile;
        profileWrapDepth++;
        try {
            return wrapOwnUserProfile(profile, userId);
        } finally {
            profileWrapDepth--;
        }
    };

    unpatchFns.push(() => {
        UserProfileStore.getUserProfile = origGetUserProfile;
    });
}

function patchProfileDomScope() {
    let lastMark = 0;
    const markOwnProfileNodes = () => {
        if (!settings.store.enabled || !settings.store.hiddenBadges.length) return;

        const now = Date.now();
        if (now - lastMark < 400) return;
        lastMark = now;

        const userId = getCurrentUserId();
        if (!userId) return;

        // Drop stale marks so other people's profiles never keep our hide scope
        for (const el of document.querySelectorAll("[data-larp-user]")) {
            delete (el as HTMLElement).dataset.larpUser;
        }

        for (const el of document.querySelectorAll(
            `[class*="userPopoutOuter"], [class*="userProfileModal"], [class*="userProfileOuter"], [aria-label$=" profile popout"]`
        )) {
            const root = el as HTMLElement;
            const rootUserId = root.getAttribute("data-user-id")
                ?? root.querySelector(":scope > [data-user-id], :scope [data-user-id]")?.getAttribute("data-user-id");

            // Only mark when the profile subject itself is the current user.
            // Do not use "any link to /users/{id}" — mutuals/friends lists falsely match.
            if (rootUserId === userId) {
                root.dataset.larpUser = userId;
                continue;
            }

            const avatarImgs = Array.from(root.querySelectorAll("img")).filter(img => {
                const src = img.getAttribute("src") ?? "";
                return src.includes("/avatars/") || src.includes("/embed/avatars/");
            });
            const firstAvatar = avatarImgs[0];
            if (!firstAvatar) continue;
            const src = firstAvatar.getAttribute("src") ?? "";
            if (src.includes(`/avatars/${userId}/`) || src.includes(`/avatars/${userId}.`)) {
                root.dataset.larpUser = userId;
            }
        }

        const accountPanel = document.querySelector("[class*='accountProfile']");
        if (accountPanel) (accountPanel as HTMLElement).dataset.larpUser = userId;
    };

    const scheduleMark = () => {
        if (profileDomObserverScheduled) return;
        profileDomObserverScheduled = true;
        profileDomObserverRafId = requestAnimationFrame(() => {
            profileDomObserverScheduled = false;
            markOwnProfileNodes();
        });
    };

    profileDomObserver = new MutationObserver(scheduleMark);
    syncProfileDomObserver(settings.store.enabled && settings.store.hiddenBadges.length > 0);
    markOwnProfileNodes();

    unpatchFns.push(() => {
        syncProfileDomObserver(false);
        cancelAnimationFrame(profileDomObserverRafId);
        profileDomObserver?.disconnect();
        profileDomObserver = null;
        for (const el of document.querySelectorAll("[data-larp-user]")) {
            delete (el as HTMLElement).dataset.larpUser;
        }
    });
}

function syncProfileDomObserver(active: boolean) {
    if (!profileDomObserver) return;
    if (active && !profileDomObserverActive) {
        profileDomObserver.observe(document.body, { childList: true, subtree: true });
        profileDomObserverActive = true;
        return;
    }
    if (!active && profileDomObserverActive) {
        profileDomObserver.disconnect();
        profileDomObserverActive = false;
    }
}

function patchParser() {
    origParserParse = Parser.parse.bind(Parser);
    Parser.parse = ((content: unknown, ...args: unknown[]) => {
        if (typeof content !== "string") {
            return origParserParse(content as string, ...args);
        }
        if (!usernameSwapCtx.active || !content.includes(usernameSwapCtx.real)) {
            return origParserParse(content, ...args);
        }
        return origParserParse(swapRealUsernameInText(content), ...args);
    }) as typeof Parser.parse;

    unpatchFns.push(() => {
        Parser.parse = origParserParse;
    });
}

function wrapMessageCollection(collection: ReturnType<typeof MessageStore.getMessages>) {
    if (!collection || !usernameSwapCtx.active) return collection;

    const cachedProxy = messageCollectionProxyCache.get(collection);
    if (cachedProxy) return cachedProxy;

    let cachedArray: Message[] | null = null;
    let cachedSource: Message[] | null = null;
    let arrayGen = messageCollectionGeneration;

    const proxy = new Proxy(collection, {
        get(target, prop, receiver) {
            if (prop === "__larpWrapped") return true;
            if (prop === "_array") {
                const source = Reflect.get(target, "_array", receiver) as Message[];
                if (arrayGen === messageCollectionGeneration && cachedSource === source && cachedArray) {
                    return cachedArray;
                }
                cachedArray = source.map(m => wrapMessageForDisplay(m)!);
                cachedSource = source;
                arrayGen = messageCollectionGeneration;
                return cachedArray;
            }
            const value = Reflect.get(target, prop, receiver);
            if (prop === "get" && typeof value === "function") {
                return (id: string) => wrapMessageForDisplay(value.call(target, id));
            }
            return value;
        },
    }) as ReturnType<typeof MessageStore.getMessages>;

    messageCollectionProxyCache.set(collection, proxy);
    return proxy;
}

function patchMessageStore() {
    origGetMessage = MessageStore.getMessage.bind(MessageStore);
    origGetMessages = MessageStore.getMessages.bind(MessageStore);

    MessageStore.getMessage = (channelId, messageId) => {
        const message = origGetMessage(channelId, messageId);
        if (!usernameSwapCtx.active) return message!;
        return wrapMessageForDisplay(message)!;
    };

    MessageStore.getMessages = channelId => {
        const collection = origGetMessages(channelId);
        if (!usernameSwapCtx.active) return collection;
        return wrapMessageCollection(collection);
    };

    unpatchFns.push(() => {
        MessageStore.getMessage = origGetMessage;
        MessageStore.getMessages = origGetMessages;
    });
}

function patchUserCreatedAt() {
    waitFor(
        m => typeof m === "function"
            && typeof m.prototype?.getCreatedAt === "function"
            && typeof m.prototype?.getAvatarURL === "function"
            && !(m.prototype as { __larpCreatedAtPatched?: boolean; }).__larpCreatedAtPatched,
        (UserModel: { prototype: { getCreatedAt: () => unknown; __larpCreatedAtPatched?: boolean; }; }) => {
            if (UserModel.prototype.__larpCreatedAtPatched) return;
            const original = UserModel.prototype.getCreatedAt;
            UserModel.prototype.getCreatedAt = function (this: { id: string; }) {
                if (settings.store.enabled && this.id === getCurrentUserId()) {
                    const ms = getCustomJoinDateMs();
                    if (ms != null) return new Date(ms);
                }
                return original.call(this);
            };
            UserModel.prototype.__larpCreatedAtPatched = true;
            unpatchFns.push(() => {
                UserModel.prototype.getCreatedAt = original;
                delete UserModel.prototype.__larpCreatedAtPatched;
            });
        },
    );
}

function patchSnowflakeExtractTimestamp() {
    waitFor(filters.byProps("extractTimestamp", "fromTimestamp"), (utils: {
        extractTimestamp: (id: unknown) => number;
        __larpExtractTsPatched?: boolean;
    }) => {
        if (utils.__larpExtractTsPatched) return;
        const original = utils.extractTimestamp.bind(utils);
        utils.extractTimestamp = (id: unknown) => {
            const ms = cachedCustomJoinDateMs;
            if (ms != null && id === cachedOwnUserId) return ms;
            return original(id);
        };
        utils.__larpExtractTsPatched = true;
        unpatchFns.push(() => {
            utils.extractTimestamp = original;
            delete utils.__larpExtractTsPatched;
        });
    });
}

function patchUserStore() {
    origGetCurrentUser = UserStore.getCurrentUser.bind(UserStore);
    origGetUser = UserStore.getUser.bind(UserStore);

    UserStore.getCurrentUser = () => {
        const user = origGetCurrentUser();
        if (!user || !settings.store.enabled) return user;
        return withLarpUser(user) ?? user;
    };

    UserStore.getUser = (userId: string) => {
        const user = origGetUser(userId);
        if (!user || !settings.store.enabled) return user;
        return withLarpUser(user) ?? user;
    };

    unpatchFns.push(() => {
        UserStore.getCurrentUser = origGetCurrentUser;
        UserStore.getUser = origGetUser;
    });
}

function patchAccountSettingsStore(AccountStore: {
    getSettings: () => { userId?: string; username?: string; } | null;
}) {
    const origGetSettings = AccountStore.getSettings.bind(AccountStore);

    AccountStore.getSettings = () => {
        const accountSettings = origGetSettings();
        if (!accountSettings?.userId || accountSettings.userId !== getCurrentUserId()) {
            return accountSettings;
        }

        const custom = getCustomName();
        if (!custom || accountSettings.username === custom) return accountSettings;

        return { ...accountSettings, username: custom };
    };

    unpatchFns.push(() => {
        AccountStore.getSettings = origGetSettings;
    });
}

function patchAccountSettingsStoreLoader() {
    waitFor(
        filters.byCode("USER_SETTINGS_MODAL_OPEN", "getSettings"),
        patchAccountSettingsStore
    );
}

function patchUsernameUtils() {
    const origGetUserTag = UsernameUtils.getUserTag.bind(UsernameUtils);
    const origUseUserTag = UsernameUtils.useUserTag;

    UsernameUtils.getUserTag = (user: User, options?: Parameters<typeof UsernameUtils.getUserTag>[1]) => {
        const spoofed = withLarpUser(user) ?? user;
        return swapUsernameTag(user, origGetUserTag(spoofed, options));
    };

    UsernameUtils.useUserTag = (user: User, options?: Parameters<typeof UsernameUtils.useUserTag>[1]) => {
        const spoofed = withLarpUser(user) ?? user;
        return swapUsernameTag(user, origUseUserTag(spoofed, options));
    };

    unpatchFns.push(() => {
        UsernameUtils.getUserTag = origGetUserTag;
        UsernameUtils.useUserTag = origUseUserTag;
    });
}



export default definePlugin({
    name: "Larp Tool",
    description: "Spoof badges, decorations, and @username locally. Ctrl+B to toggle.",
    authors: [{ name: "allbadges", id: 0n }],
    enabledByDefault: true,
    settings,

    patches: [
        {
            find: "#{intl::PROFILE_USER_BADGES}",
            all: true,
            replacement: [
                {
                    match: /(\i)\.getBadges\(\)\.map/,
                    replace: "$self.mergeLarpDisplayBadges($1,$1.getBadges()).map"
                },
                {
                    match: /(\i)\.getBadges\(\)\?\.map/,
                    replace: "$self.mergeLarpDisplayBadges($1,$1.getBadges()??[]).map"
                },
                {
                    match: /(\i)\.getBadges\(\)(?!\.)/,
                    replace: "$self.mergeLarpDisplayBadges($1,$1.getBadges())"
                },
                {
                    match: /src:(\i)\.iconSrc/,
                    replace: "src:$self.getBadgeIconSrc($1)"
                },
            ],
        },
        {
            find: '"UserProfilePopout");',
            replacement: [
                {
                    match: /userId:(\i)/,
                    replace: 'userId:$1,"data-user-id":$1'
                },
                {
                    match: /user:(\i),/,
                    replace: "user:$self.withLarpUser($1),"
                },
            ],
        },
        {
            find: ".USER_MENTION)",
            replacement: {
                match: /children:`@\$\{(\i\?\?\i)\}`(?<=\.useName\((\i)\).+?)/,
                replace: "children:$self.renderMentionUsername({username:$1,user:$2})"
            }
        },
        {
            find: 'userId:e.id,username:e.username,discriminator:e.discriminator,email:e.email,avatar:e.avatar,password:""',
            replacement: {
                match: /username:e\.username/,
                replace: "username:$self.getAccountSettingsUsername(e)"
            }
        },
        {
            find: "#{intl::ACCOUNT_USERNAME}",
            replacement: {
                match: /(?<=children:)(\i)\.username/,
                replace: "$self.getAccountSettingsUsername($1)"
            }
        },
        {
            find: "isAvatarDecorationAnimating:",
            group: true,
            replacement: [
                {
                    match: /(?<=\.avatarDecoration,guildId:\i\}\)\),)(?<=user:(\i).+?)/,
                    replace: "vcLarpAvatarDecoration=$self.useLarpAvatarDecoration($1),"
                },
                {
                    match: /(?<={avatarDecoration:).{1,20}?(?=,)(?<=avatarDecorationOverride:(\i).+?)/,
                    replace: "$self.resolveLarpAvatarDecorationValue(vcLarpAvatarDecoration,$1??($&))"
                },
                {
                    match: /(?<=size:\i}\),\[)/,
                    replace: "vcLarpAvatarDecoration,"
                }
            ]
        },
        {
            find: "80,onlyAnimateOnHoverOrFocus:!",
            replacement: [
                {
                    match: /(?<=\i\.PURCHASE)(?=,)(?<=avatarDecoration:(\i).+?)/,
                    replace: "||$self.isLarpOwnedAvatarDecoration($1)"
                },
                {
                    match: /(?<=\i\.PURCHASE)(?=,)(?<=profileEffect:(\i).+?)/,
                    replace: "||$self.isLarpOwnedProfileEffect($1)"
                },
                {
                    match: /(?<=\i\.PURCHASE)(?=,)(?<=nameplate:(\i).+?)/,
                    replace: "||$self.isLarpOwnedNameplate($1)"
                },
            ]
        },
        {
            find: "(0,a.WK)(o?.collectibles?.nameplate)??t.nameplate",
            replacement: {
                match: /\(0,(\i)\.WK\)\((\i)\?\.collectibles\?\.nameplate\)\?\?(\i)\.nameplate/,
                replace: "($self.resolveRenderedNameplate($3,$2,$1.WK))"
            }
        },
        {
            find: "if(null==e)return;let t=a.A.getProduct(e);if((0,l.C3)(t?.items[0]))return t.items[0]",
            replacement: {
                match: /if\(null==(\i)\)return;let (\i)=(\i)\.A\.getProduct\(\1\);if\(\(0,(\i)\.C3\)\((\2)\?\.items\[0\]\)\)return \5\.items\[0\]/,
                replace: "if(null==$1)return;let vcLarpProfileEffect=$self.getLarpProfileEffectItemBySkuId($1);if(vcLarpProfileEffect)return vcLarpProfileEffect;let $2=$3.A.getProduct($1);if((0,$4.C3)($5?.items[0]))return $5.items[0]"
            }
        },
        {
            find: ".DISPLAY_NAME_STYLES_COACHMARK)",
            replacement: {
                match: /(?<=\i\)\({avatarDecoration:)\i(?=,)(?<=currentUser:(\i).+?)/,
                replace: "$self.pickLarpAvatarDecoration($1,$&)"
            }
        },
        ...[
            "#{intl::GUILD_COMMUNICATION_DISABLED_ICON_TOOLTIP_BODY}",
            "#{intl::COLLECTIBLES_PROFILE_PREVIEW_A11Y}",
        ].map(find => ({
            find,
            replacement: {
                match: /(?<=userValue:)((\i(?:\.author)?)\?\.avatarDecoration)/,
                replace: "$self.pickLarpAvatarDecoration($2,$1)"
            }
        })),
        {
            find: "#{intl::COLLECTIBLES_NAMEPLATE_PREVIEW_A11Y}",
            replacement: {
                match: /(?<=userValue:)((\i(?:\.author)?)\?\.nameplate)/,
                replace: "$self.pickLarpNameplateUserValue($2,$1)"
            }
        },
        {
            find: "#{intl::USER_PROFILE_MEMBER_SINCE}",
            replacement: {
                match: /extractTimestamp\((\i)(?:\.id)?\)/,
                replace: "$self.getLarpCreatedAt($self.resolveSnowflakeUserId($1),extractTimestamp($1))"
            }
        },
    ],

    withCustomUsernameOnly,
    withLarpUser,
    useLarpAvatarDecoration,
    resolveLarpAvatarDecorationValue,
    pickLarpAvatarDecoration,
    useLarpProfileEffect,
    useLarpNameplate,
    applyLarpNameplateOverride,
    resolveRenderedNameplate,
    resolveRenderedProfileEffect,
    pickLarpNameplateUserValue,
    isLarpOwnedAvatarDecoration,
    isLarpOwnedProfileEffect,
    isLarpOwnedNameplate,
    getLarpAvatarDecoration,
    getLarpProfileEffect,
    getLarpProfileEffectItemBySkuId,
    getLarpNameplate,
    getLarpNameplateProduct,
    getLarpCreatedAt,
    resolveSnowflakeUserId,
    filterBadges,
    mergeLarpDisplayBadges,
    getCurrentUserId,
    getAccountSettingsUsername,
    getRealUsername,
    swapRealUsernameInText,
    wrapMessageForDisplay,
    mapEmbed,
    getBadgeIconSrc(badge: { userId?: string; id?: string; key?: string; icon?: string; iconSrc?: string; }) {
        const transparent = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        // Require an explicit owner match — never use a global "last profile" fallback,
        // or hiding your badge also blanks the same icon on everyone else's profile.
        if (settings.store.enabled && badge.userId === getCurrentUserId() && isBadgeHiddenObject(badge)) {
            return transparent;
        }
        if (badge.iconSrc) return badge.iconSrc;
        const hash = getBadgeIconHash(badge);
        if (hash) return `https://cdn.discordapp.com/badge-icons/${hash}.png?size=96`;
        const id = getBadgeKey(badge) ?? badge.id ?? badge.key ?? "";
        return resolveBadgeIcon(id, badge.icon);
    },

    renderMentionUsername: ErrorBoundary.wrap(({ username, user }: { username: string; user: User; }) => {
        if (user?.id === getCurrentUserId()) {
            const custom = getCustomName();
            if (custom) return <>{`@${custom}`}</>;
        }
        return <>{`@${username}`}</>;
    }, { noop: true }),

    toolboxActions: {
        "Open Larp Tool": openBadgeManager,
    },

    start() {
        getCurrentUserId();
        refreshCustomJoinDateCache();
        larpNameplateReady = !settings.store.larpNameplate?.skuId || !!settings.store.larpNameplate?.asset;
        larpProfileEffectReady = !settings.store.larpProfileEffect?.skuId;

        try {
            MediaResolver = findByPropsLazy("getAvatarDecorationURL", "getUserAvatarURL");
        } catch { }
        try {
            CollectiblesAssets = findByPropsLazy("getCollectiblesItemAssetUrl", "CollectiblesItemAssetFormat");
        } catch { }

        const syncLarpProfileEffectFromSettings = () => {
            const effect = settings.store.larpProfileEffect;
            if (effect?.skuId) {
                registerParsedProfileEffectProduct(
                    effect.skuId,
                    effect.title ?? "Profile effect",
                    effect as Record<string, unknown>,
                );
            }
        };

        waitFor(
            filters.byCode("staticFrameSrc=e.staticFrameSrc}static fromServer(e){return new l({"),
            (mod: { Ay?: typeof ProfileEffectClass; default?: typeof ProfileEffectClass; }) => {
                ProfileEffectClass = (mod.Ay ?? mod.default ?? mod) as typeof ProfileEffectClass;
                syncLarpProfileEffectFromSettings();
            },
        );
        // Discord renames this often — keep a looser fallback finder
        waitFor(
            filters.byCode("staticFrameSrc", "fromServer"),
            (mod: { Ay?: typeof ProfileEffectClass; default?: typeof ProfileEffectClass; fromServer?: (body: unknown) => unknown; }) => {
                if (ProfileEffectClass) return;
                const candidate = (mod.Ay ?? mod.default ?? mod) as typeof ProfileEffectClass;
                if (typeof (candidate as { fromServer?: unknown; })?.fromServer === "function"
                    || typeof (candidate as { Ay?: { fromServer?: unknown; }; })?.Ay?.fromServer === "function") {
                    ProfileEffectClass = candidate;
                    syncLarpProfileEffectFromSettings();
                }
            },
        );

        waitFor(
            filters.byCode("bundledProducts:_?.map(s.A.fromServer),previewAssets:null!=h"),
            (mod: { A?: typeof CollectiblesProductParser; default?: typeof CollectiblesProductParser; }) => {
                CollectiblesProductParser = (mod.A ?? mod.default ?? mod) as typeof CollectiblesProductParser;
                CollectiblesProductClass = CollectiblesProductParser as typeof CollectiblesProductClass;
            },
        );

        ensureLarpDecorationProductsFromSettings();
        try { patchCollectiblesProductLookup(); } catch (e) { console.warn("larp: collectibles product patch", e); }

        document.addEventListener("keydown", handleKeyDown, true);
        try { patchUserStore(); } catch (e) { console.warn("larp: user store patch", e); }
        try { patchUserCreatedAt(); } catch (e) { console.warn("larp: user createdAt patch", e); }
        try { patchSnowflakeExtractTimestamp(); } catch (e) { console.warn("larp: snowflake extractTimestamp patch", e); }
        try { patchMessageStore(); } catch (e) { console.warn("larp: message store patch", e); }
        try { patchParser(); } catch (e) { console.warn("larp: parser patch", e); }
        refreshCachedUsername();
        FluxDispatcher.subscribe("USER_UPDATE", refreshCachedUsername);
        unpatchFns.push(() => FluxDispatcher.unsubscribe("USER_UPDATE", refreshCachedUsername));

        try { patchAccountSettingsStoreLoader(); } catch {}
        try { patchUserProfileStore(); } catch (e) { console.warn(e); }
        try { patchDisplayProfileUtils(); } catch {}
        try { patchDisplayProfile(); } catch (e) { console.warn("display profile patch", e); }
        try { patchProfileDomScope(); } catch {}
        try { patchUsernameUtils(); } catch {}

        const onConnectionOpen = () => {
            void hydrateLarpProductsFromApi().then(() => {
                if (needsProfileRefreshOnLoad()) {
                    triggerProfileRefresh();
                }
            });
        };
        FluxDispatcher.subscribe("CONNECTION_OPEN", onConnectionOpen);
        unpatchFns.push(() => FluxDispatcher.unsubscribe("CONNECTION_OPEN", onConnectionOpen));

        updateHiddenBadgeStyles();

        void hydrateLarpProductsFromApi().then(() => {
            if (needsProfileRefreshOnLoad()) {
                triggerProfileRefresh();
            }
        });
    },

    stop() {
        if (profileRefreshTimer) clearTimeout(profileRefreshTimer);
        closeBadgeManager();
        document.removeEventListener("keydown", handleKeyDown, true);
        document.getElementById(HIDDEN_BADGE_STYLE_ID)?.remove();
        document.getElementById(TAB_ANIM_STYLE_ID)?.remove();
        for (const fn of unpatchFns.splice(0)) fn();
    },
});
