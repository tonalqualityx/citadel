import { NextRequest, NextResponse } from 'next/server';
import { requireChatOwnerForSettings } from '@/lib/bast-chat/access';
import { getSettings, settingsPatchSchema, updateSettings } from '@/lib/bast-chat/settings';
import { chatError, chatJson, ownerJsonBody, ownerPostGuard } from '@/lib/bast-chat/route-helpers';

/** GET /api/bast-chat/admin/settings: owner and admin, session only, allowed while the chat is off. */
export async function GET(): Promise<NextResponse> {
  try {
    await requireChatOwnerForSettings();
    return chatJson({ settings: await getSettings() });
  } catch (error) {
    return chatError(error);
  }
}

/** PATCH /api/bast-chat/admin/settings: strict partial body, Sonnet or Haiku only. 200 {settings}. */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const { auth } = await requireChatOwnerForSettings();
    const refused = ownerPostGuard(request);
    if (refused) return refused;
    const patch = await ownerJsonBody(request, settingsPatchSchema);
    return chatJson({ settings: await updateSettings(patch, auth.userId) });
  } catch (error) {
    return chatError(error);
  }
}
