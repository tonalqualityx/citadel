'use client';

import { Fragment, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Users,
  Globe,
  FolderKanban,
  CheckSquare,
  FileText,
  Wrench,
  Link2,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { useSearch, type SearchResult } from '@/lib/hooks/use-search';
import { useTerminology } from '@/lib/hooks/use-terminology';

const typeIcons: Record<SearchResult['type'], React.ElementType> = {
  patron: Users,
  site: Globe,
  pact: FolderKanban,
  quest: CheckSquare,
  rune: FileText,
  domain: Link2,
  tool: Wrench,
};

// Type labels are resolved dynamically in the component using useTerminology

const typeColors: Record<SearchResult['type'], string> = {
  patron: 'text-amber-500',
  site: 'text-blue-500',
  pact: 'text-purple-500',
  quest: 'text-green-500',
  rune: 'text-teal-500',
  domain: 'text-pink-500',
  tool: 'text-orange-500',
};

export function CommandPalette() {
  const router = useRouter();
  const { t } = useTerminology();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { query, setQuery, results, isLoading, clearSearch } = useSearch();

  // Dynamic type labels based on terminology mode
  const typeLabels: Record<SearchResult['type'], string> = {
    patron: 'Patron',
    site: 'Site',
    pact: t('project'),
    quest: t('task'),
    rune: 'Rune',
    domain: 'Domain',
    tool: 'Tool',
  };

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Open/close with Cmd+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === 'Enter' && results[selectedIndex]) {
        e.preventDefault();
        navigateToResult(results[selectedIndex]);
      }
    },
    [results, selectedIndex]
  );

  function navigateToResult(result: SearchResult) {
    router.push(result.url);
    setIsOpen(false);
    clearSearch();
  }

  function handleClose() {
    setIsOpen(false);
    clearSearch();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-start justify-center p-4 pt-[15vh]">
        <div className="relative w-full max-w-xl transform rounded-xl bg-surface shadow-2xl ring-1 ring-black/10 transition-all">
          {/* Search Input */}
          <div className="flex items-center border-b border-border-warm px-4">
            <Search className="h-5 w-5 text-text-sub shrink-0" />
            <input
              type="text"
              className="h-14 w-full border-0 bg-transparent px-4 text-text-main placeholder:text-text-sub focus:outline-none focus:ring-0"
              placeholder="Search patrons, pacts, quests, runes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            {isLoading && <Loader2 className="h-5 w-5 text-text-sub animate-spin" />}
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-border-warm bg-background-light px-2 py-0.5 text-xs text-text-sub">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto py-2">
            {query.length < 2 ? (
              <div className="px-4 py-8 text-center text-text-sub">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Type at least 2 characters to search</p>
                <p className="text-xs mt-1 opacity-70">
                  Press <kbd className="px-1 py-0.5 rounded bg-background-light">↑</kbd>{' '}
                  <kbd className="px-1 py-0.5 rounded bg-background-light">↓</kbd> to navigate,{' '}
                  <kbd className="px-1 py-0.5 rounded bg-background-light">Enter</kbd> to select
                </p>
              </div>
            ) : results.length === 0 && !isLoading ? (
              <div className="px-4 py-8 text-center text-text-sub">
                <p className="text-sm">No results found for &quot;{query}&quot;</p>
              </div>
            ) : (
              <ul>
                {results.map((result, index) => {
                  const Icon = typeIcons[result.type];
                  const color = typeColors[result.type];
                  const isSelected = index === selectedIndex;

                  return (
                    <li key={`${result.type}-${result.id}`}>
                      <button
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                          isSelected ? 'bg-primary/10' : 'hover:bg-background-light'
                        }`}
                        onClick={() => navigateToResult(result)}
                        onMouseEnter={() => setSelectedIndex(index)}
                      >
                        <div className={`shrink-0 ${color}`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-main truncate">
                            {result.title}
                          </p>
                          {result.subtitle && (
                            <p className="text-xs text-text-sub truncate">{result.subtitle}</p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs text-text-sub bg-background-light px-2 py-0.5 rounded">
                          {typeLabels[result.type]}
                        </span>
                        {isSelected && (
                          <ArrowRight className="h-4 w-4 text-primary shrink-0" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border-warm px-4 py-2 text-xs text-text-sub flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-background-light font-mono">↵</kbd>
                to select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-background-light font-mono">↑↓</kbd>
                to navigate
              </span>
            </div>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-background-light font-mono">esc</kbd>
              to close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
