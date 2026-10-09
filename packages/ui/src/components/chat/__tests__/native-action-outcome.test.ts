import { expect, it } from 'bun:test'
import type { Message, NativeActionData } from '@otto/core'
import { groupMessagesByTurn, type AssistantTurn } from '../turn-utils'

it('preserves real execution failure after permission was approved without exposing private tool data', () => {
  const action: NativeActionData = { id: 'approved-call', kind: 'approval', status: 'approved', title: 'Update the brief', summary: 'Apply the reviewed change.', eligibleActors: [], actorId: 'user:reviewer', actorName: 'Reviewer', resolvedAt: 10 }
  const message: Message = { id: 'failed-row', role: 'tool', content: 'PRIVATE_TOOL_DATA', toolResult: 'PRIVATE_TOOL_DATA', toolInput: { value: 'PRIVATE_INPUT' }, toolName: 'library_update', toolUseId: action.id, toolStatus: 'error', isError: true, timestamp: 11, nativeAction: action }
  const turn = groupMessagesByTurn([message], { isSessionProcessing: false })[0] as AssistantTurn
  expect(turn.activities[0]!.status).toBe('error')
  expect(turn.activities[0]!.nativeAction).toEqual(action)
  expect(turn.activities[0]!.toolInput).toBeUndefined()
  expect(turn.activities[0]!.error).toBeUndefined()
  expect(JSON.stringify(turn)).not.toContain('PRIVATE_TOOL_DATA')
  expect(JSON.stringify(turn)).not.toContain('PRIVATE_INPUT')
  const explicit = groupMessagesByTurn([{ ...message, isError: false }], { isSessionProcessing: false })[0] as AssistantTurn
  expect(explicit.activities[0]!.status).toBe('error')
})
