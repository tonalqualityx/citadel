import { describe, it, expect } from 'vitest';
import manifest from '@/app/manifest';
import { APP_BACKGROUND_COLOR } from '../colors';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('web app manifest', () => {
  const m = manifest();
  it('is a standalone app at the site root', () => {
    expect(m.name).toBe('Indelible Citadel');
    expect(m.short_name).toBe('Citadel');
    expect(m.start_url).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
  });
  it('takes its colors from the light theme in globals.css', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
    expect(css).toContain(`--bg-primary: ${APP_BACKGROUND_COLOR}`);
    expect(m.background_color).toBe('#FAF9F7');
    expect(m.theme_color).toBe('#FFFFFF');
  });
  it('has 192 and 512 any icons plus a 512 maskable icon, all real files of that size', () => {
    const icons = m.icons ?? [];
    const find = (sizes: string, purpose: string) => icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    for (const [sizes, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
      const icon = find(sizes, purpose);
      expect(icon, `${sizes} ${purpose}`).toBeTruthy();
      const buf = readFileSync(path.join(process.cwd(), 'public', icon!.src));
      expect(buf.subarray(1, 4).toString()).toBe('PNG');
      const w = buf.readUInt32BE(16);
      expect(`${w}x${buf.readUInt32BE(20)}`).toBe(sizes);
    }
  });
});
