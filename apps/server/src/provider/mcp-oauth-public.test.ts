import { describe, expect, it } from "vite-plus/test";

import { mcpOAuthHttpResponse } from "./mcp-oauth-http.ts";
import {
  ottoMcpOAuthClientDocument,
  ottoMcpOAuthIdentity,
} from "./mcp-oauth-public.ts";

describe("Otto MCP OAuth identity", () => {
  it("names the client Otto and follows the hosted origin", () => {
    const identity = ottoMcpOAuthIdentity("https://otto.example.com/");

    expect(identity).toEqual({
      clientName: "Otto",
      clientMetadataUrl: "https://otto.example.com/.well-known/oauth-client/otto.json",
      redirectUrl: "https://otto.example.com/oauth/mcp/callback",
      clientUri: "https://otto.example.com/",
    });
    expect(ottoMcpOAuthClientDocument(identity!).client_name).toBe("Otto");
    expect(ottoMcpOAuthClientDocument(identity!).redirect_uris).toEqual([
      "https://otto.example.com/oauth/mcp/callback",
    ]);
  });

  it("refuses a missing or non-https origin", () => {
    expect(ottoMcpOAuthIdentity(undefined)).toBeUndefined();
    expect(ottoMcpOAuthIdentity(null)).toBeUndefined();
    expect(ottoMcpOAuthIdentity("http://otto.example.com")).toBeUndefined();
  });

  it("serves an Otto client document for the hosted origin", async () => {
    const response = mcpOAuthHttpResponse(
      new URL("https://otto.example.com/.well-known/oauth-client/otto.json"),
      "https://otto.example.com",
    );

    expect(response).toBeInstanceOf(Response);
    expect(await (response as Response).json()).toEqual(
      ottoMcpOAuthClientDocument(ottoMcpOAuthIdentity("https://otto.example.com")!),
    );
  });
});
