'use client';

import * as React from 'react';
import { Link2, Link2Off, RefreshCw, Search, CheckCircle, XCircle } from 'lucide-react';
import {
  useSlackMappings,
  useSlackUsers,
  useCreateSlackMapping,
  useDeleteSlackMapping,
  useAutoMatchSlackUsers,
  type SlackUser,
  type SlackMapping,
} from '@/lib/hooks/use-integrations';
import { useIntegration } from '@/lib/hooks/use-integrations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface SlackConfig {
  botToken?: string;
  signingSecret?: string;
  teamName?: string;
  setupComplete?: boolean;
}

export function SlackUserMappings() {
  const { data: integration, isLoading: integrationLoading } = useIntegration('slack');
  const { data: mappingsData, isLoading: mappingsLoading } = useSlackMappings();
  const { data: slackUsersData, isLoading: slackUsersLoading } = useSlackUsers();
  const createMapping = useCreateSlackMapping();
  const deleteMapping = useDeleteSlackMapping();
  const autoMatch = useAutoMatchSlackUsers();

  const [pendingMappings, setPendingMappings] = React.useState<Record<string, string>>({});

  const config = integration?.config as SlackConfig | undefined;
  const isConnected = integration?.is_active && config?.botToken;

  const mappings = mappingsData?.mappings || [];
  const slackUsers = slackUsersData?.users || [];

  // Build dropdown options from Slack users
  const slackUserOptions = React.useMemo(() => {
    const mappedSlackIds = new Set(
      mappings.filter((m) => m.isLinked).map((m) => m.slackUserId)
    );

    return [
      { value: '', label: 'Not linked' },
      ...slackUsers
        .filter((u) => !mappedSlackIds.has(u.id))
        .map((u) => ({
          value: u.id,
          label: u.real_name || u.name,
        })),
    ];
  }, [slackUsers, mappings]);

  const handleMappingChange = async (userId: string, slackUserId: string) => {
    setPendingMappings((prev) => ({ ...prev, [userId]: slackUserId }));

    try {
      if (slackUserId) {
        const slackUser = slackUsers.find((u) => u.id === slackUserId);
        await createMapping.mutateAsync({
          userId,
          slackUserId,
          displayName: slackUser?.real_name || slackUser?.name,
        });
      } else {
        await deleteMapping.mutateAsync(userId);
      }
    } finally {
      setPendingMappings((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  };

  const handleAutoMatch = async () => {
    const unmappedUserIds = mappings
      .filter((m) => !m.isLinked)
      .map((m) => m.userId);

    if (unmappedUserIds.length > 0) {
      await autoMatch.mutateAsync(unmappedUserIds);
    }
  };

  const isLoading = integrationLoading || mappingsLoading || slackUsersLoading;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex justify-center">
            <Spinner size="lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-xl">💬</span>
            Slack User Mappings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<Link2Off className="h-12 w-12" />}
            title="Slack not connected"
            description="Connect Slack in the Integrations settings to enable user mappings."
            action={
              <a href="/admin/integrations">
                <Button>Go to Integrations</Button>
              </a>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const linkedCount = mappings.filter((m) => m.isLinked).length;
  const totalCount = mappings.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="text-xl">💬</span>
              Slack User Mappings
            </CardTitle>
            <p className="text-sm text-text-sub mt-1">
              {config?.teamName && `Connected to ${config.teamName} • `}
              {linkedCount} of {totalCount} users linked
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={handleAutoMatch}
            disabled={autoMatch.isPending || linkedCount === totalCount}
          >
            {autoMatch.isPending ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Auto-match by Email
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {mappings.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Search className="h-12 w-12" />}
              title="No users found"
              description="Add team members to map them to Slack users."
            />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-warm bg-background-light">
                <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                  Citadel User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                  Slack User
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-text-sub uppercase tracking-wider w-24">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-warm">
              {mappings.map((mapping) => {
                const isPending = pendingMappings[mapping.userId] !== undefined;
                const currentSlackId = isPending
                  ? pendingMappings[mapping.userId]
                  : mapping.isLinked
                  ? mapping.slackUserId
                  : '';

                // Build options including the currently mapped user if linked
                const options = [...slackUserOptions];
                if (mapping.isLinked && mapping.slackUserId) {
                  const alreadyInOptions = options.some(
                    (o) => o.value === mapping.slackUserId
                  );
                  if (!alreadyInOptions) {
                    options.push({
                      value: mapping.slackUserId,
                      label: mapping.slackDisplayName || mapping.slackUserId,
                    });
                  }
                }

                return (
                  <tr key={mapping.userId} className="hover:bg-background-light/50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-text-main">{mapping.userName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-sub">{mapping.userEmail}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Select
                          options={options}
                          value={currentSlackId || ''}
                          onChange={(value) => handleMappingChange(mapping.userId, value)}
                          disabled={isPending || createMapping.isPending || deleteMapping.isPending}
                          className="w-56"
                        />
                        {isPending && <Spinner size="sm" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {mapping.isLinked ? (
                        <Badge variant="success" className="inline-flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />
                          Linked
                        </Badge>
                      ) : (
                        <Badge variant="default" className="inline-flex items-center gap-1">
                          <XCircle className="h-3 w-3" />
                          Not Linked
                        </Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
