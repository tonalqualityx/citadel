'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { canPreview, MAX_FILES, MAX_FILE_BYTES, type Draft } from './types';

// Files in the composer. Each is uploaded as soon as it is chosen (POST /api/portal/uploads, one
// file per request) so the client sees progress, and is bound to the message when it is sent.
// XMLHttpRequest, not fetch, because only XHR reports upload progress.
export function useUploads(scope: { intakeId?: string | null; conversationId?: string | null }, onAuthLost?: () => void) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const urls = useRef<string[]>([]);

  useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const patch = useCallback((key: string, p: Partial<Draft>) => setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...p } : d))), []);

  const draftsRef = useRef<Draft[]>([]);
  draftsRef.current = drafts;

  const add = useCallback((files: File[]) => {
    setProblem(null);
    const room = MAX_FILES - draftsRef.current.length;
    const take = files.slice(0, Math.max(0, room));
    if (files.length > take.length) setProblem(`You can attach up to ${MAX_FILES} files to one message.`);
    const next: Draft[] = [];
    const toUpload: Array<[string, File]> = [];
    for (const f of take) {
      const key = crypto.randomUUID();
      if (f.size > MAX_FILE_BYTES) {
        next.push({ key, name: f.name, size: f.size, type: f.type, preview: null, progress: 0, id: null, error: 'That file is too large. The limit is 20 MB.' });
        continue;
      }
      let preview: string | null = null;
      if (canPreview(f.type)) {
        preview = URL.createObjectURL(f);
        urls.current.push(preview);
      }
      next.push({ key, name: f.name, size: f.size, type: f.type, preview, progress: 0, id: null, error: null });
      toUpload.push([key, f]);
    }
    if (next.length === 0) return;
    draftsRef.current = [...draftsRef.current, ...next];
    setDrafts(draftsRef.current);
    for (const [key, f] of toUpload) upload(key, f);
    // upload only reads refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function upload(key: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    const { intakeId, conversationId } = scopeRef.current;
    if (conversationId) form.append('conversation_id', conversationId);
    else if (intakeId) form.append('intake_id', intakeId);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/portal/uploads');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) patch(key, { progress: Math.min(99, Math.round((e.loaded / e.total) * 100)) });
    };
    xhr.onerror = () => patch(key, { error: 'That file did not upload. Try again.' });
    xhr.onload = () => {
      if (xhr.status === 401) {
        onAuthLost?.();
        return;
      }
      let body: { attachment?: { id: string }; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* a non-JSON failure falls through to the generic line */
      }
      if (xhr.status === 201 && body.attachment) patch(key, { id: body.attachment.id, progress: 100 });
      else patch(key, { error: body.error || 'That file did not upload. Try again.' });
    };
    xhr.send(form);
  }

  const remove = useCallback((key: string) => setDrafts((prev) => prev.filter((d) => d.key !== key)), []);
  const clear = useCallback(() => setDrafts([]), []);

  const ready = drafts.filter((d) => d.id).map((d) => d.id as string);
  const busy = drafts.some((d) => !d.id && !d.error);
  return { drafts, add, remove, clear, ready, busy, problem };
}
