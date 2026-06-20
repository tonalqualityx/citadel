'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { InlineText, InlineSelect } from '@/components/ui/inline-edit';
import { Switch } from '@/components/ui/switch';
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

            <div className="pt-2 mt-2 border-t border-border">
              <p className="text-xs font-semibold text-text-main mb-2">Staging &amp; deploy</p>
              <Field label="Prod branch">
                <InlineText
                  value={site.prod_branch}
                  onChange={(prod_branch) => onUpdate({ prod_branch })}
                  placeholder="main (defaults to repo branch)"
                />
              </Field>
              <Field label="Staging branch">
                <InlineText
                  value={site.staging_branch}
                  onChange={(staging_branch) => onUpdate({ staging_branch })}
                  placeholder="staging"
                />
              </Field>
              <Field label="Staging URL">
                <InlineText
                  value={site.staging_url}
                  onChange={(staging_url) => onUpdate({ staging_url })}
                  placeholder="staging.example.com"
                />
              </Field>
              <Field label="Staging auth user">
                <InlineText
                  value={site.staging_auth_user}
                  onChange={(staging_auth_user) => onUpdate({ staging_auth_user })}
                  placeholder="basic-auth user (keeps bots out)"
                />
              </Field>
              <Field label="Staging auth password">
                <InlineText
                  value={site.staging_auth_password}
                  onChange={(staging_auth_password) => onUpdate({ staging_auth_password })}
                  placeholder="basic-auth password (gate only)"
                />
              </Field>
            </div>
          </>
        )}

        <div className="pt-2 mt-2 border-t border-border flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-text-main">Bast may auto-edit this site</p>
            <p className="text-xs text-text-sub">Only when the matched SOP is also Bast-executable.</p>
          </div>
          <Switch
            checked={site.bast_enabled ?? false}
            onCheckedChange={(bast_enabled) => onUpdate({ bast_enabled })}
          />
        </div>

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
