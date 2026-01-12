'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SendGridSettings } from '@/components/domain/admin/sendgrid-settings';
import { SlackSettings } from '@/components/domain/admin/slack-settings';
import { IntegrationPlaceholder } from '@/components/domain/admin/integration-placeholder';

export default function IntegrationsPage() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-main">Integrations</h1>
        <p className="text-text-sub">Manage third-party service connections</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="slack">
        <TabsList>
          <TabsTrigger value="slack">Slack</TabsTrigger>
          <TabsTrigger value="sendgrid">SendGrid</TabsTrigger>
          <TabsTrigger value="quickbooks">QuickBooks</TabsTrigger>
          <TabsTrigger value="claude">Claude</TabsTrigger>
        </TabsList>

        <TabsContent value="slack">
          <SlackSettings />
        </TabsContent>

        <TabsContent value="sendgrid">
          <SendGridSettings />
        </TabsContent>

        <TabsContent value="quickbooks">
          <IntegrationPlaceholder provider="quickbooks" />
        </TabsContent>

        <TabsContent value="claude">
          <IntegrationPlaceholder provider="claude" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
