import { describe, expect, it } from "vite-plus/test";

import { failureDetail } from "./Policy.ts";

describe("failureDetail", () => {
  it("keeps the network cause and API host a failed fetch would otherwise drop", () => {
    const cause = Object.assign(new Error(""), { code: "ConnectionRefused" });

    // The shape of the AI SDK's APICallError for a fetch that never reached the provider.
    const error = Object.assign(new Error("Cannot connect to API: ", { cause }), {
      url: "https://api.openai.com/v1/responses?key=secret",
    });

    expect(failureDetail(error)).toBe("Cannot connect to API: ConnectionRefused (api.openai.com)");
  });

  it("does not repeat a cause message already in the error's own message", () => {
    const error = new Error("Cannot connect to API: socket hang up", {
      cause: new Error("socket hang up"),
    });

    expect(failureDetail(error)).toBe("Cannot connect to API: socket hang up");
  });

  it("leaves a plain error message unchanged", () => {
    expect(failureDetail(new Error("Model refused the request."))).toBe(
      "Model refused the request.",
    );
  });
});
