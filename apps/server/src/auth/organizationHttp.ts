import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { OrganizationAccounts } from "./OrganizationAccounts.ts";

const handle = Effect.gen(function* () {
  const accounts = yield* OrganizationAccounts;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) return HttpServerResponse.empty({ status: 400 });
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : yield* request.text;
  const webRequest = new Request(url.value.toString(), {
    method: request.method,
    headers: request.headers,
    ...(body === undefined ? {} : { body }),
  });
  const response = yield* accounts.handle(webRequest);
  return HttpServerResponse.fromWeb(response);
}).pipe(
  Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(16 * 1024)),
  Effect.orElseSucceed(() =>
    HttpServerResponse.jsonUnsafe({ message: "Invalid account request." }, { status: 400 }),
  ),
);

export const organizationHttpLayer = Layer.mergeAll(
  HttpRouter.add("*", "/api/accounts/*", handle),
  HttpRouter.add("GET", "/api/organization", handle),
  HttpRouter.add("POST", "/api/organization/setup", handle),
);
