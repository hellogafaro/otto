import { describe, it, expect } from 'bun:test';
import { matchesLabelFilter } from '../filter.ts';
import type { LabelConfig } from '../types.ts';

const TREE: LabelConfig[] = [
  {
    id: 'task',
    name: 'Task',
    children: [{ id: 'task-fix-login-1', name: 'TASK-fix-login-1' }],
  },
  { id: 'area', name: 'Area', children: [{ id: 'area-ui', name: 'UI' }] },
];

describe('matchesLabelFilter', () => {
  it('matches valued entries by base id', () => {
    expect(matchesLabelFilter({ labels: ['task::3'] }, { labelId: 'task' }, TREE)).toBe(true);
    expect(matchesLabelFilter({ labels: ['bug'] }, { labelId: 'task' }, TREE)).toBe(false);
  });

  it('matches descendants through the tree', () => {
    expect(matchesLabelFilter({ labels: ['area-ui'] }, { labelId: 'area' }, TREE)).toBe(true);
    expect(matchesLabelFilter({ labels: ['area-ui'] }, { labelId: 'area' }, [])).toBe(false);
  });

  it("'__all__' matches any labeled session, never unlabeled ones", () => {
    expect(matchesLabelFilter({ labels: ['bug'] }, { labelId: '__all__' }, TREE)).toBe(true);
    expect(matchesLabelFilter({ labels: [] }, { labelId: '__all__' }, TREE)).toBe(false);
    expect(matchesLabelFilter({}, { labelId: '__all__' }, TREE)).toBe(false);
  });

  it('projectId scopes matches (including __all__)', () => {
    const session = { labels: ['task::1'], projectId: 'p1' };
    expect(matchesLabelFilter(session, { labelId: 'task', projectId: 'p1' }, TREE)).toBe(true);
    expect(matchesLabelFilter(session, { labelId: 'task', projectId: 'p2' }, TREE)).toBe(false);
    expect(matchesLabelFilter({ labels: ['bug'] }, { labelId: '__all__', projectId: 'p1' }, TREE)).toBe(false);
  });
});
