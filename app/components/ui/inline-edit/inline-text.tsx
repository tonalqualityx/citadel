'use client';

import * as React from 'react';

interface InlineTextProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'number';
  allowEmpty?: boolean;
}

export function InlineText({
  value,
  onChange,
  placeholder = 'Click to edit...',
  className = '',
  type = 'text',
  allowEmpty = true,
}: InlineTextProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value || '');
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  React.useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed !== (value || '')) {
      onChange(trimmed || (allowEmpty ? null : value));
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setDraft(value || '');
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`bg-transparent border-b-2 border-primary outline-none w-full text-text-main ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setDraft(value || '');
        setIsEditing(true);
      }}
      className={`cursor-pointer hover:bg-surface-alt px-2 py-1 -mx-2 -my-1 rounded transition-colors ${
        value ? 'text-text-main' : 'text-text-sub italic'
      } ${className}`}
    >
      {value || placeholder}
    </span>
  );
}
