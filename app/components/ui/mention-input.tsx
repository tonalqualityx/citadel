'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Avatar } from '@/components/ui/avatar';
import { getActiveMentionQuery } from '@/lib/utils/mentions';

export interface MentionCandidate {
  id: string;
  name: string;
  avatar_url?: string | null;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Users that can be mentioned. */
  users: MentionCandidate[];
  /** Called when a user is selected from the suggestion list. */
  onMentionSelect?: (user: MentionCandidate) => void;
  /** Called when Enter is pressed while the suggestion list is closed. */
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const MAX_SUGGESTIONS = 6;

/**
 * A single-line text input with `@`-mention autocomplete. Typing `@` followed by a name
 * opens a suggestion list; selecting a user (click, Enter, or Tab) inserts `@Display Name`.
 * Follows the usual social-media mention convention.
 */
export function MentionInput({
  value,
  onChange,
  users,
  onMentionSelect,
  onSubmit,
  placeholder,
  disabled,
  className,
}: MentionInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [mention, setMention] = React.useState<{ query: string; start: number } | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const suggestions = React.useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return users
      .filter((u) => u.name.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }, [mention, users]);

  const isOpen = mention !== null && suggestions.length > 0;

  React.useEffect(() => {
    setActiveIndex(0);
  }, [mention?.query]);

  const refreshMention = (text: string, caret: number) => {
    setMention(getActiveMentionQuery(text, caret));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    onChange(text);
    refreshMention(text, e.target.selectionStart ?? text.length);
  };

  const selectUser = (user: MentionCandidate) => {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const after = value.slice(mention.start + 1 + mention.query.length);
    const insert = `@${user.name} `;
    const next = `${before}${insert}${after}`;
    onChange(next);
    onMentionSelect?.(user);
    setMention(null);

    // Restore caret just after the inserted mention.
    const caret = before.length + insert.length;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectUser(suggestions[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
      return;
    }

    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) =>
          refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? value.length)
        }
        onClick={(e) =>
          refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? value.length)
        }
        onBlur={() => {
          // Delay so a click on a suggestion registers before closing.
          window.setTimeout(() => setMention(null), 150);
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary',
          className
        )}
      />

      {isOpen && (
        <ul
          role="listbox"
          className="absolute z-50 bottom-full mb-1 w-full max-h-60 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg custom-scrollbar"
        >
          {suggestions.map((user, idx) => (
            <li key={user.id} role="option" aria-selected={idx === activeIndex}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the input's onBlur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectUser(user);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  idx === activeIndex
                    ? 'bg-surface-2 text-text-main'
                    : 'text-text-main hover:bg-surface-alt'
                )}
              >
                <Avatar src={user.avatar_url} name={user.name} size="sm" />
                <span className="truncate">{user.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
