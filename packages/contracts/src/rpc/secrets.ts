import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  SecretsListInput,
  SecretsListResult,
  SecretsRemoveInput,
  SecretsRequestError,
  SecretsRevealInput,
  SecretsRevealResult,
  SecretsSaveInput,
} from "../secrets.ts";
import { WS_METHODS } from "./methods.ts";

const secretsError = Schema.Union([SecretsRequestError, EnvironmentAuthorizationError]);

/** A project's secret names; values stay on the server until someone reveals one. */
export const WsSecretsListRpc = Rpc.make(WS_METHODS.secretsList, {
  payload: SecretsListInput,
  success: SecretsListResult,
  error: secretsError,
});

export const WsSecretsRevealRpc = Rpc.make(WS_METHODS.secretsReveal, {
  payload: SecretsRevealInput,
  success: SecretsRevealResult,
  error: secretsError,
});

/** Saves values to a project, or to one chat until the server restarts. */
export const WsSecretsSaveRpc = Rpc.make(WS_METHODS.secretsSave, {
  payload: SecretsSaveInput,
  success: Schema.Void,
  error: secretsError,
});

export const WsSecretsRemoveRpc = Rpc.make(WS_METHODS.secretsRemove, {
  payload: SecretsRemoveInput,
  success: Schema.Void,
  error: secretsError,
});
