import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    accord: {
      findFirst: vi.fn(),
    },
    msaVersion: {
      findFirst: vi.fn(),
    },
  },
}));

import { generateContractContent } from '../contract-generator';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockAccordFindFirst = prisma.accord.findFirst as Mock;
const mockMsaFindFirst = prisma.msaVersion.findFirst as Mock;

const mockAccord = {
  id: 'accord-123',
  name: 'Test Accord',
  lead_name: 'John Doe',
  lead_business_name: 'Doe Corp',
  client: null,
  charter_items: [
    {
      id: 'charter-1',
      ware_id: 'ware-2',
      ware: {
        id: 'ware-2',
        name: 'Hosting',
        type: 'charter',
        contract_language: null,
        charter_billing_period: 'monthly',
      },
      name_override: null,
      contract_language_override: null,
      base_price: 50,
      final_price: 50,
      billing_period: 'monthly',
      duration_months: 12,
      total_contract_value: 600,
      sort_order: 1,
      is_deleted: false,
    },
  ],
  commission_items: [
    {
      id: 'commission-1',
      ware_id: 'ware-1',
      ware: {
        id: 'ware-1',
        name: 'Website Design',
        type: 'commission',
        contract_language: '<p>We will design your website.</p>',
      },
      name_override: null,
      contract_language_override: null,
      estimated_price: 5000,
      final_price: 5000,
      sort_order: 1,
      is_deleted: false,
    },
  ],
  keep_items: [],
};

const mockMsaVersion = {
  id: 'msa-v1',
  version: '1.0',
  effective_date: new Date('2026-01-01'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateContractContent', () => {
  it('generates contract content from accord items', async () => {
    mockAccordFindFirst.mockResolvedValue(mockAccord);
    mockMsaFindFirst.mockResolvedValue(mockMsaVersion);

    const result = await generateContractContent('accord-123');

    expect(result.content).toContain('Service Agreement');
    expect(result.content).toContain('Doe Corp');
    expect(result.content).toContain('Website Design');
    expect(result.content).toContain('We will design your website.');
    expect(result.content).toContain('Recurring Services');
    expect(result.content).toContain('Project Services');
    expect(result.content).toContain('Master Service Agreement');
    expect(result.content).toContain('Version 1.0');
    expect(result.msaVersionId).toBe('msa-v1');
    expect(result.pricingSnapshot).toHaveLength(2);
    expect(result.pricingSnapshot[0]).toMatchObject({
      type: 'charter',
      ware_name: 'Hosting',
      final_price: 50,
    });
    expect(result.pricingSnapshot[1]).toMatchObject({
      type: 'commission',
      ware_name: 'Website Design',
      final_price: 5000,
    });
  });

  it('uses contract_language_override when present', async () => {
    const accordWithOverride = {
      ...mockAccord,
      charter_items: [
        {
          ...mockAccord.charter_items[0],
          ware: {
            ...mockAccord.charter_items[0].ware,
            contract_language: '<p>Default language.</p>',
          },
          contract_language_override: '<p>Custom contract language.</p>',
        },
      ],
    };
    mockAccordFindFirst.mockResolvedValue(accordWithOverride);
    mockMsaFindFirst.mockResolvedValue(mockMsaVersion);

    const result = await generateContractContent('accord-123');

    expect(result.content).toContain('Custom contract language.');
    expect(result.content).not.toContain('Default language.');
  });

  it('throws when accord not found', async () => {
    mockAccordFindFirst.mockResolvedValue(null);

    await expect(generateContractContent('nonexistent')).rejects.toThrow('Accord not found');
  });

  it('throws when no MSA version exists', async () => {
    mockAccordFindFirst.mockResolvedValue(mockAccord);
    mockMsaFindFirst.mockResolvedValue(null);

    await expect(generateContractContent('accord-123')).rejects.toThrow(
      'No current MSA version found'
    );
  });

  it('uses client name when available', async () => {
    const accordWithClient = {
      ...mockAccord,
      client: { id: 'client-1', name: 'Client Corp' },
    };
    mockAccordFindFirst.mockResolvedValue(accordWithClient);
    mockMsaFindFirst.mockResolvedValue(mockMsaVersion);

    const result = await generateContractContent('accord-123');

    expect(result.content).toContain('Client Corp');
  });
});
