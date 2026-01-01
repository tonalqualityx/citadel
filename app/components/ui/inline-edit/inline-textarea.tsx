'use client';

import * as React from 'react';

interface InlineTextareaProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}

export function InlineTextarea({
  value,
  onChange,
  placeholder = 'Click to add notes...',
  className = '',
  rows = 3,
}: InlineTextareaProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value || '');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
    }
  }, [isEditing]);

  React.useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed !== (value || '')) {
      onChange(trimmed || null);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape to cancel
    if (e.key === 'Escape') {
      setDraft(value || '');
      setIsEditing(false);
    }
    // Ctrl/Cmd + Enter to save
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave();
    }
  };

  if (isEditing) {
    return (
      <div className="space-y-2">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          className={`w-full bg-surface border border-primary rounded-md px-3 py-2 text-text-main outline-none resize-y ${className}`}
        />
        <div className="text-xs text-text-sub">
          Press Ctrl+Enter to save, Escape to cancel
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => {
        setDraft(value || '');
        setIsEditing(true);
      }}
      className={`cursor-pointer hover:bg-surface-alt px-3 py-2 -mx-3 -my-2 rounded transition-colors whitespace-pre-wrap ${
        value ? 'text-text-main' : 'text-text-sub italic'
      } ${className}`}
    >
      {value || placeholder}
    </div>
  );
}
