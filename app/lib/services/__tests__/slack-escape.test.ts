import { describe, it, expect } from 'vitest';
import { buildSlackBlocks, escapeSlack } from '../slack-notifications';

describe('Slack title escaping (client words reach titles)', () => {
  it('escapes & < >', () => {
    expect(escapeSlack('a & b <!channel> <https://x.co|click>')).toBe('a &amp; b &lt;!channel&gt; &lt;https://x.co|click&gt;');
  });

  it('a client title cannot ping the channel or inject a link', () => {
    const blocks = buildSlackBlocks('portal_emergency', 'Urgent portal request: <!channel> <https://evil.example|login>', 'fixed message', null, null) as Array<{
      text?: { text: string };
    }>;
    const header = blocks[0].text!.text;
    expect(header).not.toContain('<!channel>');
    expect(header).not.toContain('<https://evil.example|login>');
    expect(header).toContain('&lt;!channel&gt;');
  });
});
