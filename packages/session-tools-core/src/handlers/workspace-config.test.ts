import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { getSessionToolDefs } from '../tool-defs.ts';
import { handleAgentsEdit, handleLabelsEdit, handlePermissionsEdit, handleRoutinesEdit, handleStatusesEdit } from './workspace-config.ts';

const text = (result: { content: { text?: string }[]; isError?: boolean }) => result.content[0]?.text ?? '';

describe('labels_edit, statuses_edit and permissions_edit', () => {
  it('hand the action to the injected editor with its domain and show the result', async () => {
    const calls: unknown[][] = [];
    const ctx = { editWorkspaceConfig: async (domain: string, args: unknown) => (calls.push([domain, args]), { ok: domain }) } as unknown as SessionToolContext;
    expect(text(await handleLabelsEdit(ctx, { action: 'list' }))).toContain('"ok": "labels"');
    expect(text(await handleStatusesEdit(ctx, { action: 'create', label: 'Blocked', category: 'open' }))).toContain('"ok": "statuses"');
    expect(text(await handlePermissionsEdit(ctx, { action: 'get' }))).toContain('"ok": "permissions"');
    expect(text(await handleAgentsEdit(ctx, { action: 'list' }))).toContain('"ok": "agents"');
    expect(text(await handleRoutinesEdit(ctx, { action: 'run', id: 'r1' }))).toContain('"ok": "routines"');
    expect(calls).toEqual([
      ['labels', { action: 'list' }],
      ['statuses', { action: 'create', label: 'Blocked', category: 'open' }],
      ['permissions', { action: 'get' }],
      ['agents', { action: 'list' }],
      ['routines', { action: 'run', id: 'r1' }],
    ]);
  });

  it('report a refusal as an error, and say so where there is no editor', async () => {
    const refusing = { editWorkspaceConfig: async () => { throw new Error('Only an owner of this workspace can change its labels'); } } as unknown as SessionToolContext;
    const refused = await handleLabelsEdit(refusing, { action: 'delete', id: 'bug' });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('Only an owner');
    const none = await handleStatusesEdit({} as SessionToolContext, { action: 'list' });
    expect(none.isError).toBe(true);
    expect(text(none)).toContain('not available');
  });

  it('are registered as blocked-in-Explore tools, and config_validate no longer has a statuses target', () => {
    const defs = getSessionToolDefs();
    for (const name of ['labels_edit', 'statuses_edit', 'permissions_edit', 'agents_edit', 'routines_edit']) {
      expect(defs.find((def) => def.name === name)).toMatchObject({ executionMode: 'registry', safeMode: 'block' });
    }
    const validate = defs.find((def) => def.name === 'config_validate')!;
    expect(validate.inputSchema.safeParse({ target: 'statuses' }).success).toBe(false);
    expect(validate.inputSchema.safeParse({ target: 'automations' }).success).toBe(false);
    expect(validate.inputSchema.safeParse({ target: 'permissions', sourceSlug: 'linear' }).success).toBe(true);
  });
});
