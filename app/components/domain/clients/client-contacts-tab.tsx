'use client';

import * as React from 'react';
import { UserPlus, Pencil, X, ShieldCheck, Star, Link2, Send } from 'lucide-react';
import {
  useClientContacts,
  useCreateClientContact,
  useUpdateClientContact,
  useDeleteClientContact,
  useContactPortalLoginLink,
} from '@/lib/hooks/use-client-contacts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';
import type { ClientContact, PortalRole } from '@/types/entities';

// Role is the source of truth; the API derives can_initiate_work from it (owner and member = true).
const PORTAL_ROLE_OPTIONS: { value: PortalRole; label: string }[] = [
  { value: 'owner', label: 'Owner (billing, team, approvals)' },
  { value: 'member', label: 'Member (requests, approvals)' },
  { value: 'viewer', label: 'Viewer (read only)' },
  { value: 'none', label: 'None (no portal access)' },
];

interface ClientContactsTabProps {
  clientId: string;
}

interface FormState {
  name: string;
  email: string;
  role: string;
  portal_role: PortalRole;
  is_primary: boolean;
}

const emptyForm: FormState = {
  name: '',
  email: '',
  role: '',
  portal_role: 'viewer',
  is_primary: false,
};

export function ClientContactsTab({ clientId }: ClientContactsTabProps) {
  const { data, isLoading } = useClientContacts(clientId);
  const createContact = useCreateClientContact();
  const updateContact = useUpdateClientContact();
  const deleteContact = useDeleteClientContact();
  const loginLink = useContactPortalLoginLink();

  const [linkBusyId, setLinkBusyId] = React.useState<string | null>(null);

  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm);

  const contacts = data?.contacts ?? [];

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (c: ClientContact) => {
    setEditingId(c.id);
    setForm({
      name: c.name ?? '',
      email: c.email,
      role: c.role ?? '',
      portal_role: c.portal_role ?? 'viewer',
      is_primary: c.is_primary,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    const email = form.email.trim();
    if (!email) {
      showToast.error('Email is required');
      return;
    }
    const payload = {
      name: form.name.trim() || null,
      email,
      role: form.role.trim() || null,
      portal_role: form.portal_role,
      is_primary: form.is_primary,
    };
    try {
      if (editingId) {
        await updateContact.mutateAsync({ id: editingId, clientId, data: payload });
        showToast.updated('Contact');
      } else {
        await createContact.mutateAsync({ clientId, data: payload });
        showToast.created('Contact');
      }
      closeForm();
    } catch (error) {
      showToast.apiError(error, 'Failed to save contact');
    }
  };

  const handleRoleChange = async (c: ClientContact, portal_role: PortalRole) => {
    try {
      await updateContact.mutateAsync({
        id: c.id,
        clientId,
        data: { portal_role },
      });
    } catch (error) {
      showToast.apiError(error, 'Failed to update contact');
    }
  };

  const handleCopyLoginLink = async (c: ClientContact) => {
    setLinkBusyId(c.id);
    try {
      const res = await loginLink.mutateAsync({ id: c.id, send: false });
      await navigator.clipboard.writeText(res.url);
      showToast.success('One-time invite link copied (works once, 7 days, this contact only)');
    } catch (error) {
      showToast.apiError(error, 'Failed to generate login link');
    } finally {
      setLinkBusyId(null);
    }
  };

  const handleSendLoginLink = async (c: ClientContact) => {
    if (!confirm(`Email ${c.email} a one-time portal invite link now?`)) return;
    setLinkBusyId(c.id);
    try {
      await loginLink.mutateAsync({ id: c.id, send: true });
      showToast.success(`One-time invite link sent to ${c.email}`);
    } catch (error) {
      showToast.apiError(error, 'Failed to send login link');
    } finally {
      setLinkBusyId(null);
    }
  };

  const handleDelete = async (c: ClientContact) => {
    if (!confirm(`Remove ${c.email} from this client's contacts?`)) return;
    try {
      await deleteContact.mutateAsync({ id: c.id, clientId });
      showToast.deleted('Contact');
    } catch (error) {
      showToast.apiError(error, 'Failed to remove contact');
    }
  };

  const isSaving = createContact.isPending || updateContact.isPending;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-text-main">Authorized Contacts</h3>
          <p className="text-sm text-text-sub">
            The portal role sets what a contact can do. Owners and members may trigger work via
            email (Can initiate work follows the role). The same person can be a contact on more
            than one client.
          </p>
        </div>
        {!showForm && (
          <Button onClick={openAdd}>
            <UserPlus className="w-4 h-4 mr-2" />
            Add Contact
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input
                label="Name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Jane Doe"
              />
              <Input
                label="Email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@example.com"
              />
              <Input
                label="Role"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                placeholder="Marketing Lead"
              />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="w-64">
                <Select
                  label="Portal role"
                  options={PORTAL_ROLE_OPTIONS}
                  value={form.portal_role}
                  onChange={(v) => {
                    // The shared Select always renders a blank placeholder option; never send ''.
                    if (!v) return;
                    setForm((f) => ({ ...f, portal_role: v as PortalRole }));
                  }}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-text-main">
                <Switch
                  checked={form.is_primary}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_primary: v }))}
                />
                Primary contact
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {isSaving && <Spinner size="sm" className="mr-2" />}
                {editingId ? 'Save Changes' : 'Add Contact'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {contacts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-text-sub">
            No contacts yet. Add the people authorized to request work for this client.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-main truncate">
                      {c.name || c.email}
                    </span>
                    {c.is_primary && (
                      <Badge variant="info" size="sm">
                        <Star className="w-3 h-3 mr-1" />
                        Primary
                      </Badge>
                    )}
                    {c.can_initiate_work ? (
                      <Badge variant="success" size="sm">
                        <ShieldCheck className="w-3 h-3 mr-1" />
                        Authorized
                      </Badge>
                    ) : (
                      <Badge variant="default" size="sm">
                        Not authorized
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-text-sub truncate">
                    {c.name ? `${c.email} · ` : ''}
                    {c.role || 'No role set'}
                  </div>
                </div>
                <div className="w-44 shrink-0">
                  <Select
                    aria-label="Portal role"
                    options={PORTAL_ROLE_OPTIONS}
                    value={c.portal_role ?? 'viewer'}
                    onChange={(v) => {
                      if (!v) return; // blank placeholder option would 400
                      handleRoleChange(c, v as PortalRole);
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyLoginLink(c)}
                  disabled={linkBusyId === c.id}
                  className="p-1.5 text-text-sub hover:text-text-main transition-colors disabled:opacity-50"
                  aria-label="Copy one-time portal invite link for this contact"
                  title="Copy one-time invite link (single use, 7 days, this contact only)"
                >
                  <Link2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleSendLoginLink(c)}
                  disabled={linkBusyId === c.id}
                  className="p-1.5 text-text-sub hover:text-text-main transition-colors disabled:opacity-50"
                  aria-label="Email one-time portal invite link to contact"
                  title="Email one-time invite link to contact"
                >
                  <Send className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(c)}
                  className="p-1.5 text-text-sub hover:text-text-main transition-colors"
                  aria-label="Edit contact"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(c)}
                  className="p-1.5 text-text-sub hover:text-red-600 transition-colors"
                  aria-label="Remove contact"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
