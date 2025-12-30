'use client';

import * as React from 'react';
import { Eye, EyeOff, Send, Save } from 'lucide-react';
import { useIntegration, useUpdateIntegration, useTestSendGrid } from '@/lib/hooks/use-integrations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

export function SendGridSettings() {
  const { data: integration, isLoading } = useIntegration('sendgrid');
  const updateMutation = useUpdateIntegration();
  const testMutation = useTestSendGrid();

  const [showApiKey, setShowApiKey] = React.useState(false);
  const [apiKey, setApiKey] = React.useState('');
  const [fromEmail, setFromEmail] = React.useState('');
  const [testEmail, setTestEmail] = React.useState('');
  const [hasApiKeyChange, setHasApiKeyChange] = React.useState(false);
  const [hasFromEmailChange, setHasFromEmailChange] = React.useState(false);

  // Track the original masked key to know if one exists
  const existingMaskedKey = integration?.config?.apiKey || '';
  const hasExistingKey = existingMaskedKey.startsWith('****');

  // Initialize form when data loads (only on first load)
  const [initialized, setInitialized] = React.useState(false);
  React.useEffect(() => {
    if (integration?.config && !initialized) {
      // Don't set the masked API key - leave it blank so user knows to enter a new one
      // Only set fromEmail
      setFromEmail(integration.config.fromEmail || '');
      setInitialized(true);
    }
  }, [integration, initialized]);

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setHasApiKeyChange(true);
  };

  const handleFromEmailChange = (value: string) => {
    setFromEmail(value);
    setHasFromEmailChange(true);
  };

  const handleSave = async () => {
    // Only include API key if user entered a new one
    const config: { apiKey?: string; fromEmail: string } = { fromEmail };
    if (hasApiKeyChange && apiKey.trim()) {
      config.apiKey = apiKey;
    }

    await updateMutation.mutateAsync({
      provider: 'sendgrid',
      config,
    });
    setHasApiKeyChange(false);
    setHasFromEmailChange(false);
  };

  const handleTest = async () => {
    if (!testEmail.trim() || !fromEmail.trim()) {
      return;
    }
    // Pass apiKey only if user entered one, otherwise backend will use saved key
    await testMutation.mutateAsync({
      apiKey: apiKey.trim() || undefined,
      fromEmail,
      toEmail: testEmail,
    });
  };

  const isConfigured = integration?.is_active && hasExistingKey;
  const hasChanges = hasApiKeyChange || hasFromEmailChange;
  const canSave = fromEmail.trim() && hasChanges && (hasExistingKey || apiKey.trim());
  // Can test if we have fromEmail, testEmail, and either a new apiKey or an existing one saved
  const canTest = fromEmail.trim() && testEmail.trim() && (apiKey.trim() || hasExistingKey);

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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span className="text-xl">📧</span>
            SendGrid
          </CardTitle>
          <Badge variant={isConfigured ? 'success' : 'default'}>
            {isConfigured ? 'Connected' : 'Not Configured'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-text-sub">
          Configure SendGrid to enable email functionality including password resets, notifications, and reports.
        </p>

        <div className="space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              API Key {!hasExistingKey && '*'}
            </label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder={hasExistingKey ? `Current key: ${existingMaskedKey}` : 'SG.xxxxxxxxxxxxxxxxxxxxxxxx'}
                className="pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-sub hover:text-text-main"
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-text-sub mt-1">
              {hasExistingKey ? (
                'Leave blank to keep current key, or enter a new one to replace it.'
              ) : (
                <>
                  Get your API key from{' '}
                  <a
                    href="https://app.sendgrid.com/settings/api_keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    SendGrid Settings
                  </a>
                </>
              )}
            </p>
          </div>

          {/* From Email */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              From Email *
            </label>
            <Input
              type="email"
              value={fromEmail}
              onChange={(e) => handleFromEmailChange(e.target.value)}
              placeholder="noreply@yourcompany.com"
            />
            <p className="text-xs text-text-sub mt-1">
              Must be a verified sender in SendGrid
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-4 border-t border-border-warm">
          <Button
            onClick={handleSave}
            disabled={!canSave || updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Spinner size="sm" className="mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Settings
          </Button>
        </div>

        {/* Test Email Section */}
        <div className="pt-4 border-t border-border-warm space-y-3">
          <h4 className="text-sm font-medium text-text-main">Test Connection</h4>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm text-text-sub mb-1">
                Send test email to
              </label>
              <Input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="recipient@example.com"
              />
            </div>
            <Button
              variant="secondary"
              onClick={handleTest}
              disabled={!canTest || testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Spinner size="sm" className="mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Test
            </Button>
          </div>
          <p className="text-xs text-text-sub">
            {hasExistingKey
              ? 'Uses your saved API key, or enter a new one above to test with different credentials.'
              : 'Save your API key first, or enter one above to test.'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
