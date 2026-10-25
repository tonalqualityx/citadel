/**
 * Fleet item 5: the client's yes belongs to the preview they were looking at. The approval pages send the
 * preview address they displayed (`preview_url`); the approve routes pass it to recordTaskClientApproval,
 * which records the yes only if that address is still the task's preview.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function expectedPreview(request: NextRequest): Promise<{ previewUrl: string | null; deployedAt: string | null }> {
  try {
    const body = await request.json();
    const u = body && typeof body.preview_url === 'string' ? body.preview_url.trim() : '';
    const d = body && typeof body.staging_deployed_at === 'string' ? body.staging_deployed_at.trim() : '';
    return { previewUrl: u && u.length <= 500 ? u : null, deployedAt: d && d.length <= 40 ? d : null };
  } catch {
    return { previewUrl: null, deployedAt: null };
  }
}

/** 409: nothing was approved because the preview changed while the client was looking at the old one. */
export function previewChangedResponse(stagingPreviewUrl: string | null, stagingDeployedAt: Date | null = null) {
  return NextResponse.json(
    {
      error: 'This preview was updated while you were looking at it. Nothing was approved. Please open the new preview and review it.',
      code: 'preview_changed',
      staging_preview_url: stagingPreviewUrl,
      staging_deployed_at: stagingDeployedAt,
    },
    { status: 409 }
  );
}
