import { describe, expect, it } from 'bun:test'
import { getFirstRunStep } from '../first-run-step'

describe('getFirstRunStep', () => {
  it('asks someone with no workspace to name one first', () => {
    expect(getFirstRunStep({ hasWorkspace: false, isOwner: false, connectionReady: false })).toBe('workspace')
    expect(getFirstRunStep({ hasWorkspace: false, isOwner: false, connectionReady: true })).toBe('workspace')
  })

  it('asks an owner to connect a provider while none is usable', () => {
    expect(getFirstRunStep({ hasWorkspace: true, isOwner: true, connectionReady: false })).toBe('connection')
  })

  it('lets an owner in once a connection works or they skipped', () => {
    expect(getFirstRunStep({ hasWorkspace: true, isOwner: true, connectionReady: true })).toBeNull()
  })

  it('never shows setup to an invited member', () => {
    expect(getFirstRunStep({ hasWorkspace: true, isOwner: false, connectionReady: false })).toBeNull()
    expect(getFirstRunStep({ hasWorkspace: true, isOwner: false, connectionReady: true })).toBeNull()
  })
})
