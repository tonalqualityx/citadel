'use client';

import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  useClientBrandProfile,
  useUpdateClientBrandProfile,
  useSiteBrandProfile,
  useUpdateSiteBrandProfile,
} from '@/lib/hooks/use-brand-profile';
import type { BrandProfile, ResolvedBrandProfile, UpdateBrandProfileInput } from '@/types/entities';

interface BrandTabProps {
  ownerType: 'client' | 'site';
  ownerId: string;
  /** For the site tab's inherited-value hints. */
  clientName?: string | null;
}

interface FormState {
  voice_profile: string;
  figma_url: string;
  component_library_ref: string;
  brand_tokens: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  voice_profile: '',
  figma_url: '',
  component_library_ref: '',
  brand_tokens: '',
  notes: '',
};

/** value (string | JSON object | null) → text for an input/textarea. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function formFromProfile(profile: BrandProfile | null | undefined): FormState {
  if (!profile) return { ...EMPTY_FORM };
  return {
    voice_profile: toText(profile.voice_profile),
    figma_url: toText(profile.figma_url),
    component_library_ref: toText(profile.component_library_ref),
    brand_tokens: toText(profile.brand_tokens),
    notes: toText(profile.notes),
  };
}

export function BrandTab({ ownerType, ownerId, clientName }: BrandTabProps) {
  const isClient = ownerType === 'client';

  const clientQuery = useClientBrandProfile(isClient ? ownerId : undefined);
  const siteQuery = useSiteBrandProfile(isClient ? undefined : ownerId);
  const updateClient = useUpdateClientBrandProfile(ownerId);
  const updateSite = useUpdateSiteBrandProfile(ownerId);

  const query = isClient ? clientQuery : siteQuery;
  const own = query.data?.profile ?? null;
  const resolved: ResolvedBrandProfile | null = isClient
    ? null
    : (siteQuery.data?.resolved ?? null);
  const mutation = isClient ? updateClient : updateSite;

  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [tokensError, setTokensError] = React.useState<string | null>(null);

  // Re-sync the form to server truth on first load and after each successful save
  // (own.updated_at changes), without clobbering in-progress edits.
  const syncedAt = React.useRef<string | null>(null);
  React.useEffect(() => {
    const stamp = own?.updated_at ?? 'none';
    if (syncedAt.current !== stamp) {
      syncedAt.current = stamp;
      setForm(formFromProfile(own));
      setTokensError(null);
    }
  }, [own]);

  const setField = (field: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (field === 'brand_tokens') setTokensError(null);
  };

  const handleSave = async () => {
    const payload: UpdateBrandProfileInput = {
      voice_profile: form.voice_profile.trim() === '' ? null : form.voice_profile,
      figma_url: form.figma_url.trim() === '' ? null : form.figma_url.trim(),
      component_library_ref:
        form.component_library_ref.trim() === '' ? null : form.component_library_ref.trim(),
      notes: form.notes.trim() === '' ? null : form.notes,
    };

    // brand_tokens is freeform JSON — validate before sending so we never store unparseable text.
    if (form.brand_tokens.trim() === '') {
      payload.brand_tokens = null;
    } else {
      try {
        payload.brand_tokens = JSON.parse(form.brand_tokens);
      } catch {
        setTokensError('Brand tokens must be valid JSON.');
        return;
      }
    }

    await mutation.mutateAsync(payload);
  };

  if (query.isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  // For the site tab: when a field is empty, show the value it inherits from the client.
  const inheritedHint = (field: keyof ResolvedBrandProfile) => {
    if (isClient || !resolved) return null;
    if (form[field as keyof FormState].trim() !== '') return null;
    const r = resolved[field];
    if (r.source !== 'client' || r.value == null) return null;
    return (
      <p className="mt-1 text-xs text-text-sub italic truncate">
        Inherits from {clientName || 'client'}: {toText(r.value).replace(/\s+/g, ' ').slice(0, 120)}
      </p>
    );
  };

  return (
    <div className="space-y-6">
      {!isClient && (
        <p className="text-sm text-text-sub">
          Fields left blank inherit from the client&apos;s brand profile. Set a field here to
          override it for this site only.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Textarea
              label="Voice profile"
              value={form.voice_profile}
              onChange={(e) => setField('voice_profile', e.target.value)}
              placeholder="How this brand sounds — tone, phrasing, do's and don'ts..."
              rows={6}
            />
            {inheritedHint('voice_profile')}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Design</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Input
              label="Figma URL"
              value={form.figma_url}
              onChange={(e) => setField('figma_url', e.target.value)}
              placeholder="https://figma.com/..."
              type="url"
            />
            {inheritedHint('figma_url')}
          </div>
          <div>
            <Input
              label="Component library ref"
              value={form.component_library_ref}
              onChange={(e) => setField('component_library_ref', e.target.value)}
              placeholder="e.g. @client/ui or a repo path"
            />
            {inheritedHint('component_library_ref')}
          </div>
          <div>
            <Textarea
              label="Brand tokens (JSON)"
              value={form.brand_tokens}
              onChange={(e) => setField('brand_tokens', e.target.value)}
              placeholder={'{\n  "colors": ["#1a1a1a"],\n  "fonts": ["Inter"]\n}'}
              rows={6}
              error={tokensError || undefined}
            />
            {inheritedHint('brand_tokens')}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={form.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Anything else worth recording about this brand..."
            rows={4}
          />
          {inheritedHint('notes')}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving...' : 'Save brand profile'}
        </Button>
      </div>
    </div>
  );
}
