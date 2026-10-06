/**
 * Automation Handlers - Re-exports for convenience
 */

export type {
  AutomationHandler,
  PromptHandlerOptions,
  PromptProcessingResult,
  AutomationsConfigProvider,
} from './types.ts';

export { PromptHandler } from './prompt-handler.ts';
export { WebhookHandler, type WebhookHandlerOptions } from './webhook-handler.ts';
export { ScriptHandler, type ScriptHandlerOptions } from './script-handler.ts';
