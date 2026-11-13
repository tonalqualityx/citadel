import { describe, it, expect } from 'vitest';
import { authorLabel } from '@/lib/dox/identity';

describe('comment author label', () => {
  it('shows Dox for a comment written through the Dox lane, even though the user is Bast', () => {
    expect(authorLabel('dox', 'Bast')).toBe('Dox');
  });
  it('keeps the user name for every other lane and for people', () => {
    expect(authorLabel('bast', 'Bast')).toBe('Bast');
    expect(authorLabel(undefined, 'Mike')).toBe('Mike');
  });
});
