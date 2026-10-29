'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useAuth } from '@/lib/hooks/use-auth';
import { useDesignFolder, useSetDesignFolder, isDriveFolderId, type DesignFolderKind } from '@/lib/hooks/use-design-folders';

interface Props {
  kind: DesignFolderKind;
  id: string;
  label: string;
  helper?: string;
}

export const DRIVE_FOLDER_HELPER = 'The folder in the shared Clients drive the Designer Portal may read. Paste the id from the Drive URL.';
export const DRIVE_FOLDER_ID_ERROR = 'Not a Drive folder id. Use the 20 to 100 letters, digits, "-" or "_" from the folder URL.';

/** Admin-only Drive folder id field. Renders nothing for anyone who is not an admin. */
export function DriveFolderField({ kind, id, label, helper = DRIVE_FOLDER_HELPER }: Props) {
  const { isAdmin } = useAuth();
  const { data } = useDesignFolder(kind, id, isAdmin);
  const save = useSetDesignFolder(kind, id);
  // null until the user types; the shown value falls back to the saved id so no effect syncs it.
  const [edited, setEdited] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = edited ?? data?.drive_folder_id ?? '';
  const setDraft = setEdited;

  if (!isAdmin) return null;

  const handleSave = async () => {
    const value = draft.trim();
    if (!isDriveFolderId(value)) {
      setError(DRIVE_FOLDER_ID_ERROR);
      return;
    }
    setError(null);
    try {
      await save.mutateAsync(value);
      setDraft(value);
    } catch {
      // the mutation's onError already shows the toast
    }
  };

  const handleClear = async () => {
    setError(null);
    try {
      await save.mutateAsync(null);
      setDraft('');
    } catch {
      // the mutation's onError already shows the toast
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-text-sub">{helper}</p>
        <Input
          aria-label={label}
          label="Drive folder id"
          value={draft}
          placeholder="Paste the folder id"
          disabled={save.isPending}
          error={error ?? undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={handleSave} disabled={save.isPending}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={handleClear} disabled={save.isPending || !data?.drive_folder_id}>
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
