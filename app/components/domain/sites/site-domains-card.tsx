'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { Globe, Unlink, Star, Plus, ExternalLink, Link2, Search } from 'lucide-react';
import { useDomains, useCreateDomain, useUpdateDomain } from '@/lib/hooks/use-domains';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { Domain } from '@/types/entities';

interface SiteDomainsCardProps {
  siteId: string;
  domains: Domain[];
}

type AddMode = 'idle' | 'new' | 'link';

export function SiteDomainsCard({ siteId, domains }: SiteDomainsCardProps) {
  const [addMode, setAddMode] = useState<AddMode>('idle');
  const [newDomainName, setNewDomainName] = useState('');
  const [linkSearch, setLinkSearch] = useState('');

  const createDomain = useCreateDomain();
  const updateDomain = useUpdateDomain();

  // Query for unassigned domains when in link mode
  const { data: unassignedData, isLoading: loadingUnassigned } = useDomains({
    unassigned: true,
    search: linkSearch || undefined,
    limit: 10,
  });

  const unassignedDomains = unassignedData?.domains || [];

  const handleCreateDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomainName.trim()) return;

    try {
      await createDomain.mutateAsync({
        name: newDomainName.trim(),
        site_id: siteId,
        is_primary: domains.length === 0, // First domain is primary
      });
      setNewDomainName('');
      setAddMode('idle');
    } catch (err) {
      console.error('Failed to create domain:', err);
    }
  };

  const handleLinkDomain = async (domainId: string) => {
    try {
      await updateDomain.mutateAsync({
        id: domainId,
        data: {
          site_id: siteId,
          is_primary: domains.length === 0, // First domain is primary
        },
      });
      setLinkSearch('');
      setAddMode('idle');
    } catch (err) {
      console.error('Failed to link domain:', err);
    }
  };

  const handleSetPrimary = async (domainId: string) => {
    try {
      await updateDomain.mutateAsync({
        id: domainId,
        data: { is_primary: true },
      });
    } catch (err) {
      console.error('Failed to set primary:', err);
    }
  };

  const handleUnlink = async (domain: Domain) => {
    if (!confirm(`Unlink "${domain.name}" from this site? The domain will not be deleted.`)) return;

    try {
      await updateDomain.mutateAsync({
        id: domain.id,
        data: { site_id: null },
        previousSiteId: siteId,
      });
    } catch (err) {
      console.error('Failed to unlink domain:', err);
    }
  };

  const isPending = createDomain.isPending || updateDomain.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Domains
        </CardTitle>
        {addMode === 'idle' && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddMode('link')}
              className="h-8"
              title="Link existing domain"
            >
              <Link2 className="h-4 w-4 mr-1" />
              Link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddMode('new')}
              className="h-8"
              title="Create new domain"
            >
              <Plus className="h-4 w-4 mr-1" />
              New
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Domain list */}
        {domains.length === 0 && addMode === 'idle' ? (
          <p className="text-text-sub text-sm">No domains linked to this site.</p>
        ) : (
          <div className="space-y-2">
            {domains.map((domain) => (
              <div
                key={domain.id}
                className="flex items-center justify-between py-2 px-3 -mx-3 rounded-lg hover:bg-surface-alt group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {domain.is_primary && (
                    <Badge variant="success" className="flex-shrink-0">Primary</Badge>
                  )}
                  <Link
                    href={`/domains/${domain.id}`}
                    className="text-text-main hover:text-primary hover:underline truncate"
                  >
                    {domain.name}
                  </Link>
                  <a
                    href={`https://${domain.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-sub hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!domain.is_primary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSetPrimary(domain.id)}
                      disabled={isPending}
                      className="h-7 px-2 text-xs"
                      title="Set as primary"
                    >
                      <Star className="h-3 w-3 mr-1" />
                      Primary
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleUnlink(domain)}
                    disabled={isPending}
                    className="h-7 px-2 text-text-sub hover:text-warning"
                    title="Unlink domain from site"
                  >
                    <Unlink className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create new domain form */}
        {addMode === 'new' && (
          <form onSubmit={handleCreateDomain} className="space-y-2 pt-2 border-t border-border">
            <p className="text-xs text-text-sub">Create a new domain and link it to this site:</p>
            <div className="flex gap-2">
              <Input
                value={newDomainName}
                onChange={(e) => setNewDomainName(e.target.value)}
                placeholder="example.com"
                className="flex-1"
                autoFocus
                disabled={createDomain.isPending}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newDomainName.trim() || createDomain.isPending}
              >
                {createDomain.isPending ? <Spinner size="sm" /> : 'Create'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAddMode('idle');
                  setNewDomainName('');
                }}
                disabled={createDomain.isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* Link existing domain */}
        {addMode === 'link' && (
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-xs text-text-sub">Link an existing unassigned domain:</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-text-sub" />
              <Input
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                placeholder="Search domains..."
                className="pl-9"
                autoFocus
              />
            </div>

            <div className="max-h-40 overflow-y-auto border border-border rounded-lg">
              {loadingUnassigned ? (
                <div className="flex justify-center py-3">
                  <Spinner size="sm" />
                </div>
              ) : unassignedDomains.length === 0 ? (
                <p className="text-sm text-text-sub py-3 px-3">
                  {linkSearch ? 'No matching domains found' : 'No unassigned domains available'}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {unassignedDomains.map((domain) => (
                    <button
                      key={domain.id}
                      onClick={() => handleLinkDomain(domain.id)}
                      disabled={updateDomain.isPending}
                      className="w-full text-left px-3 py-2 hover:bg-surface-alt flex items-center justify-between group"
                    >
                      <span className="text-sm text-text-main">{domain.name}</span>
                      <span className="text-xs text-text-sub opacity-0 group-hover:opacity-100">
                        Click to link
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAddMode('idle');
                  setLinkSearch('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isPending && (
          <div className="flex items-center gap-2 text-sm text-text-sub">
            <Spinner size="sm" />
            <span>Updating...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
