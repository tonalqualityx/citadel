import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { MAX_FILE_BYTES } from '@/lib/services/uploads';
import { stageUpload } from '@/lib/portal/chat/upload-service';

// POST /api/portal/uploads (multipart: file, intake_id | conversation_id) (portal phase C)
// One file, staged under the contact and unbound until a message references it. The type comes from
// the file's own bytes; SVG, HTML, executables, archives and macro Office are refused. Stored
// privately. 201 { attachment }.
export async function POST(request: NextRequest) {
  try {
    const limited = rateLimit(request, 60);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const form = await request.formData();
    const file = form.get('file') as { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } | string | null;
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') throw new ApiError('No file provided', 400, 'bad_upload');
    if (file.size > MAX_FILE_BYTES) throw new ApiError('That file is too large. The limit is 20 MB.', 413, 'file_too_large');
    const intake = z.string().uuid().nullish().parse(form.get('intake_id') || null);
    const conv = z.string().uuid().nullish().parse(form.get('conversation_id') || null);
    const att = await stageUpload(access, { buffer: Buffer.from(await file.arrayBuffer()), name: file.name, intake_id: intake, conversation_id: conv });
    return NextResponse.json(
      { attachment: { id: att.id, name: att.filename, type: att.content_type, size: att.size_bytes, url: `/api/portal/attachments/${att.id}` } },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
