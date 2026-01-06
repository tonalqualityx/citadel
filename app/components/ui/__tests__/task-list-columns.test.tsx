import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { clientProjectSiteColumn } from '../task-list-columns';

describe('clientProjectSiteColumn', () => {
  const column = clientProjectSiteColumn();

  describe('column properties', () => {
    it('should have correct key', () => {
      expect(column.key).toBe('client_project_site');
    });

    it('should have correct header', () => {
      expect(column.header).toBe('Client / Project');
    });

    it('should have correct width', () => {
      expect(column.width).toBe('minmax(150px, 2fr)');
    });
  });

  describe('cell rendering for project-based tasks', () => {
    it('should show client → project when project has client', () => {
      const task = {
        project: {
          id: 'proj-1',
          name: 'Website Redesign',
          client: { id: 'client-1', name: 'Acme Corp' },
          site: null,
        },
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('Acme Corp → Website Redesign');
    });

    it('should show client → project → site when all present', () => {
      const task = {
        project: {
          id: 'proj-1',
          name: 'Hosting Support',
          client: { id: 'client-1', name: 'Acme Corp' },
          site: { id: 'site-1', name: 'acme.com' },
        },
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('Acme Corp → Hosting Support → acme.com');
    });

    it('should show just project name when no client', () => {
      const task = {
        project: {
          id: 'proj-1',
          name: 'Internal Project',
          client: null,
          site: null,
        },
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('Internal Project');
    });

    it('should show project → site when no client but has site', () => {
      const task = {
        project: {
          id: 'proj-1',
          name: 'Site Migration',
          client: null,
          site: { id: 'site-1', name: 'example.com' },
        },
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('Site Migration → example.com');
    });
  });

  describe('cell rendering for ad-hoc tasks (no project)', () => {
    it('should show client → site for ad-hoc task with both', () => {
      const task = {
        project: null,
        client: { id: 'client-1', name: 'Acme Corp' },
        site: { id: 'site-1', name: 'acme.com' },
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('Acme Corp → acme.com');
    });

    it('should show just client for ad-hoc task with client only', () => {
      const task = {
        project: null,
        client: { id: 'client-1', name: 'Acme Corp' },
        site: null,
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('Acme Corp');
    });

    it('should show just site for ad-hoc task with site only', () => {
      const task = {
        project: null,
        client: null,
        site: { id: 'site-1', name: 'orphan-site.com' },
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('orphan-site.com');
    });

    it('should show "Ad-hoc" for task with no project, client, or site', () => {
      const task = {
        project: null,
        client: null,
        site: null,
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('Ad-hoc');
    });

    it('should show "Ad-hoc" when client and site are undefined', () => {
      const task = {
        project: null,
      };

      const { container } = render(<>{column.cell(task)}</>);
      expect(container.textContent).toBe('Ad-hoc');
    });
  });

  describe('title attribute for truncation tooltip', () => {
    it('should include title attribute with full path for project tasks', () => {
      const task = {
        project: {
          id: 'proj-1',
          name: 'Very Long Project Name That Might Get Truncated',
          client: { id: 'client-1', name: 'Very Long Client Name' },
          site: { id: 'site-1', name: 'very-long-site-name.com' },
        },
      };

      const { container } = render(<>{column.cell(task)}</>);
      const div = container.querySelector('div');
      expect(div?.getAttribute('title')).toBe(
        'Very Long Client Name → Very Long Project Name That Might Get Truncated → very-long-site-name.com'
      );
    });

    it('should include title attribute with full path for ad-hoc tasks', () => {
      const task = {
        project: null,
        client: { id: 'client-1', name: 'Long Client Name' },
        site: { id: 'site-1', name: 'long-site.com' },
      };

      const { container } = render(<>{column.cell(task)}</>);
      const div = container.querySelector('div');
      expect(div?.getAttribute('title')).toBe('Long Client Name → long-site.com');
    });
  });
});
