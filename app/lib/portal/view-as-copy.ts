/**
 * Words a person sees while an admin is viewing the portal as a client. The banner and the
 * read-only line are the only copy for this feature, kept here so the copy scan covers them.
 */
export const VIEW_AS_READ_ONLY_LINE = 'This is a read-only view. Nothing was sent or changed.';
export const VIEW_AS_EXIT_LABEL = 'Exit view';
export const VIEW_AS_NO_CONTACT_LINE = 'This client has no contacts yet, so there is no one to view the portal as.';

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', member: 'Member', viewer: 'Viewer' };

export function viewAsRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? 'Viewer';
}

/** The fixed top banner: "Viewing as <Client> (<role>). Read-only." followed by the Exit view control. */
export function viewAsBannerText(clientName: string, role: string): string {
  return `Viewing as ${clientName} (${viewAsRoleLabel(role)}). Read-only.`;
}
