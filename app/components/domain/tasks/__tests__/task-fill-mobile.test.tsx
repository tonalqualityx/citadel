import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';

/**
 * Task page and task drawer on a phone or tablet: the text uses the screen width (task f5633e71).
 *
 * Measured in a real browser on a long card: at 390px the description ran 132px wide (shell, page and card padding plus
 * the editor's 54px indent on each side), at 820px 192px; after, 324px and 754px, with the page half as tall. The
 * 1440px desktop screenshots match before and after. These pin the pieces that make that so.
 */
const root = resolve(__dirname, '../../../..');
const page = readFileSync(resolve(root, 'app/(app)/tasks/[id]/page.tsx'), 'utf8');
const drawer = readFileSync(resolve(root, 'components/domain/tasks/task-peek-drawer.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'components/domain/tasks/task-fill.css'), 'utf8');

describe('task page below desktop', () => {
  it('drops its own padding and sits on a 16px side gutter, keeping desktop padding', () => {
    expect(page).toContain('<div className="space-y-6 max-lg:-mx-2 lg:p-6" data-task-fill>');
    expect(page).not.toContain('<div className="p-6 space-y-6">');
    expect(page).toContain("import '@/components/domain/tasks/task-fill.css';");
  });
  it('stacks the body in one column until desktop instead of two narrow ones on a tablet', () => {
    expect(page).toContain('<div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={bodyGridStyle} data-testid="task-body-grid">');
  });
});

describe('task drawer below desktop', () => {
  it('fills a phone and carries the same marker', () => {
    expect(drawer).toContain('<DrawerContent side="right" size="xl" className="max-sm:w-full" data-testid="task-peek-drawer" data-task-fill>');
    expect(drawer).toContain("import '@/components/domain/tasks/task-fill.css';");
  });
});

describe('the scoped rules', () => {
  it('apply only below the lg breakpoint and only inside the marker', () => {
    expect(css).toContain('@media (width < 64rem)');
    expect(css).toMatch(/\[data-task-fill\] \[data-card-pad\] \{\s*padding-left: 1rem;\s*padding-right: 1rem;/);
    expect(css).toMatch(/\[data-task-fill\] \[data-card-pad='header'\] \{\s*padding-top: 1rem;/);
    expect(css).toMatch(/\[data-task-fill\] \.bn-editor \{\s*padding-inline: 0;/);
  });
});

describe('card primitives', () => {
  it('mark their padded slots so a page can tighten them, and keep their classes', () => {
    const { container } = render(
      <Card>
        <CardHeader>h</CardHeader>
        <CardContent>c</CardContent>
        <CardFooter>f</CardFooter>
      </Card>
    );
    const header = container.querySelector('[data-card-pad="header"]');
    const content = container.querySelector('[data-card-pad="content"]');
    const footer = container.querySelector('[data-card-pad="footer"]');
    expect(header?.className).toContain('p-6');
    expect(content?.className).toBe('p-6 pt-0');
    expect(footer?.className).toContain('p-6 pt-0');
  });
});
