import { z } from "zod";

export const NATIVE_PROVIDER = z.enum([
  "openai",
  "anthropic",
  "openai-compatible",
]);
export const NATIVE_PROTOCOL = z.enum([
  "responses",
  "chat-completions",
  "anthropic",
]);
export const MODEL_ID = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);

export function providerBaseUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname.endsWith(".") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(url.hostname) ||
    !url.hostname.includes(".") ||
    /^[\d.]+$/.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(
      url.hostname,
    ) ||
    /%|\/\//.test(url.pathname)
  )
    throw new Error("Invalid provider endpoint");
  return url.href.replace(/\/+$/, "");
}

export const PROVIDER_CONFIG = z
  .object({
    provider: NATIVE_PROVIDER,
    protocol: NATIVE_PROTOCOL,
    baseUrl: z.string().max(2048).optional(),
    models: z
      .array(MODEL_ID)
      .min(1)
      .max(100)
      .refine((items) => new Set(items).size === items.length),
  })
  .superRefine((config, ctx) => {
    if ((config.provider === "anthropic") !== (config.protocol === "anthropic"))
      ctx.addIssue({ code: "custom", message: "Provider protocol mismatch" });
    if (config.provider !== "openai-compatible" && config.baseUrl !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "Official providers use their official endpoint",
      });
    if (config.provider === "openai-compatible") {
      try {
        providerBaseUrl(config.baseUrl ?? "");
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "A public HTTPS endpoint is required",
        });
      }
    }
  });

export type NativeModelConfig = {
  id: string;
  provider: z.infer<typeof NATIVE_PROVIDER>;
  protocol: z.infer<typeof NATIVE_PROTOCOL>;
  baseUrl: string;
};
