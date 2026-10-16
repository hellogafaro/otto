import { isAccountLimitMessage } from "./account-limits.ts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import type * as Clock from "effect/Clock";
import { type SubscriptionCredentialStore } from "./credential-store.ts";
import { SubscriptionHealthService, fileVersion } from "./health-service.ts";
import {
  accountIdForKey,
  defaultInstanceByProvider,
  SUBSCRIPTION_PROVIDER_IDS,
  type RequestHealthStatus,
  accountScope,
  credentialAt,
  credentialKey,
  DEFAULT_ACCOUNT_ID,
  isDefaultScope,
  isSubscriptionProviderId,
  type SubscriptionProviderId,
} from "./service-types.ts";

const SERVED_BY_THREAD_CAP = 512;

type ProviderAccountLists = Partial<Record<SubscriptionProviderId, string[]>>;

/** The key a provider resolves to when every linked account is turned off: no credential lives there. */
function pausedProviderKey(provider: SubscriptionProviderId): string {
  return `paused:${provider}`;
}

export class SubscriptionAccountState {
  private readonly orderPath: string;
  private readonly pausedPath: string;
  private accountOrder: ProviderAccountLists = {};
  private pausedAccounts: ProviderAccountLists = {};
  private pausedVersion: string | undefined;
  readonly lastServedKey = new Map<SubscriptionProviderId, string>();
  private readonly servedByThread = new Map<string, string>();
  private orderVersion: string | undefined;
  private readonly store: SubscriptionCredentialStore;
  private readonly healthService: SubscriptionHealthService;
  private readonly clock: Clock.Clock;
  private readonly reload: () => Effect.Effect<void>;
  constructor(
    store: SubscriptionCredentialStore,
    healthService: SubscriptionHealthService,
    clock: Clock.Clock,
    reload: () => Effect.Effect<void>,
  ) {
    this.store = store;
    this.healthService = healthService;
    this.clock = clock;
    this.reload = reload;
    this.orderPath = `${store.path}.accounts`;
    this.pausedPath = `${store.path}.paused`;
    this.reloadAccountOrder();
    this.reloadPausedAccounts();
  }
  private get data() {
    return this.store.current().data;
  }
  private get health() {
    return this.healthService.health;
  }
  private reloadAsync() {
    return Effect.runPromise(this.reload());
  }
  /** Account ids per provider from a JSON file, or none when it is missing or unreadable. */
  private readAccountLists(filePath: string): ProviderAccountLists {
    try {
      const parsed = this.healthService.readAccountOrder(filePath);
      const lists: ProviderAccountLists = {};

      if (!Predicate.isObjectKeyword(parsed)) return lists;

      for (const [provider, ids] of Object.entries(parsed)) {
        if (isSubscriptionProviderId(provider) && Array.isArray(ids))
          lists[provider] = ids.filter((id): id is string => Predicate.isString(id));
      }

      return lists;
    } catch {
      return {};
    }
  }

  reloadAccountOrder(): void {
    this.orderVersion = fileVersion(this.orderPath);
    this.accountOrder = this.readAccountLists(this.orderPath);
  }

  private reloadPausedAccounts(): void {
    this.pausedVersion = fileVersion(this.pausedPath);
    this.pausedAccounts = this.readAccountLists(this.pausedPath);
  }

  private saveAccountOrder(provider: SubscriptionProviderId, accountIds: string[]): void {
    this.reloadAccountOrder();
    this.accountOrder[provider] = accountIds;
    this.healthService.writeSecureJson(this.orderPath, this.accountOrder);
    this.orderVersion = fileVersion(this.orderPath);
  }

  /** Picks up an order or health change another service instance wrote, such as a reorder from Settings. */
  refreshAccountState(): void {
    if (fileVersion(this.orderPath) !== this.orderVersion) this.reloadAccountOrder();

    if (fileVersion(this.pausedPath) !== this.pausedVersion) this.reloadPausedAccounts();

    if (fileVersion(this.healthService.healthPath) !== this.healthService.healthVersion)
      this.healthService.reloadHealth();
  }

  /** Signed-in account ids for a provider, in priority order. */
  linkedAccountIds(provider: SubscriptionProviderId): string[] {
    const present: string[] = [];

    if (credentialAt(this.data, provider)) present.push(DEFAULT_ACCOUNT_ID);

    for (const key of Object.keys(this.data).toSorted()) {
      const accountId = accountIdForKey(provider, key);

      if (accountId && accountId !== DEFAULT_ACCOUNT_ID && credentialAt(this.data, key))
        present.push(accountId);
    }

    const stored = (this.accountOrder[provider] ?? []).filter((id) => present.includes(id));

    return [...new Set(stored), ...present.filter((id) => !stored.includes(id))];
  }

  /** True when Settings turned this linked account off, so requests skip it. */
  accountPaused(provider: SubscriptionProviderId, accountId: string): boolean {
    return this.pausedAccounts[provider]?.includes(accountId) ?? false;
  }

  /** True when the provider has linked accounts and every one of them is turned off. */
  allAccountsPaused(provider: SubscriptionProviderId): boolean {
    const linked = this.linkedAccountIds(provider);

    return linked.length > 0 && linked.every((id) => this.accountPaused(provider, id));
  }

