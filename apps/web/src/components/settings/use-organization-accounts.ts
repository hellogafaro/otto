import { useCallback, useEffect, useMemo, useState } from "react";
import * as Option from "effect/Option";
import {
  createOrganizationAccountsClient,
  getOrganizationAccountState,
} from "@otto/client-runtime/authorization";
import type { OrganizationAccountState } from "@otto/contracts";
import { useSettingsEnvironmentId } from "~/settings-dialog-store";
import { usePreparedConnection } from "~/state/session";

export function useOrganizationAccounts() {
  const environmentId = useSettingsEnvironmentId();
  const prepared = usePreparedConnection(environmentId);
  const baseURL = Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
  const token = Option.isSome(prepared) ? prepared.value.httpAuthorization?.token : undefined;
  const client = useMemo(
    () => (baseURL ? createOrganizationAccountsClient(baseURL, token) : null),
    [baseURL, token],
  );
  const [loaded, setLoaded] = useState<{ baseURL: string; state: OrganizationAccountState } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!baseURL) return;
    const state = await getOrganizationAccountState(baseURL, token);
    setLoaded({ baseURL, state });
    setError(null);
  }, [baseURL, token]);

  useEffect(() => {
    if (!baseURL) return;
    let cancelled = false;
    void getOrganizationAccountState(baseURL, token)
      .then((state) => {
        if (!cancelled) {
          setLoaded({ baseURL, state });
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load organization account settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [baseURL, token]);

  return {
    baseURL,
    client,
    state: loaded?.baseURL === baseURL ? (loaded?.state ?? null) : null,
    error,
    refresh,
  };
}
