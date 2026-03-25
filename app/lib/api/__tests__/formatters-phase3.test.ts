import { describe, it, expect } from 'vitest';
import {
  formatProposalResponse,
  formatMsaVersionResponse,
  formatClientMsaSignatureResponse,
} from '../formatters';

describe('Phase 3 Formatters', () => {
  describe('formatProposalResponse', () => {
    it('formats a basic proposal', () => {
      const proposal = {
        id: '123',
        accord_id: '456',
        accord: { id: '456', name: 'Test Accord', status: 'proposal' },
        version: 1,
        content: '<p>Hello</p>',
        status: 'draft',
        pricing_snapshot: [{ name: 'Web Design', price: 5000, quantity: 1 }],
        sent_at: null,
        client_responded_at: null,
        client_note: null,
        portal_token: null,
        portal_token_expires_at: null,
        created_by_id: '789',
        created_by: { id: '789', name: 'Mike', email: 'mike@test.com' },
        is_deleted: false,
        created_at: '2026-03-18T00:00:00Z',
        updated_at: '2026-03-18T00:00:00Z',
      };

      const result = formatProposalResponse(proposal);

      expect(result.id).toBe('123');
      expect(result.accord_id).toBe('456');
      expect(result.accord).toEqual({ id: '456', name: 'Test Accord', status: 'proposal' });
      expect(result.version).toBe(1);
      expect(result.content).toBe('<p>Hello</p>');
      expect(result.status).toBe('draft');
      expect(result.pricing_snapshot).toHaveLength(1);
      expect(result.created_by).toEqual({ id: '789', name: 'Mike', email: 'mike@test.com' });
      expect(result.is_deleted).toBe(false);
    });

    it('handles missing relations gracefully', () => {
      const proposal = {
        id: '123',
        accord_id: '456',
        version: 1,
        content: '',
        status: 'draft',
        pricing_snapshot: [],
        sent_at: null,
        client_responded_at: null,
        client_note: null,
        portal_token: null,
        portal_token_expires_at: null,
        created_by_id: '789',
        is_deleted: false,
        created_at: '2026-03-18T00:00:00Z',
        updated_at: '2026-03-18T00:00:00Z',
      };

      const result = formatProposalResponse(proposal);

      expect(result.accord).toBeNull();
      expect(result.created_by).toBeNull();
    });

    it('preserves portal token fields', () => {
      const proposal = {
        id: '123',
        accord_id: '456',
        version: 1,
        content: '',
        status: 'sent',
        pricing_snapshot: [],
        sent_at: '2026-03-18T12:00:00Z',
        client_responded_at: null,
        client_note: null,
        portal_token: 'abc123token',
        portal_token_expires_at: '2026-05-18T00:00:00Z',
        created_by_id: '789',
        is_deleted: false,
        created_at: '2026-03-18T00:00:00Z',
        updated_at: '2026-03-18T00:00:00Z',
      };

      const result = formatProposalResponse(proposal);

      expect(result.portal_token).toBe('abc123token');
      expect(result.portal_token_expires_at).toBe('2026-05-18T00:00:00Z');
      expect(result.sent_at).toBe('2026-03-18T12:00:00Z');
    });
  });

  describe('formatMsaVersionResponse', () => {
    it('formats an MSA version with relations', () => {
      const msa = {
        id: '100',
        version: '1.0',
        content: '<p>Terms and conditions</p>',
        effective_date: '2026-01-01',
        is_current: true,
        change_summary: 'Initial version',
        created_by_id: '789',
        created_by: { id: '789', name: 'Mike', email: 'mike@test.com' },
        _count: { client_msa_signatures: 5 },
        created_at: '2026-03-18T00:00:00Z',
        updated_at: '2026-03-18T00:00:00Z',
      };

      const result = formatMsaVersionResponse(msa);

      expect(result.id).toBe('100');
      expect(result.version).toBe('1.0');
      expect(result.content).toBe('<p>Terms and conditions</p>');
      expect(result.is_current).toBe(true);
      expect(result.signatures_count).toBe(5);
      expect(result.created_by).toEqual({ id: '789', name: 'Mike', email: 'mike@test.com' });
    });

    it('defaults signatures_count to 0 when _count is missing', () => {
      const msa = {
        id: '100',
        version: '1.0',
        content: '',
        effective_date: '2026-01-01',
        is_current: false,
        change_summary: null,
        created_by_id: '789',
        created_at: '2026-03-18T00:00:00Z',
        updated_at: '2026-03-18T00:00:00Z',
      };

      const result = formatMsaVersionResponse(msa);

      expect(result.signatures_count).toBe(0);
      expect(result.created_by).toBeNull();
    });
  });

  describe('formatClientMsaSignatureResponse', () => {
    it('formats a signature with relations', () => {
      const sig = {
        id: '200',
        client_id: '300',
        client: { id: '300', name: 'Acme Corp' },
        msa_version_id: '100',
        msa_version: { id: '100', version: '1.0' },
        signed_at: '2026-03-18T14:30:00Z',
        signer_name: 'John Doe',
        signer_email: 'john@acme.com',
        signer_ip: '192.168.1.1',
        signer_user_agent: 'Mozilla/5.0',
        created_at: '2026-03-18T14:30:00Z',
      };

      const result = formatClientMsaSignatureResponse(sig);

      expect(result.id).toBe('200');
      expect(result.client).toEqual({ id: '300', name: 'Acme Corp' });
      expect(result.msa_version).toEqual({ id: '100', version: '1.0' });
      expect(result.signer_name).toBe('John Doe');
      expect(result.signer_email).toBe('john@acme.com');
      expect(result.signer_ip).toBe('192.168.1.1');
    });

    it('handles missing relations', () => {
      const sig = {
        id: '200',
        client_id: '300',
        msa_version_id: '100',
        signed_at: '2026-03-18T14:30:00Z',
        signer_name: 'John Doe',
        signer_email: 'john@acme.com',
        signer_ip: null,
        signer_user_agent: null,
        created_at: '2026-03-18T14:30:00Z',
      };

      const result = formatClientMsaSignatureResponse(sig);

      expect(result.client).toBeNull();
      expect(result.msa_version).toBeNull();
      expect(result.signer_ip).toBeNull();
    });
  });
});
