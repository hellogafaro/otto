import type { LoginEvent } from "@otto/server/api";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import { settingsError } from "./controls";

import { consumeLoginEvents } from "./subscription-auth-stream";

/** Device authentication stays on the selected Subscription; abort closes that stream. */
export function useDeviceLogin(id: string) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [device, setDevice] = useState<
    | (Extract<LoginEvent, { type: "device_code" }> & { expiresAt: number })
    | null
  >(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState("");
  useEffect(
    () => () => {
      controller.current?.abort();
      // A remount (dev StrictMode) starts a fresh attempt; the aborted one must not block it.
      controller.current = null;
    },
    [],
  );
  const cancel = () => {
    controller.current?.abort();
    setDevice(null);
    setStatus(
      "Authentication cancelled. The account status is confirmed by the server.",
    );
  };
  const start = async () => {
    if (controller.current) return;
    const attempt = new AbortController();
    controller.current = attempt;
    setPending(true);
    setError(null);
    setDevice(null);
    setStatus("Waiting for a device code");
    let expiry: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await api.subscriptions[":id"].login.$post(
        { param: { workspaceId, id } },
        { init: { signal: attempt.signal } },
      );
      if (!response.ok) throw new ApiError(response.status, "login_failed");
      if (
        !response.headers
          .get("content-type")
          ?.startsWith("application/x-ndjson") ||
        !response.body
      )
        throw new Error(
          "The account service returned an invalid authentication stream.",
        );
      await consumeLoginEvents(response.body, async (event) => {
        if (attempt.signal.aborted)
          throw new DOMException("Authentication cancelled", "AbortError");
        if (event.type === "device_code") {
          setDevice({
            ...event,
            expiresAt: Date.now() + event.expiresInSeconds * 1000,
          });
          setStatus("Complete authentication in the verification page");
          expiry = setTimeout(() => {
            setError(
              new Error("The device code expired. Start authentication again."),
            );
            setStatus("");
            attempt.abort();
          }, event.expiresInSeconds * 1000);
        } else if (event.type === "connected") {
          clearTimeout(expiry);
          setDevice(null);
          setStatus("Authentication confirmed by the server");
          await invalidate();
        }
      });
    } catch (cause) {
      if (!attempt.signal.aborted) {
        setError(settingsError(cause));
        setStatus("");
      }
    } finally {
      clearTimeout(expiry);
      if (controller.current === attempt) {
        controller.current = null;
        setPending(false);
        setDevice(null);
        await invalidate();
      }
    }
  };
  return { pending, device, error, status, start, cancel };
}
