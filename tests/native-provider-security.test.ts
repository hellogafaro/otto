import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../packages/secrets/src/server";
import { SUBSCRIPTION_INPUT } from "../packages/subscriptions/src";
import {
  type NativeModelConfig,
  PROVIDER_CONFIG,
  providerBaseUrl,
} from "../packages/subscriptions/src/native-provider-config";
import {
  isPublicProviderAddress,
  providerRequestUrl,
} from "../packages/subscriptions/src/native-provider-http";

describe("native provider credential integrity", () => {
  it("encrypts with fresh nonces and authenticates the key, ciphertext and owning secret ID", () => {
    const key = randomBytes(32);
    const id = crypto.randomUUID();
    const first = encryptSecret("fixture-provider-key", id, key);
    expect(first).not.toContain("fixture-provider-key");
    expect(encryptSecret("fixture-provider-key", id, key)).not.toBe(first);
    expect(decryptSecret(first, id, key)).toBe("fixture-provider-key");
    expect(() => decryptSecret(first, crypto.randomUUID(), key)).toThrow(
      "Stored credential unavailable",
    );
    expect(() => decryptSecret(first, id, randomBytes(32))).toThrow(
      "Stored credential unavailable",
    );
    const damaged = Buffer.from(first, "base64");
    damaged[damaged.length - 1] = (damaged.at(-1) ?? 0) ^ 1;
    expect(() => decryptSecret(damaged.toString("base64"), id, key)).toThrow(
      "Stored credential unavailable",
    );
    expect(() => encryptSecret("fixture", id, randomBytes(31))).toThrow(
      "Encryption key unavailable",
    );
  });
  it("requires explicit protocol and bounded unique model IDs without legacy execution", () => {
    expect(
      SUBSCRIPTION_INPUT.safeParse({ title: "Old", provider: "codex" }).success,
    ).toBe(false);
    expect(
      PROVIDER_CONFIG.safeParse({ provider: "openai", models: ["gpt-fixture"] })
        .success,
    ).toBe(false);
    expect(
      PROVIDER_CONFIG.safeParse({
        provider: "openai",
        protocol: "anthropic",
        models: ["gpt-fixture"],
      }).success,
    ).toBe(false);
    expect(
      PROVIDER_CONFIG.safeParse({
        provider: "anthropic",
        protocol: "responses",
        models: ["claude-fixture"],
      }).success,
    ).toBe(false);
    expect(
      PROVIDER_CONFIG.safeParse({
        provider: "openai",
        protocol: "responses",
        baseUrl: "https://elsewhere.com/v1",
        models: ["gpt-fixture"],
      }).success,
    ).toBe(false);
    expect(
      PROVIDER_CONFIG.safeParse({
        provider: "openai-compatible",
        protocol: "responses",
        models: ["fixture"],
      }).success,
    ).toBe(false);
    expect(
      PROVIDER_CONFIG.safeParse({
        provider: "openai",
        protocol: "responses",
        models: ["same", "same"],
      }).success,
    ).toBe(false);
  });
});

describe("native provider endpoint boundary", () => {
  it.each([
    "http://api.vendor.com/v1",
    "https://127.0.0.1/v1",
    "https://2130706433/v1",
    "https://0x7f000001/v1",
    "https://[::1]/v1",
    "https://api.vendor.com:8443/v1",
    "https://user:pass@api.vendor.com/v1",
    "https://api.vendor.com/v1?key=credential",
    "https://api.vendor.com/v1#key",
    "https://api.vendor.com./v1",
    "https://metadata.google.internal/v1",
    "https://service.local/v1",
    "https://localhost/v1",
    "https://api.vendor.com/v1%2felsewhere",
  ])("rejects unsafe endpoint %s", (url) =>
    expect(() => providerBaseUrl(url)).toThrow(),
  );
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.100.100.200",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "not-an-address",
  ])("rejects nonpublic DNS address %s", (address) =>
    expect(isPublicProviderAddress(address)).toBe(false),
  );
  it("permits globally routable IPv4 and IPv6 only", () => {
    expect(isPublicProviderAddress("8.8.8.8")).toBe(true);
    expect(isPublicProviderAddress("2606:4700:4700::1111")).toBe(true);
  });
  it.each(["responses", "chat-completions", "anthropic"] as const)(
    "binds %s to exactly one path without query, origin or protocol fallback",
    (protocol) => {
      const config: NativeModelConfig = {
        id: "fixture",
        provider: protocol === "anthropic" ? "anthropic" : "openai-compatible",
        protocol,
        baseUrl: "https://api.vendor.com/v1",
      };
      const suffix =
        protocol === "responses"
          ? "/responses"
          : protocol === "chat-completions"
            ? "/chat/completions"
            : "/messages";
      expect(
        providerRequestUrl(config, `${config.baseUrl}${suffix}`).href,
      ).toBe(`${config.baseUrl}${suffix}`);
      for (const url of [
        `https://evil.com/v1${suffix}`,
        `${config.baseUrl}${suffix}?key=secret`,
        `${config.baseUrl}/models`,
        `${config.baseUrl}${suffix}/extra`,
      ])
        expect(() => providerRequestUrl(config, url)).toThrow(
          "Provider request endpoint mismatch",
        );
    },
  );
});
