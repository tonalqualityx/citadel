'use client';

import * as React from 'react';
import { Settings, Palette, Bell, Type, Check, Loader2, Camera, User } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePreferences, useUpdatePreferences } from '@/lib/hooks/use-preferences';
import { useAuth } from '@/lib/hooks/use-auth';
import { applyTheme, type Theme } from '@/lib/utils/theme';
import { apiClient } from '@/lib/api/client';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function GuildPage() {
  const { data, isLoading } = usePreferences();
  const { user } = useAuth();
  const updatePreferences = useUpdatePreferences();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState('');
  const [isUploading, setIsUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Initialize name from user data
  React.useEffect(() => {
    if (user?.name) {
      setName(user.name);
    }
  }, [user?.name]);

  const updateProfile = useMutation({
    mutationFn: async (data: { name?: string; avatar_url?: string | null }) => {
      return apiClient.patch('/users/me', data);
    },
    onSuccess: () => {
      // Invalidate all queries that might contain user data (avatar, name)
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/uploads', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const { url } = await response.json();
      await updateProfile.mutateAsync({ avatar_url: url });
    } catch (error) {
      console.error('Failed to upload avatar:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleNameSave = () => {
    if (name.trim() && name !== user?.name) {
      updateProfile.mutate({ name: name.trim() });
    }
  };

  const preferences = data?.preferences;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <Settings className="h-6 w-6" />
        Guild Settings
      </h1>
      <p className="mt-2 text-text-sub">
        Customize your Indelible experience.
      </p>

      <div className="mt-8 space-y-6">
        {/* Profile */}
        <SettingsCard
          icon={User}
          title="Profile"
          description="Update your profile information and avatar."
        >
          <div className="flex items-start gap-6">
            {/* Avatar Upload */}
            <div className="relative">
              <Avatar
                src={user?.avatar_url}
                name={user?.name || 'User'}
                size="xl"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="absolute bottom-0 right-0 p-1.5 rounded-full bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* Name Field */}
            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">
                  Display Name
                </label>
                <div className="flex gap-2">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className="flex-1"
                  />
                  <Button
                    onClick={handleNameSave}
                    disabled={!name.trim() || name === user?.name || updateProfile.isPending}
                  >
                    {updateProfile.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-text-sub">
                {user?.email}
              </p>
            </div>
          </div>
        </SettingsCard>

        {/* Naming Convention */}
        <SettingsCard
          icon={Type}
          title="Naming Convention"
          description="Choose how entities are labeled throughout the app."
        >
          <div className="grid grid-cols-2 gap-4">
            <NamingOption
              value="awesome"
              current={preferences?.naming_convention || 'awesome'}
              onChange={(value) =>
                updatePreferences.mutate({ naming_convention: value })
              }
              title="Awesome Mode"
              description="Patrons, Pacts, Quests, Runes, Rituals"
              isPending={updatePreferences.isPending}
            />
            <NamingOption
              value="standard"
              current={preferences?.naming_convention || 'awesome'}
              onChange={(value) =>
                updatePreferences.mutate({ naming_convention: value })
              }
              title="Standard Mode"
              description="Clients, Projects, Tasks, SOPs, Templates"
              isPending={updatePreferences.isPending}
            />
          </div>
        </SettingsCard>

        {/* Theme */}
        <SettingsCard
          icon={Palette}
          title="Theme"
          description="Choose your preferred color scheme."
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(['system', 'light', 'dim', 'dark'] as const).map((theme) => (
              <ThemeOption
                key={theme}
                value={theme}
                current={preferences?.theme || 'system'}
                onChange={(value) => {
                  applyTheme(value); // Apply immediately
                  updatePreferences.mutate({ theme: value }); // Save to API
                }}
                isPending={updatePreferences.isPending}
              />
            ))}
          </div>
        </SettingsCard>

        {/* Notification Preferences */}
        <SettingsCard
          icon={Bell}
          title="Notification Preferences"
          description="Configure how you receive notifications across different channels."
        >
          <div className="space-y-4">
            {/* Bundling toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={preferences?.notification_bundle ?? true}
                  onChange={(e) =>
                    updatePreferences.mutate({ notification_bundle: e.target.checked })
                  }
                />
                <div className="w-11 h-6 bg-background-light rounded-full peer peer-checked:bg-primary transition-colors" />
                <div className="absolute left-1 top-1 w-4 h-4 bg-surface rounded-full shadow transition-transform peer-checked:translate-x-5" />
              </div>
              <span className="text-sm text-text-main">
                {preferences?.notification_bundle
                  ? 'Bundling enabled'
                  : 'Bundling disabled'}
              </span>
            </label>
            <p className="text-xs text-text-sub">
              When enabled, similar notifications within 30 minutes are grouped together.
            </p>

            {/* Link to full preferences page */}
            <a
              href="/settings/notifications"
              className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80 font-medium"
            >
              Configure notification channels →
            </a>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface rounded-lg border border-border-warm p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-main">{title}</h2>
          <p className="text-sm text-text-sub">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function NamingOption({
  value,
  current,
  onChange,
  title,
  description,
  isPending,
}: {
  value: 'awesome' | 'standard';
  current: string;
  onChange: (value: 'awesome' | 'standard') => void;
  title: string;
  description: string;
  isPending: boolean;
}) {
  const isSelected = current === value;

  return (
    <button
      onClick={() => onChange(value)}
      disabled={isPending}
      className={`relative p-4 rounded-lg border-2 text-left transition-all ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border-warm hover:border-primary/50'
      }`}
    >
      {isSelected && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
          <Check className="h-3 w-3 text-white" />
        </div>
      )}
      <h3 className="font-medium text-text-main">{title}</h3>
      <p className="text-sm text-text-sub mt-1">{description}</p>
    </button>
  );
}

function ThemeOption({
  value,
  current,
  onChange,
  isPending,
}: {
  value: 'light' | 'dim' | 'dark' | 'system';
  current: string;
  onChange: (value: 'light' | 'dim' | 'dark' | 'system') => void;
  isPending: boolean;
}) {
  const isSelected = current === value;
  const labels = {
    system: 'System',
    light: 'Light',
    dim: 'Dim',
    dark: 'Dark',
  };

  const colors = {
    system: 'bg-gradient-to-br from-amber-100 to-slate-800',
    light: 'bg-amber-50',
    dim: 'bg-slate-600',
    dark: 'bg-slate-800',
  };

  return (
    <button
      onClick={() => onChange(value)}
      disabled={isPending}
      className={`p-3 rounded-lg border-2 text-center transition-all ${
        isSelected
          ? 'border-primary'
          : 'border-border-warm hover:border-primary/50'
      }`}
    >
      <div
        className={`w-full h-8 rounded mb-2 ${colors[value]} ${
          value === 'light' ? 'border border-border-warm' : ''
        }`}
      />
      <span className="text-sm font-medium text-text-main">{labels[value]}</span>
    </button>
  );
}
