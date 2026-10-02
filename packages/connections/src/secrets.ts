import { DomainError } from "@otto/shared";

import { z } from "zod";
import { type HttpOptions, readJson, requestHttp } from "./http";

export interface SecretReference {
  workspaceId: string;
  connectionId: string;
  credentialRef: string;
}
/** Server-only, never returned by domain/transport getters. */
export interface SecretResolver {
  resolve(reference: SecretReference, signal: AbortSignal): Promise<string>;
}
export interface InfisicalBinding extends SecretReference {
  projectId: string;
  environment: string;
  secretPath: string;
  secretName: string;
}
/** Explicit deployment-approved bindings prohibit user-controlled project/path/name lookups. */
export function createInfisicalResolver(options: {
  endpoint: string;
  bindings: readonly InfisicalBinding[];
  getAccessToken: (signal: AbortSignal) => Promise<string>;
  http: HttpOptions;
}): SecretResolver {
  return {
    async resolve(reference, signal) {
      const binding = options.bindings.find(
        (item) =>
          item.workspaceId === reference.workspaceId &&
          item.connectionId === reference.connectionId &&
          item.credentialRef === reference.credentialRef,
      );
      if (!binding)
        throw new DomainError(
          "unavailable",
          "Credential scope is not configured",
        );
      const token = await options.getAccessToken(signal);
      const url = new URL(
        `/api/v4/secrets/${encodeURIComponent(binding.secretName)}`,
        options.endpoint,
      );
      url.search = new URLSearchParams({
        projectId: binding.projectId,
        environment: binding.environment,
        secretPath: binding.secretPath,
        type: "shared",
        viewSecretValue: "true",
        expandSecretReferences: "false",
        includeImports: "false",
      }).toString();
      const data = await requestHttp(
        url,
        { headers: { Authorization: `Bearer ${token}` }, signal },
        options.http,
        readJson,
      );
      const parsed = z
        .object({
          secret: z.object({ secretValue: z.string().min(1).max(65536) }),
        })
        .safeParse(data);
      if (!parsed.success)
        throw new DomainError("unavailable", "Credential unavailable");
      return parsed.data.secret.secretValue;
    },
  };
}