  /** Turns a linked account off or back on. Ids that are not linked are ignored. */
  async setAccountPaused(
    provider: SubscriptionProviderId,
    accountId: string,
    paused: boolean,
  ): Promise<void> {
    await this.reloadAsync();
    this.reloadPausedAccounts();
    const linked = this.linkedAccountIds(provider);

    const others = (this.pausedAccounts[provider] ?? []).filter(
      (id) => id !== accountId && linked.includes(id),
    );

    this.pausedAccounts[provider] =
      paused && linked.includes(accountId) ? [...others, accountId] : others;

    this.healthService.writeSecureJson(this.pausedPath, this.pausedAccounts);
    this.pausedVersion = fileVersion(this.pausedPath);
  }

  /** False while an account sits out a limit or its sign-in was rejected. */
  accountReady(key: string, now: number): boolean {
    const health = this.health[key];

    if (!health) return true;

    if (health.nextRetryAt && Date.parse(health.nextRetryAt) > now) return false;

    const failedLast =
      health.lastFailedRequest !== undefined &&
      (health.lastSuccessfulRequestAt === undefined ||
        health.lastFailedRequest.at >= health.lastSuccessfulRequestAt);

    return !(failedLast && health.failureKind === "revoked");
  }

  /**
   * The credential key default-scope requests use: the first linked account that
   * is on and ready, else the first one that is on so its error still surfaces.
   * With every account turned off it resolves to a key that holds no credential.
   */
  activeAccountKey(
    provider: SubscriptionProviderId,
    now = this.clock.currentTimeMillisUnsafe(),
  ): string {
    this.refreshAccountState();
    const linked = this.linkedAccountIds(provider);

    const keys = linked
      .filter((id) => !this.accountPaused(provider, id))
      .map((id) => credentialKey(provider, accountScope(id)));

    if (linked.length > 0 && keys.length === 0) return pausedProviderKey(provider);

    return keys.find((key) => this.accountReady(key, now)) ?? keys[0] ?? provider;
  }

  /** The key a read resolves to. Default-scope reads follow the account order. */
  liveKey(provider: SubscriptionProviderId, scope?: string): string {
    return isDefaultScope(provider, scope)
      ? this.activeAccountKey(provider)
      : credentialKey(provider, scope);
  }

  /**
   * `liveKey` for a request about to be sent, remembered so its outcome is recorded there.
   * A `threadId` keeps concurrent turns on different accounts from claiming each other's outcomes.
   */
  servingKey(provider: SubscriptionProviderId, scope?: string, threadId?: string): string {
    const key = this.liveKey(provider, scope);

    if (!isDefaultScope(provider, scope)) return key;
    this.lastServedKey.set(provider, key);

    if (threadId !== undefined) {
      const slot = `${provider}:${threadId}`;
      this.servedByThread.delete(slot);
      this.servedByThread.set(slot, key);

      if (this.servedByThread.size > SERVED_BY_THREAD_CAP) {
        const oldest = this.servedByThread.keys().next().value;

        if (oldest !== undefined) this.servedByThread.delete(oldest);
      }
    }

    return key;
  }

  /** The key a request outcome belongs to: the account that thread's request used. */
  outcomeKey(provider: SubscriptionProviderId, scope?: string, threadId?: string): string {
    if (!isDefaultScope(provider, scope)) return credentialKey(provider, scope);

    const served =
      threadId === undefined ? undefined : this.servedByThread.get(`${provider}:${threadId}`);

    return served ?? this.lastServedKey.get(provider) ?? this.activeAccountKey(provider);
  }

  /** Keeps a newly signed-in account at the end of the order. */
  rememberAccountOrder(provider: SubscriptionProviderId): void {
    this.reloadAccountOrder();
    this.saveAccountOrder(provider, this.linkedAccountIds(provider));
  }

  /** Reorder linked accounts. Ids that are not linked are ignored; missing ones keep their place at the end. */
  async setAccountOrder(
    provider: SubscriptionProviderId,
    accountIds: ReadonlyArray<string>,
  ): Promise<void> {
    await this.reloadAsync();
    this.reloadAccountOrder();
    const linked = this.linkedAccountIds(provider);
    const ordered = [...new Set(accountIds.filter((id) => linked.includes(id)))];
    this.saveAccountOrder(provider, [...ordered, ...linked.filter((id) => !ordered.includes(id))]);
  }
  providerInstanceRequestHealth(instanceId: string): RequestHealthStatus | undefined {
    const health = this.healthService.requestHealth(`provider:${instanceId}`);

    const provider = SUBSCRIPTION_PROVIDER_IDS.find(
      (candidate) => defaultInstanceByProvider[candidate] === instanceId,
    );

    // An account limit does not block the provider once a linked account is ready.
    if (
      provider &&
      health?.lastFailedRequest &&
      (health.health === "failed" || health.health === "failed-first-request") &&
      isAccountLimitMessage(health.lastFailedRequest.message) &&
      // Only a limit an account actually recorded can be routed around.
      this.linkedAccountIds(provider).some((id) => {
        const failure = this.health[credentialKey(provider, accountScope(id))]?.lastFailedRequest;

        return failure !== undefined && isAccountLimitMessage(failure.message);
      }) &&
      this.accountReady(this.activeAccountKey(provider), this.clock.currentTimeMillisUnsafe())
    ) {
      return undefined;
    }

    return health;
  }
}
