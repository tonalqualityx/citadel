'use client';

import * as React from 'react';
import { Eye, EyeOff, Save, CheckCircle, ExternalLink, Zap, Users } from 'lucide-react';
import { useIntegration, useUpdateIntegration, useTestSlack } from '@/lib/hooks/use-integrations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

interface SlackConfig {
  botToken?: string;
  signingSecret?: string;
  appId?: string;
  teamId?: string;
  teamName?: string;
  setupComplete?: boolean;
}

export function SlackSettings() {
  const { data: integration, isLoading } = useIntegration('slack');
  const updateMutation = useUpdateIntegration();
  const testMutation = useTestSlack();

  const [showBotToken, setShowBotToken] = React.useState(false);
  const [showSigningSecret, setShowSigningSecret] = React.useState(false);
  const [botToken, setBotToken] = React.useState('');
  const [signingSecret, setSigningSecret] = React.useState('');
  const [hasBotTokenChange, setHasBotTokenChange] = React.useState(false);
  const [hasSigningSecretChange, setHasSigningSecretChange] = React.useState(false);

  const config = integration?.config as SlackConfig | undefined;
  const existingMaskedToken = config?.botToken || '';
  const existingMaskedSecret = config?.signingSecret || '';
  const hasExistingToken = existingMaskedToken.startsWith('****');
  const hasExistingSecret = existingMaskedSecret.startsWith('****');

  const handleBotTokenChange = (value: string) => {
    setBotToken(value);
    setHasBotTokenChange(true);
  };

  const handleSigningSecretChange = (value: string) => {
    setSigningSecret(value);
    setHasSigningSecretChange(true);
  };

  const handleSave = async () => {
    const newConfig: Partial<SlackConfig> = {};

    if (hasBotTokenChange && botToken.trim()) {
      newConfig.botToken = botToken;
    }
    if (hasSigningSecretChange && signingSecret.trim()) {
      newConfig.signingSecret = signingSecret;
    }

    // Preserve team info from test
    if (testMutation.data?.teamName) {
      newConfig.teamName = testMutation.data.teamName;
      newConfig.teamId = testMutation.data.teamId;
    }

    await updateMutation.mutateAsync({
      provider: 'slack',
      config: newConfig,
    });

    setHasBotTokenChange(false);
    setHasSigningSecretChange(false);
  };

  const handleTest = async () => {
    await testMutation.mutateAsync({
      botToken: botToken.trim() || undefined,
    });
  };

  const isConfigured = integration?.is_active && hasExistingToken && hasExistingSecret;
  const hasChanges = hasBotTokenChange || hasSigningSecretChange;
  const canSave =
    hasChanges &&
    ((hasExistingToken || botToken.trim()) && (hasExistingSecret || signingSecret.trim()));
  const canTest = botToken.trim() || hasExistingToken;

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

  return (
    <div className="space-y-6">
      {/* Configuration Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span className="text-xl">💬</span>
              Slack Integration
            </CardTitle>
            <Badge variant={isConfigured ? 'success' : 'default'}>
              {isConfigured ? 'Connected' : 'Not Configured'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-text-sub">
            Connect Slack to enable direct message notifications and two-way comment sync.
          </p>

          {/* Setup Guide Link */}
          <div className="bg-surface-alt p-4 rounded-lg">
            <h4 className="font-medium text-text-main mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Quick Setup Guide
            </h4>
            <ol className="text-sm text-text-sub space-y-2 ml-6 list-decimal">
              <li>
                Go to{' '}
                <a
                  href="https://api.slack.com/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  api.slack.com/apps
                  <ExternalLink className="h-3 w-3" />
                </a>{' '}
                and click "Create New App" → "From scratch"
              </li>
              <li>Give it a name (e.g., "Citadel") and select your workspace</li>
              <li>
                Go to <strong>OAuth & Permissions</strong> and add these scopes:
                <code className="ml-2 px-2 py-0.5 bg-background-light rounded text-xs">
                  chat:write, im:write, users:read, users:read.email
                </code>
              </li>
              <li>Click "Install to Workspace" and authorize</li>
              <li>Copy the <strong>Bot User OAuth Token</strong> (starts with xoxb-)</li>
              <li>
                Go to <strong>Basic Information</strong> and copy the <strong>Signing Secret</strong>
              </li>
              <li>Paste both values below and click "Save Settings"</li>
            </ol>
          </div>

          <div className="space-y-4">
            {/* Bot Token */}
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                Bot User OAuth Token {!hasExistingToken && '*'}
              </label>
              <div className="relative">
                <Input
                  type={showBotToken ? 'text' : 'password'}
                  value={botToken}
                  onChange={(e) => handleBotTokenChange(e.target.value)}
                  placeholder={
                    hasExistingToken ? `Current: ${existingMaskedToken}` : 'xoxb-...'
                  }
                  className="pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowBotToken(!showBotToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-sub hover:text-text-main"
                >
                  {showBotToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-text-sub mt-1">
                Found in OAuth & Permissions → Bot User OAuth Token
              </p>
            </div>

            {/* Signing Secret */}
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                Signing Secret {!hasExistingSecret && '*'}
              </label>
              <div className="relative">
                <Input
                  type={showSigningSecret ? 'text' : 'password'}
                  value={signingSecret}
                  onChange={(e) => handleSigningSecretChange(e.target.value)}
                  placeholder={
                    hasExistingSecret ? `Current: ${existingMaskedSecret}` : 'Your signing secret'
                  }
                  className="pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSigningSecret(!showSigningSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-sub hover:text-text-main"
                >
                  {showSigningSecret ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-text-sub mt-1">
                Found in Basic Information → App Credentials → Signing Secret
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-border-warm">
            <Button onClick={handleSave} disabled={!canSave || updateMutation.isPending}>
              {updateMutation.isPending ? (
                <Spinner size="sm" className="mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Settings
            </Button>
            <Button
              variant="secondary"
              onClick={handleTest}
              disabled={!canTest || testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Spinner size="sm" className="mr-2" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Test Connection
            </Button>
          </div>

          {/* Test Result */}
          {testMutation.data?.success && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 text-green-800">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Connected successfully!</span>
              </div>
              <p className="text-sm text-green-700 mt-1">
                Workspace: {testMutation.data.teamName} • Bot: {testMutation.data.botName}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Events URL Card - only show when configured */}
      {isConfigured && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span>🔗</span>
              Events Webhook URL
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-sub">
              To enable two-way comment sync (reply in Slack → creates comment in Citadel), set up
              Events in your Slack app:
            </p>
            <ol className="text-sm text-text-sub space-y-2 ml-6 list-decimal">
              <li>Go to your Slack app → Event Subscriptions</li>
              <li>Enable Events and paste this Request URL:</li>
            </ol>
            <div className="flex gap-2">
              <Input
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/slack/events`}
                className="font-mono text-sm"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/api/webhooks/slack/events`
                  );
                }}
              >
                Copy
              </Button>
            </div>
            <p className="text-xs text-text-sub">
              Subscribe to the <code className="px-1 bg-background-light rounded">message.im</code>{' '}
              event to receive DM replies.
            </p>
          </CardContent>
        </Card>
      )}

      {/* User Mappings Link */}
      {isConfigured && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5" />
              User Mappings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-sub mb-4">
              Link Citadel users to their Slack accounts to enable direct message notifications.
            </p>
            <a
              href="/admin/team"
              className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 font-medium"
            >
              Manage user mappings in Team settings →
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
