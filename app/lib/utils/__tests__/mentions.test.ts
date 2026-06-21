import { describe, it, expect } from 'vitest';
import {
  getActiveMentionQuery,
  findMentionedUserIds,
  renderMentionSegments,
} from '../mentions';

const users = [
  { id: 'u1', name: 'Sam' },
  { id: 'u2', name: 'Sam Smith' },
  { id: 'u3', name: 'Reshi' },
];

describe('getActiveMentionQuery', () => {
  it('detects an empty query right after @', () => {
    const text = 'hello @';
    expect(getActiveMentionQuery(text, text.length)).toEqual({ query: '', start: 6 });
  });

  it('detects a partial query', () => {
    const text = 'hi @res';
    expect(getActiveMentionQuery(text, text.length)).toEqual({ query: 'res', start: 3 });
  });

  it('detects @ at the start of the text', () => {
    expect(getActiveMentionQuery('@bo', 3)).toEqual({ query: 'bo', start: 0 });
  });

  it('returns null when @ is not preceded by whitespace (e.g. an email)', () => {
    const text = 'mail me at bob@acme';
    expect(getActiveMentionQuery(text, text.length)).toBeNull();
  });

  it('returns null once a space ends the token', () => {
    const text = 'hey @Sam ';
    expect(getActiveMentionQuery(text, text.length)).toBeNull();
  });

  it('only considers text up to the caret', () => {
    const text = 'a @re extra';
    // caret right after "@re"
    expect(getActiveMentionQuery(text, 5)).toEqual({ query: 're', start: 2 });
  });
});

describe('findMentionedUserIds', () => {
  it('matches a single mention', () => {
    expect(findMentionedUserIds('hey @Reshi take a look', users)).toEqual(['u3']);
  });

  it('prefers the longest matching name (no shadowing)', () => {
    expect(findMentionedUserIds('ping @Sam Smith please', users)).toEqual(['u2']);
  });

  it('matches the short name when the long one is absent', () => {
    expect(findMentionedUserIds('ping @Sam please', users)).toEqual(['u1']);
  });

  it('dedupes repeated mentions and finds multiple users', () => {
    const ids = findMentionedUserIds('@Reshi @Reshi and @Sam Smith', users);
    expect(ids.sort()).toEqual(['u2', 'u3']);
  });

  it('does not match an @name embedded without a boundary', () => {
    expect(findMentionedUserIds('email reshi@x.com', users)).toEqual([]);
  });

  it('matches a mention followed by punctuation', () => {
    expect(findMentionedUserIds('thanks @Reshi!', users)).toEqual(['u3']);
  });
});

describe('renderMentionSegments', () => {
  it('splits content into plain and mention segments', () => {
    const segs = renderMentionSegments('hey @Reshi look', users);
    expect(segs).toEqual([
      { text: 'hey ', isMention: false },
      { text: '@Reshi', isMention: true },
      { text: ' look', isMention: false },
    ]);
  });

  it('returns the whole string as plain when there are no users', () => {
    expect(renderMentionSegments('hey @Reshi', [])).toEqual([
      { text: 'hey @Reshi', isMention: false },
    ]);
  });

  it('handles a mention at the very start', () => {
    expect(renderMentionSegments('@Sam Smith hi', users)).toEqual([
      { text: '@Sam Smith', isMention: true },
      { text: ' hi', isMention: false },
    ]);
  });
});
