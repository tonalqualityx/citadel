'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { InlineText, InlineSelect } from '@/components/ui/inline-edit';
import type { SiteWithRelations, UpdateSiteInput, SiteType } from '@/types/entities';

const SITE_TYPE_OPTIONS = [
  { value: 'eleventy', label: 'Eleventy (git)' },
  { value: 'wordpress', label: 'WordPress (REST)' },
  { value: 'handoff', label: 'Handoff' },
];

/**
 * Troubador publishing config for a site. Picks site_type, then shows the
 * fields that target needs. Eleventy build instructions live in the repo's
 * troubador.config.json; this only stores the pointer.
 */
export function SitePublishingCard({
  site,
  onUpdate,
}: {
  site: SiteWithRelations;
  onUpdate: (updates: UpdateSiteInput) => void;
}) {
  const type = site.site_type;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Publishing (Troubador)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-xs font-medium text-text-sub">Target</label>
          <InlineSelect
            value={type ?? ''}
            options={SITE_TYPE_OPTIONS}
            onChange={(value) => onUpdate({ site_type: (value || null) as SiteType | null })}
            placeholder="Not configured…"
          />
        </div>

        {type === 'eleventy' && (
          <>
            <Field label="Repo URL">
              <InlineText
                value={site.repo_url}
                onChange={(repo_url) => onUpdate({ repo_url })}
                placeholder="git@github.com:org/site.git"
              />
            </Field>
            <Field label="Branch">
              <InlineText
                value={site.repo_branch}
                onChange={(repo_branch) => onUpdate({ repo_branch })}
                placeholder="main"
              />
            </Field>
            <Field label="Content directory">
              <InlineText
                value={site.content_dir}
                onChange={(content_dir) => onUpdate({ content_dir })}
                placeholder="src/posts"
              />
            </Field>
            <p className="text-xs text-text-sub">
              Build details (filename, frontmatter, future-date filter) live in the repo&apos;s{' '}
              <code>troubador.config.json</code>.
            </p>
          </>
        )}

        {type === 'wordpress' && (
          <>
            <Field label="REST base URL">
              <InlineText
                value={site.wp_base_url}
                onChange={(wp_base_url) => onUpdate({ wp_base_url })}
                placeholder="https://example.com"
              />
            </Field>
            <Field label="Default author (numeric ID)">
              <InlineText
                value={site.wp_default_author}
                onChange={(wp_default_author) => onUpdate({ wp_default_author })}
                placeholder="1"
              />
            </Field>
            <Field label="Default category (numeric ID)">
              <InlineText
                value={site.wp_default_category}
                onChange={(wp_default_category) => onUpdate({ wp_default_category })}
                placeholder="1"
              />
            </Field>
            <p className="text-xs text-text-sub">
              App password lives on the Bast machine, not here. Confirm the site timezone.
            </p>
          </>
        )}

        {type === 'handoff' && (
          <>
            <Field label="Method">
              <InlineText
                value={site.handoff_method}
                onChange={(handoff_method) => onUpdate({ handoff_method })}
                placeholder="citadel_card | email | drive"
              />
            </Field>
            <Field label="Recipient">
              <InlineText
                value={site.handoff_recipient}
                onChange={(handoff_recipient) => onUpdate({ handoff_recipient })}
                placeholder="who receives the package"
              />
            </Field>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-text-sub">{label}</label>
      {children}
    </div>
  );
}
