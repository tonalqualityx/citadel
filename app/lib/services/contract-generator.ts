import { prisma } from '@/lib/db/prisma';

interface ContractGenerationResult {
  content: string;
  pricingSnapshot: any[];
  msaVersionId: string;
}

/**
 * Generate contract HTML content from accord items (charter, commission, keep) and MSA reference.
 * Assembles ware contract language + pricing table + MSA reference.
 */
export async function generateContractContent(accordId: string): Promise<ContractGenerationResult> {
  // Fetch accord with all item types and their wares
  const accord = await prisma.accord.findFirst({
    where: { id: accordId, is_deleted: false },
    include: {
      client: { select: { id: true, name: true } },
      charter_items: {
        where: { is_deleted: false },
        include: {
          ware: {
            select: {
              id: true,
              name: true,
              type: true,
              contract_language: true,
              charter_billing_period: true,
            },
          },
        },
        orderBy: { sort_order: 'asc' },
      },
      commission_items: {
        where: { is_deleted: false },
        include: {
          ware: {
            select: {
              id: true,
              name: true,
              type: true,
              contract_language: true,
            },
          },
        },
        orderBy: { sort_order: 'asc' },
      },
      keep_items: {
        where: { is_deleted: false },
        include: {
          site: { select: { id: true, name: true, url: true } },
          hosting_plan: { select: { id: true, name: true, rate: true } },
          maintenance_plan: { select: { id: true, name: true, rate: true } },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  });

  if (!accord) {
    throw new Error('Accord not found');
  }

  // Get current MSA version
  const msaVersion = await prisma.msaVersion.findFirst({
    where: { is_current: true },
    select: { id: true, version: true, effective_date: true },
  });

  if (!msaVersion) {
    throw new Error('No current MSA version found. Please create an MSA version before generating a contract.');
  }

  // Build pricing snapshot from all item types
  const pricingSnapshot: any[] = [];

  // Charter items
  for (const item of accord.charter_items) {
    pricingSnapshot.push({
      id: item.id,
      type: 'charter',
      ware_id: item.ware_id,
      ware_name: item.ware?.name ?? item.name_override ?? 'Unknown',
      name_override: item.name_override,
      base_price: Number(item.base_price),
      final_price: Number(item.final_price),
      billing_period: item.billing_period,
      duration_months: item.duration_months,
      total_contract_value: Number(item.total_contract_value),
    });
  }

  // Commission items
  for (const item of accord.commission_items) {
    pricingSnapshot.push({
      id: item.id,
      type: 'commission',
      ware_id: item.ware_id,
      ware_name: item.ware?.name ?? item.name_override ?? 'Unknown',
      name_override: item.name_override,
      estimated_price: item.estimated_price ? Number(item.estimated_price) : null,
      final_price: item.final_price ? Number(item.final_price) : null,
    });
  }

  // Keep items
  for (const item of accord.keep_items) {
    pricingSnapshot.push({
      id: item.id,
      type: 'keep',
      site_name: item.site?.name || item.site_name_placeholder || 'Site',
      hosting_final_price: item.hosting_final_price ? Number(item.hosting_final_price) : null,
      maintenance_final_price: item.maintenance_final_price ? Number(item.maintenance_final_price) : null,
      monthly_total: item.monthly_total ? Number(item.monthly_total) : null,
    });
  }

  const clientName = accord.client?.name || accord.lead_business_name || accord.lead_name || 'Client';

  // Assemble contract sections
  const sections: string[] = [];

  // Header
  sections.push(`
    <div class="contract-header">
      <h1>Service Agreement</h1>
      <p class="contract-subtitle">${accord.name}</p>
      <p class="contract-meta">Prepared for: <strong>${clientName}</strong></p>
    </div>
  `);

  // Service terms from charter item wares
  const serviceTerms = accord.charter_items
    .filter(item => {
      const language = item.contract_language_override || item.ware?.contract_language;
      return language && language.trim().length > 0;
    })
    .map(item => {
      const name = item.name_override || item.ware?.name || 'Service';
      const language = item.contract_language_override || item.ware?.contract_language || '';
      return `
        <div class="service-terms">
          <h3>${name}</h3>
          <div class="terms-content">${language}</div>
        </div>
      `;
    });

  // Service terms from commission item wares
  const commissionTerms = accord.commission_items
    .filter(item => {
      const language = item.contract_language_override || item.ware?.contract_language;
      return language && language.trim().length > 0;
    })
    .map(item => {
      const name = item.name_override || item.ware?.name || 'Service';
      const language = item.contract_language_override || item.ware?.contract_language || '';
      return `
        <div class="service-terms">
          <h3>${name}</h3>
          <div class="terms-content">${language}</div>
        </div>
      `;
    });

  const allTerms = [...serviceTerms, ...commissionTerms];
  if (allTerms.length > 0) {
    sections.push(`
      <div class="contract-section">
        <h2>Service Terms</h2>
        ${allTerms.join('\n')}
      </div>
    `);
  }

  // Charter pricing table
  if (accord.charter_items.length > 0) {
    sections.push(`
      <div class="contract-section">
        <h2>Recurring Services</h2>
        <table class="pricing-table">
          <thead>
            <tr>
              <th>Service</th>
              <th class="text-right">Price</th>
              <th>Billing</th>
              <th class="text-right">Duration</th>
              <th class="text-right">Total Value</th>
            </tr>
          </thead>
          <tbody>
            ${accord.charter_items.map(item => `
              <tr>
                <td>${item.name_override || item.ware?.name || 'Service'}</td>
                <td class="text-right">$${Number(item.final_price).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                <td>${item.billing_period}</td>
                <td class="text-right">${item.duration_months} months</td>
                <td class="text-right">$${Number(item.total_contract_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('\n')}
          </tbody>
        </table>
      </div>
    `);
  }

  // Commission pricing table
  if (accord.commission_items.length > 0) {
    sections.push(`
      <div class="contract-section">
        <h2>Project Services</h2>
        <table class="pricing-table">
          <thead>
            <tr>
              <th>Service</th>
              <th class="text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            ${accord.commission_items.map(item => `
              <tr>
                <td>${item.name_override || item.ware?.name || 'Service'}</td>
                <td class="text-right">${item.final_price ? '$' + Number(item.final_price).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'TBD'}</td>
              </tr>
            `).join('\n')}
          </tbody>
        </table>
      </div>
    `);
  }

  // Keep items table
  if (accord.keep_items.length > 0) {
    sections.push(`
      <div class="contract-section">
        <h2>Hosting & Maintenance</h2>
        <table class="pricing-table">
          <thead>
            <tr>
              <th>Site</th>
              <th class="text-right">Hosting</th>
              <th class="text-right">Maintenance</th>
              <th class="text-right">Monthly Total</th>
            </tr>
          </thead>
          <tbody>
            ${accord.keep_items.map(item => `
              <tr>
                <td>${item.site?.name || item.site_name_placeholder || 'Site'}</td>
                <td class="text-right">${item.hosting_final_price ? '$' + Number(item.hosting_final_price).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}</td>
                <td class="text-right">${item.maintenance_final_price ? '$' + Number(item.maintenance_final_price).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}</td>
                <td class="text-right">${item.monthly_total ? '$' + Number(item.monthly_total).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}</td>
              </tr>
            `).join('\n')}
          </tbody>
        </table>
      </div>
    `);
  }

  // MSA reference
  sections.push(`
    <div class="contract-section">
      <h2>Master Service Agreement</h2>
      <p>This agreement is governed by the terms of the Master Service Agreement (Version ${msaVersion.version}, effective ${new Date(msaVersion.effective_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}).</p>
    </div>
  `);

  const content = sections.join('\n');

  return {
    content,
    pricingSnapshot,
    msaVersionId: msaVersion.id,
  };
}
