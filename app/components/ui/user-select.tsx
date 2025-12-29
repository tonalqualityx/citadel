'use client';

import * as React from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useUsers } from '@/lib/hooks/use-users';
import { Avatar } from './avatar';

// ============================================
// INLINE USER SELECT
// ============================================

interface InlineUserSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  displayValue?: string;
  placeholder?: string;
  showChevron?: boolean; // Default: false (chevrons hidden)
}

export function InlineUserSelect({
  value,
  onChange,
  displayValue,
  placeholder = 'Select user',
  showChevron = false,
}: InlineUserSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const { data, isLoading } = useUsers();

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const users = data?.users || [];
  const selectedUser = users.find((u) => u.id === value);
  const display = displayValue || selectedUser?.name || placeholder;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity text-left text-sm"
      >
        <span className={value ? 'text-text-main' : 'text-text-sub'}>
          {display}
        </span>
        {showChevron && <ChevronDown className="h-3 w-3 text-text-sub" />}
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg py-2 max-h-60 overflow-auto">
          {/* Unassign option */}
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-alt flex items-center gap-2 text-text-sub"
            >
              <X className="h-4 w-4" />
              Unassign
            </button>
          )}

          {isLoading ? (
            <div className="px-3 py-2 text-sm text-text-sub">Loading...</div>
          ) : users.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-sub">No users found</div>
          ) : (
            users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  onChange(user.id);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-alt flex items-center gap-2 ${
                  user.id === value ? 'bg-primary/10 text-primary' : 'text-text-main'
                }`}
              >
                <Avatar src={user.avatar_url} name={user.name} size="xs" />
                <div>
                  <div>{user.name}</div>
                  <div className="text-xs text-text-sub">{user.role}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
