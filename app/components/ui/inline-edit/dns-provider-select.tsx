'use client';

import * as React from 'react';
import { ChevronDown, X, Search, Plus } from 'lucide-react';
import { useDnsProviders, useCreateDnsProvider } from '@/lib/hooks/use-dns-providers';

interface DnsProviderSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}

export function DnsProviderSelect({
  value,
  onChange,
  placeholder = 'Select DNS provider...',
  className = '',
}: DnsProviderSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const { data: providers, isLoading } = useDnsProviders();
  const createProvider = useCreateDnsProvider();

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus();
    }
  }, [isOpen]);

  const selectedProvider = providers?.find((p) => p.id === value);
  const displayLabel = selectedProvider?.name || placeholder;

  const filteredProviders = providers?.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  // Check if exact match exists
  const exactMatch = providers?.find(
    (p) => p.name.toLowerCase() === search.toLowerCase()
  );

  const handleCreate = async () => {
    if (!search.trim() || exactMatch) return;

    try {
      const newProvider = await createProvider.mutateAsync(search.trim());
      onChange(newProvider.id);
      setIsOpen(false);
      setSearch('');
    } catch (error) {
      console.error('Failed to create DNS provider:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && search.trim() && !exactMatch) {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 cursor-pointer hover:bg-surface-alt px-2 py-1 -mx-2 -my-1 rounded transition-colors"
      >
        <span className={value ? 'text-text-main' : 'text-text-sub italic'}>
          {displayLabel}
        </span>
        <ChevronDown className="h-3 w-3 text-text-sub" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg">
          {/* Search input */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search or create..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-alt border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Options */}
          <div className="max-h-48 overflow-auto py-1">
            {/* Clear option */}
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setIsOpen(false);
                  setSearch('');
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-alt flex items-center gap-2 text-text-sub"
              >
                <X className="h-4 w-4" />
                Clear selection
              </button>
            )}

            {/* Create new option */}
            {search.trim() && !exactMatch && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={createProvider.isPending}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-alt flex items-center gap-2 text-primary"
              >
                <Plus className="h-4 w-4" />
                {createProvider.isPending ? 'Creating...' : `Create "${search.trim()}"`}
              </button>
            )}

            {isLoading ? (
              <div className="px-3 py-2 text-sm text-text-sub">Loading...</div>
            ) : filteredProviders.length === 0 && !search.trim() ? (
              <div className="px-3 py-2 text-sm text-text-sub">No providers</div>
            ) : (
              filteredProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    onChange(provider.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-alt ${
                    provider.id === value ? 'bg-primary/10 text-primary' : 'text-text-main'
                  }`}
                >
                  {provider.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
