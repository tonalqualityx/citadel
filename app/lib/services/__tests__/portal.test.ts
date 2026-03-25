import { describe, it, expect } from 'vitest';
import { generatePortalToken, getTokenExpiry, getClientIp } from '../portal';

describe('Portal Service', () => {
  describe('generatePortalToken', () => {
    it('generates a 128-character hex string', () => {
      const token = generatePortalToken();
      expect(token).toHaveLength(128);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('generates unique tokens', () => {
      const token1 = generatePortalToken();
      const token2 = generatePortalToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('getTokenExpiry', () => {
    it('returns a date 60 days in the future by default', () => {
      const now = new Date();
      const expiry = getTokenExpiry();
      const diffDays = Math.round((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(60);
    });

    it('accepts custom number of days', () => {
      const now = new Date();
      const expiry = getTokenExpiry(30);
      const diffDays = Math.round((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(30);
    });

    it('returns a Date object', () => {
      const expiry = getTokenExpiry();
      expect(expiry).toBeInstanceOf(Date);
    });
  });

  describe('getClientIp', () => {
    it('extracts IP from x-forwarded-for header', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' },
      });
      expect(getClientIp(request)).toBe('192.168.1.1');
    });

    it('extracts IP from x-real-ip header', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-real-ip': '10.0.0.5' },
      });
      expect(getClientIp(request)).toBe('10.0.0.5');
    });

    it('returns fallback IP when no headers present', () => {
      const request = new Request('http://localhost');
      expect(getClientIp(request)).toBe('0.0.0.0');
    });

    it('takes first IP from comma-separated x-forwarded-for', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.50, 70.41.3.18, 150.172.238.178' },
      });
      expect(getClientIp(request)).toBe('203.0.113.50');
    });
  });
});
