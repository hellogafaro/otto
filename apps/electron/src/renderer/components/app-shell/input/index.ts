// Main components
export { InputContainer } from './input-container'
export { ChatInputZone } from './chat-input-zone'
export { FreeFormInput } from './free-form-input'
export { StructuredInput } from './structured-input'

// Structured input components
export { PermissionRequest } from './structured/permission-request'

// Hooks
export { useAutoGrow } from './use-auto-grow'

// Types
export type {
  InputMode,
  StructuredInputType,
  StructuredInputState,
  StructuredInputData,
  StructuredResponse,
  PermissionResponse,
  AdminApprovalResponse,
} from './structured/types'
