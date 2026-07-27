import { describe, it, expect } from 'vitest';
import { pipelineGroupForStatus } from '../pipeline';

describe('pipelineGroupForStatus (Clarity Phase 3 Reckoning, spec Q1)', () => {
  it('groups lead/meeting as prospect', () => {
    expect(pipelineGroupForStatus('lead')).toBe('prospect');
    expect(pipelineGroupForStatus('meeting')).toBe('prospect');
  });

  it('groups proposal/contract as in_motion', () => {
    expect(pipelineGroupForStatus('proposal')).toBe('in_motion');
    expect(pipelineGroupForStatus('contract')).toBe('in_motion');
  });

  it('groups signed/active/lost as closed', () => {
    expect(pipelineGroupForStatus('signed')).toBe('closed');
    expect(pipelineGroupForStatus('active')).toBe('closed');
    expect(pipelineGroupForStatus('lost')).toBe('closed');
  });

  it('falls back to closed for an unrecognized status rather than throwing', () => {
    expect(pipelineGroupForStatus('something-new')).toBe('closed');
  });
});
