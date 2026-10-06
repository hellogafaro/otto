/**
 * The agent of a chat: always a `PiAgent` (docs/pi-only-plan.md), made by `createBackend` / the factory helpers
 * from the chat's connection.
 */

// Core types
export type {
  CoreBackendConfig,
  BackendConfig,
  BackendHostRuntimeContext,
  PermissionCallback,
  PlanCallback,
  AuthCallback,
  SourceChangeCallback,
  SourceActivationCallback,
  ChatOptions,
  RecoveryMessage,
  SdkMcpServerConfig,
  LlmAuthType,
  PostInitResult,
} from './types.ts';

// Enums need to be exported as values, not just types
export { AbortReason } from './types.ts';

// Factory
export {
  createBackend,
  resolveSessionConnection,
  resolveBackendContext,
  resolveSetupTestConnectionHint,
  createBackendFromConnection,
  createBackendFromResolvedContext,
  resolveBackendHostTooling,
  fetchBackendModels,
  validateStoredBackendConnection,
  resolveModel,
  cleanupSourceRuntimeArtifacts,
  testBackendConnection,
  type ResolvedBackendContext,
  type BackendAgent,
} from './factory.ts';

// Shared infrastructure
export { BaseEventAdapter } from './base-event-adapter.ts';
export { EventQueue } from './event-queue.ts';
export { PiEventAdapter } from './pi/event-adapter.ts';
