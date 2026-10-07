import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { getSessionToolDefs } from '../tool-defs.ts';
import { handlePermissionsEdit } from './permissions-edit.ts';

const text = (result: { content: { text?: string }[]; isError?: boolean }) => result.content[0]?.text ?? '';

describe('permissions_edit', () => {
  it('hands the action to the injected editor and shows the result', async () => {
    const calls: unknown[] = [];
    const ctx = { editPermissions: async (args: unknown) => (calls.push(args), { ok: true }) } as unknown as SessionToolContext;
    expect(text(await handlePermissionsEdit(ctx, { action: 'get' }))).toContain('"ok": true');
    expect(calls).toEqual([{ action: 'get' }]);
  });

  it('reports a refusal as an error, and says so where there is no editor', async () => {
    const refusing = { editPermissions: async () => { throw new Error('Only an owner of this workspace can change its permissions'); } } as unknown as SessionToolContext;
    const refused = await handlePermissionsEdit(refusing, { action: 'update', rules: {} });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('Only an owner');
    const none = await handlePermissionsEdit({} as SessionToolContext, { action: 'get' });
    expect(none.isError).toBe(true);
    expect(text(none)).toContain('not available');
  });

  it('is a blocked-in-Explore tool, and the interim labels, statuses, agents and routines tools are gone (the otto CLI has them)', () => {
    const defs = getSessionToolDefs();
    expect(defs.find((def) => def.name === 'permissions_edit')).toMatchObject({ executionMode: 'registry', safeMode: 'block' });
    for (const name of ['labels_edit', 'statuses_edit', 'agents_edit', 'routines_edit']) expect(defs.find((def) => def.name === name)).toBeUndefined();
    const validate = defs.find((def) => def.name === 'config_validate')!;
    expect(validate.inputSchema.safeParse({ target: 'statuses' }).success).toBe(false);
    expect(validate.inputSchema.safeParse({ target: 'automations' }).success).toBe(false);
    expect(validate.inputSchema.safeParse({ target: 'permissions', sourceSlug: 'linear' }).success).toBe(true);
  });
});
