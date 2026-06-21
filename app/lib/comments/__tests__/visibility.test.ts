import { describe, it, expect } from 'vitest';
import {
  CLIENT_VISIBLE_COMMENT_WHERE,
  clientVisibleCommentWhere,
  filterClientVisible,
} from '../visibility';

describe('comment visibility helpers', () => {
  it('CLIENT_VISIBLE_COMMENT_WHERE constrains to is_internal=false', () => {
    expect(CLIENT_VISIBLE_COMMENT_WHERE).toEqual({ is_internal: false });
  });

  it('clientVisibleCommentWhere merges the constraint into an existing where', () => {
    expect(clientVisibleCommentWhere({ task_id: 't1', is_deleted: false })).toEqual({
      task_id: 't1',
      is_deleted: false,
      is_internal: false,
    });
  });

  it('clientVisibleCommentWhere forces is_internal=false even if caller passed true', () => {
    // The merged constraint must win — clients never see internal notes.
    expect(clientVisibleCommentWhere({ is_internal: true } as Record<string, unknown>)).toEqual({
      is_internal: false,
    });
  });

  it('filterClientVisible drops internal comments and keeps the rest', () => {
    const comments = [
      { id: 'a', is_internal: false },
      { id: 'b', is_internal: true },
      { id: 'c' }, // undefined → treated as client-visible
    ];
    expect(filterClientVisible(comments).map((c) => c.id)).toEqual(['a', 'c']);
  });
});
