import type { Database } from "@otto/db";
import { createSecret, deleteSecret, readSecret } from "@otto/secrets/server";
import { DomainError, parseInput, required } from "@otto/shared";
import {
  advanceCursor,
  type Context,
  inWorkspace,
  requireHuman,
  requireWriter,
} from "@otto/workspaces";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { disconnectSubscription, getSubscription } from "./index";
import {
  MODEL_ID,
  type NativeModelConfig,
  PROVIDER_CONFIG,
} from "./native-provider-config";
import { createProviderFetch } from "./native-provider-http";
import { createNativeModel } from "./native-provider-model";
import { subscriptions } from "./schema";

export type { NativeModelConfig } from "./native-provider-config";
export const SUBSCRIPTION_API_KEY = z
  .object({
    apiKey: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict();

async function privateSubscription(c: Context, id: string) {
  await getSubscription(c, id);
  return required(
    (
      await c.tx.select().from(subscriptions).where(eq(subscriptions.id, id))
    )[0],
  );
}

export async function setSubscriptionApiKey(
  c: Context,
  id: string,
  input: z.infer<typeof SUBSCRIPTION_API_KEY>,
  key: Uint8Array,
) {
  requireHuman(c);
  requireWriter(c);
  const row = await privateSubscription(c, id);
  if (
    row.createdBy !== c.actor.userId ||
    row.status === "disconnected" ||
    row.provider === "codex"
  )
    throw new DomainError("forbidden", "Provider unavailable");
  const parsed = parseInput(SUBSCRIPTION_API_KEY, input);
  const secretId = await createSecret(c, `Provider ${id}`, parsed.apiKey, key);
  await c.tx
    .update(subscriptions)
    .set({ secretId, status: "enabled", updatedAt: new Date() })
    .where(eq(subscriptions.id, id));
  if (row.secretId) await deleteSecret(c, row.secretId);
  await advanceCursor(c);
  return getSubscription(c, id);
}

export async function disconnectNativeSubscription(c: Context, id: string) {
  requireHuman(c);
  requireWriter(c);
  const row = await privateSubscription(c, id);
  if (row.createdBy !== c.actor.userId) throw new DomainError("forbidden");
  await disconnectSubscription(c, id);
  await c.tx
    .update(subscriptions)
    .set({ secretId: null })
    .where(eq(subscriptions.id, id));
  if (row.secretId) await deleteSecret(c, row.secretId);
  return getSubscription(c, id);
}

export async function authorizeSubscriptionModel(
  c: Context,
  id: string,
  model: string,
): Promise<{ accountId: string; modelConfig: NativeModelConfig }> {
  requireWriter(c);
  const row = await privateSubscription(c, id);
  const parsed = PROVIDER_CONFIG.safeParse({
    provider: row.provider,
    protocol: row.protocol,
    baseUrl: row.provider === "openai-compatible" ? row.baseUrl : undefined,
    models: row.models,
  });
  if (
    !parsed.success ||
    row.status !== "enabled" ||
    !row.secretId ||
    !row.baseUrl ||
    !MODEL_ID.safeParse(model).success ||
    !row.models.includes(model)
  )
    throw new DomainError("forbidden", "Provider or model unavailable");
  const expectedUrl =
    row.provider === "openai"
      ? "https://api.openai.com/v1"
      : row.provider === "anthropic"
        ? "https://api.anthropic.com/v1"
        : row.baseUrl;
  if (row.baseUrl !== expectedUrl)
    throw new DomainError("forbidden", "Provider endpoint changed");
  return {
    accountId: row.secretId,
    modelConfig: {
      id: model,
      provider: parsed.data.provider,
      protocol: parsed.data.protocol,
      baseUrl: row.baseUrl,
    },
  };
}

export type AcceptedSubscriptionModel = {
  workspaceId: string;
  sponsorId: string;
  subscriptionId: string;
  accountId: string;
  model: string;
  modelConfig: NativeModelConfig;
};

export async function resolveSubscriptionModel(
  db: Database,
  accepted: AcceptedSubscriptionModel,
  key: Uint8Array,
  signal: AbortSignal,
) {
  async function authorize(c: Context) {
    const current = await authorizeSubscriptionModel(
      c,
      accepted.subscriptionId,
      accepted.model,
    );
    if (
      current.accountId !== accepted.accountId ||
      Object.entries(current.modelConfig).some(
        ([field, value]) =>
          accepted.modelConfig[field as keyof NativeModelConfig] !== value,
      )
    )
      throw new DomainError("forbidden", "Accepted provider identity changed");
    return current;
  }
  const apiKey = await inWorkspace(
    db,
    accepted.workspaceId,
    { userId: accepted.sponsorId },
    async (c) => {
      const current = await authorize(c);
      return readSecret(c, current.accountId, key);
    },
    false,
  );
  const fetch = createProviderFetch(accepted.modelConfig, signal, async () => {
    await inWorkspace(
      db,
      accepted.workspaceId,
      { userId: accepted.sponsorId },
      authorize,
      false,
    );
  });
  return createNativeModel(accepted.modelConfig, apiKey, fetch);
}
