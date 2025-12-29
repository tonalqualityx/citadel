'use client';

import * as React from 'react';
import { Building2, Globe, Check, Search } from 'lucide-react';
import { useClients } from '@/lib/hooks/use-clients';
import { useSites } from '@/lib/hooks/use-sites';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils/cn';
import { StepHeader } from './wizard-layout';

interface WizardStep2ClientProps {
  selectedClientId: string | null;
  selectedClientName: string | null;
  selectedSiteId: string | null;
  selectedSiteName: string | null;
  onSelectClient: (clientId: string, clientName: string) => void;
  onSelectSite: (siteId: string | null, siteName: string | null) => void;
}

export function WizardStep2Client({
  selectedClientId,
  selectedClientName,
  selectedSiteId,
  selectedSiteName,
  onSelectClient,
  onSelectSite,
}: WizardStep2ClientProps) {
  const [clientSearch, setClientSearch] = React.useState('');
  const { data: clientsData, isLoading: clientsLoading } = useClients({
    search: clientSearch || undefined,
    limit: 50,
  });
  const { data: sitesData, isLoading: sitesLoading } = useSites({
    client_id: selectedClientId || undefined,
    limit: 50,
  });

  const clients = clientsData?.clients || [];
  const sites = sitesData?.sites || [];

  return (
    <div>
      <StepHeader
        title="Select Client & Site"
        description="Choose the client and optionally a specific site for this project"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Client Selection */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="font-medium text-text-main">Client *</h3>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
            <Input
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Search clients..."
              className="pl-10"
            />
          </div>

          {clientsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : clients.length === 0 ? (
            <p className="text-sm text-text-sub text-center py-8">
              No clients found
            </p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {clients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => {
                    onSelectClient(client.id, client.name);
                    onSelectSite(null, null); // Reset site when client changes
                  }}
                  className={cn(
                    'w-full p-3 rounded-lg border text-left transition-all',
                    selectedClientId === client.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-surface-2'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-text-sub" />
                      <span className="font-medium text-text-main">
                        {client.name}
                      </span>
                    </div>
                    {selectedClientId === client.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Site Selection */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Globe className="h-5 w-5 text-primary" />
            <h3 className="font-medium text-text-main">Site (Optional)</h3>
          </div>

          {!selectedClientId ? (
            <div className="flex items-center justify-center h-[300px] border border-dashed border-border rounded-lg">
              <p className="text-sm text-text-sub">Select a client first</p>
            </div>
          ) : sitesLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : sites.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[300px] border border-dashed border-border rounded-lg">
              <p className="text-sm text-text-sub">No sites for this client</p>
              <p className="text-xs text-text-sub mt-1">
                You can create a site later
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
              {/* Option for no site */}
              <button
                type="button"
                onClick={() => onSelectSite(null, null)}
                className={cn(
                  'w-full p-3 rounded-lg border text-left transition-all',
                  !selectedSiteId
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-surface-2'
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-text-sub italic">No specific site</span>
                  {!selectedSiteId && <Check className="h-4 w-4 text-primary" />}
                </div>
              </button>

              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => onSelectSite(site.id, site.name)}
                  className={cn(
                    'w-full p-3 rounded-lg border text-left transition-all',
                    selectedSiteId === site.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-surface-2'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-text-sub" />
                      <span className="font-medium text-text-main">
                        {site.name}
                      </span>
                    </div>
                    {selectedSiteId === site.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  {site.url && (
                    <p className="text-xs text-text-sub mt-1 ml-6">
                      {site.url}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
