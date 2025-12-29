import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { useState, useCallback } from 'react';
import { useDebouncedValue } from './use-debounced-value';

export interface SearchResult {
  type: 'patron' | 'site' | 'pact' | 'quest' | 'rune' | 'domain' | 'tool';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

interface SearchResponse {
  results: SearchResult[];
}

export function useSearch() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () =>
      apiClient.get<SearchResponse>('/search', {
        params: { q: debouncedQuery },
      }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000, // Cache for 30 seconds
  });

  const clearSearch = useCallback(() => {
    setQuery('');
  }, []);

  return {
    query,
    setQuery,
    results: data?.results ?? [],
    isLoading: isLoading && debouncedQuery.length >= 2,
    isFetching,
    clearSearch,
  };
}
