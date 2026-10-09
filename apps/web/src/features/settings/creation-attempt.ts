/** Creation has no server idempotency key: an unknown outcome must not be replayed. */
export function createSettingsAttempt() {
  let outcome: "ready" | "created" | "uncertain" = "ready";
  return {
    get blocked() {
      return outcome !== "ready";
    },
    reset() {
      // Only an acknowledged creation whose form completed may start a new one.
      if (outcome === "created") outcome = "ready";
    },
    async send<R extends { ok: boolean; status: number }, T>(
      request: () => Promise<R>,
      decode: (response: R) => Promise<T>,
    ): Promise<T> {
      if (outcome !== "ready")
        throw new Error(
          "Creation cannot be repeated. Close this dialog and check the current records before starting new work.",
        );
      outcome = "uncertain";
      try {
        const response = await request();
        // A definite client rejection is safe to correct. Server/transport errors
        // can occur after a commit; successful headers still need a decoded ACK.
        if (response.status >= 400 && response.status < 500) outcome = "ready";
        const record = await decode(response);
        outcome = "created";
        return record;
      } catch (cause) {
        if (outcome === "uncertain")
          throw new Error(
            "Unable to confirm creation. Check the current records; the request may already have created one.",
          );
        throw cause;
      }
    },
  };
}
