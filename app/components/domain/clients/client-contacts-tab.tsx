'use client';

import * as React from 'react';
import { UserPlus, Pencil, X, ShieldCheck, Star } from 'lucide-react';
import {
  useClientContacts,
  useCreateClientContact,
  useUpdateClientContact,
  useDeleteClientContact,
} from '@/lib/hooks/use-client-contacts';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';
import type { ClientContact } from '@/types/entities';

interface ClientContactsTabProps {
  clientId: string;
}

interface FormState {
  name: string;
  email: string;
  role: string;
  can_initiate_work: boolean;
  is_primary: boolean;
}

const emptyForm: FormState = {
  name: '',
  email: '',
  role: '',
  can_initiate_work: false,
  is_primary: false,
};

export function ClientContactsTab({ clientId }: ClientContactsTabProps) {
  const { data, isLoading } = useClientContacts(clientId);
  const createContact = useCreateClientContact();
  const updateContact = useUpdateClientContact();
  const deleteContact = useDeleteClientContact();

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
      can_initiate_work: c.can_initiate_work,
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
      can_initiate_work: form.can_initiate_work,
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

  const handleToggleAuthorized = async (c: ClientContact) => {
    try {
      await updateContact.mutateAsync({
        id: c.id,
        clientId,
        data: { can_initiate_work: !c.can_initiate_work },
      });
    } catch (error) {
      showToast.apiError(error, 'Failed to update contact');
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
            Only contacts marked <span className="font-medium">Can initiate work</span> may trigger
            work via email. The same person can be a contact on more than one client.
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
              <label className="flex items-center gap-2 text-sm text-text-main">
                <Switch
                  checked={form.can_initiate_work}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, can_initiate_work: v }))}
                />
                Can initiate work
              </label>
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
                <label className="flex items-center gap-2 text-xs text-text-sub shrink-0">
                  <Switch
                    checked={c.can_initiate_work}
                    onCheckedChange={() => handleToggleAuthorized(c)}
                  />
                  Can initiate work
                </label>
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
