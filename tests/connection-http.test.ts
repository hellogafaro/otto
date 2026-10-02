import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_BYTES,
  ProviderError,
  readText,
} from "../packages/connections/src/http";

describe("bounded provider body cleanup", () => {
  it("retains the output-limit failure when cancelling the provider body also fails", async () => {
    const cleanup = new Error("controlled cancellation failure");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_OUTPUT_BYTES + 1));
        },
        cancel() {
          throw cleanup;
        },
      }),
    );
    await expect(readText(response)).rejects.toMatchObject({
      name: "AggregateError",
      errors: [expect.any(ProviderError), cleanup],
    });
    expect(response.body?.locked).toBe(false);
  });
  it("propagates stream read failure and releases the reader rather than returning partial data", async () => {
    const failure = new Error("controlled provider disconnection");
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(failure);
        },
      }),
    );
    await expect(readText(response)).rejects.toMatchObject({
      name: "AggregateError",
      errors: [failure, failure],
    });
    expect(response.body?.locked).toBe(false);
  });
});
