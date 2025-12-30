'use client';

import { Card, CardContent } from '@/components/ui/card';

interface IntegrationPlaceholderProps {
  provider: 'quickbooks' | 'claude';
}

const providerInfo = {
  quickbooks: {
    icon: '📊',
    name: 'QuickBooks',
    description: 'Sync invoices, expenses, and financial data with QuickBooks Online.',
  },
  claude: {
    icon: '🤖',
    name: 'Claude AI',
    description: 'Enable AI-powered features like task suggestions and content generation.',
  },
};

export function IntegrationPlaceholder({ provider }: IntegrationPlaceholderProps) {
  const info = providerInfo[provider];

  return (
    <Card>
      <CardContent className="py-12">
        <div className="text-center max-w-sm mx-auto">
          <span className="text-5xl mb-4 block">{info.icon}</span>
          <h3 className="text-lg font-semibold text-text-main mb-2">{info.name}</h3>
          <p className="text-sm text-text-sub mb-4">{info.description}</p>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-background-light text-text-sub border border-border-warm">
            Coming Soon
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
