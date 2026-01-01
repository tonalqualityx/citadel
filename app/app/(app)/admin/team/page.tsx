'use client';

import * as React from 'react';
import { Plus, Pencil, Trash2, Key, Users } from 'lucide-react';
import {
  useUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useResetUserPassword,
  type User,
  type CreateUserInput,
  type UpdateUserInput,
} from '@/lib/hooks/use-users';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import { formatRelativeTime } from '@/lib/utils/time';
import { UserFunctionManager } from '@/components/domain/admin/user-function-manager';
import { useAuth } from '@/lib/hooks/use-auth';

const ROLE_OPTIONS = [
  { value: 'tech', label: 'Tech' },
  { value: 'pm', label: 'PM' },
  { value: 'admin', label: 'Admin' },
];

function getRoleBadgeVariant(role: string): 'default' | 'warning' | 'success' {
  switch (role) {
    case 'admin':
      return 'warning';
    case 'pm':
      return 'success';
    default:
      return 'default';
  }
}

export default function TeamAdminPage() {
  const [includeInactive, setIncludeInactive] = React.useState(true);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<User | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<string | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = React.useState<User | null>(null);
  const [newPassword, setNewPassword] = React.useState('');

  const { data, isLoading, error } = useUsers({ includeInactive });
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();
  const resetPasswordMutation = useResetUserPassword();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  const [formData, setFormData] = React.useState<CreateUserInput & { target_hours_per_week?: number }>({
    name: '',
    email: '',
    password: '',
    role: 'tech',
    target_hours_per_week: 40,
  });

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ name: '', email: '', password: '', role: 'tech', target_hours_per_week: 40 });
    setIsModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: '', // Not used for edit
      role: user.role,
      target_hours_per_week: user.target_hours_per_week,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const updateData: UpdateUserInput = {
          name: formData.name,
          email: formData.email,
          role: formData.role,
          target_hours_per_week: formData.target_hours_per_week,
        };
        await updateMutation.mutateAsync({ id: editingUser.id, data: updateData });
      } else {
        await createMutation.mutateAsync(formData);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to save:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !newPassword) return;
    try {
      await resetPasswordMutation.mutateAsync({
        id: resetPasswordUser.id,
        password: newPassword,
      });
      setResetPasswordUser(null);
      setNewPassword('');
    } catch (err) {
      console.error('Failed to reset password:', err);
    }
  };

  const handleToggleActive = async (user: User) => {
    try {
      await updateMutation.mutateAsync({
        id: user.id,
        data: { is_active: !user.is_active },
      });
    } catch (err) {
      console.error('Failed to toggle active:', err);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<Users className="h-12 w-12" />}
              title="Error loading users"
              description="There was a problem loading the data. Please try again."
              action={<Button onClick={() => window.location.reload()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main">Team Management</h1>
          <p className="text-text-sub">Manage user accounts and permissions</p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="h-4 w-4 rounded border-border-warm text-primary focus:ring-primary"
            />
            Show inactive users
          </label>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <SkeletonTable rows={5} columns={5} />
          ) : data?.users.length === 0 ? (
            <EmptyState
              icon={<Users className="h-12 w-12" />}
              title="No users found"
              description="Get started by adding your first team member"
              action={
                <Button onClick={openCreateModal}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              }
            />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-warm bg-background-light">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider w-24">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider w-24">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-sub uppercase tracking-wider">
                    Last Login
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-sub uppercase tracking-wider w-32">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-warm">
                {data?.users.map((user) => (
                  <tr key={user.id} className="hover:bg-background-light/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url}
                            alt={user.name}
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-text-main">{user.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-sub">{user.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={getRoleBadgeVariant(user.role)}>
                        {user.role.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={user.is_active ? 'success' : 'default'}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-sub">
                        {user.last_login_at
                          ? formatRelativeTime(user.last_login_at)
                          : 'Never'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setResetPasswordUser(user)}
                          title="Reset password"
                        >
                          <Key className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(user)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirm(user.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      <Modal open={isModalOpen} onOpenChange={setIsModalOpen}>
        <ModalContent>
          <form onSubmit={handleSubmit}>
            <ModalHeader>
              <ModalTitle>{editingUser ? 'Edit User' : 'Add User'}</ModalTitle>
            </ModalHeader>
            <ModalBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">Name *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">Email *</label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-text-main mb-1">
                    Password *
                  </label>
                  <Input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    minLength={8}
                    placeholder="Minimum 8 characters"
                  />
                </div>
              )}
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-text-main mb-1">Role *</label>
                  <Select
                    options={ROLE_OPTIONS}
                    value={formData.role || 'tech'}
                    onChange={(value) =>
                      setFormData({ ...formData, role: value as 'tech' | 'pm' | 'admin' })
                    }
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">
                  Target Hours/Week
                </label>
                <Input
                  type="number"
                  min={0}
                  max={80}
                  value={formData.target_hours_per_week ?? 40}
                  onChange={(e) =>
                    setFormData({ ...formData, target_hours_per_week: parseInt(e.target.value) || 40 })
                  }
                />
                <p className="text-xs text-text-sub mt-1">
                  Used for utilization calculations in reports
                </p>
              </div>
              {editingUser && isAdmin && (
                <div>
                  <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingUser.is_active}
                      onChange={() => handleToggleActive(editingUser)}
                      className="h-4 w-4 rounded border-border-warm text-primary focus:ring-primary"
                    />
                    Active
                  </label>
                </div>
              )}
              {editingUser && (
                <div className="border-t border-border pt-4 mt-4">
                  <label className="block text-sm font-medium text-text-main mb-2">
                    Function Qualifications
                  </label>
                  <p className="text-xs text-text-sub mb-3">
                    Functions this user is qualified to perform on projects
                  </p>
                  <UserFunctionManager userId={editingUser.id} />
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>

      {/* Reset Password Modal */}
      <Modal open={!!resetPasswordUser} onOpenChange={() => setResetPasswordUser(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Reset Password</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-text-sub">
              Enter a new password for <strong>{resetPasswordUser?.name}</strong>
            </p>
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                New Password *
              </label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                placeholder="Minimum 8 characters"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setResetPasswordUser(null);
                setNewPassword('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleResetPassword}
              disabled={resetPasswordMutation.isPending || newPassword.length < 8}
            >
              {resetPasswordMutation.isPending ? 'Resetting...' : 'Reset Password'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete User</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-text-sub">
              Are you sure you want to delete this user? If the user has related records
              (tasks, time entries, etc.), they will be deactivated instead.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
