'use client';

import * as React from 'react';
import { Bell, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { NotificationPreferences } from '@/components/domain/settings/notification-preferences';

export default function NotificationSettingsPage() {
  return (
    <div className="max-w-3xl">
      {/* Back link */}
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-text-sub hover:text-text-main mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Settings
      </Link>

      {/* Header */}
      <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
        <Bell className="h-6 w-6" />
        Notification Preferences
      </h1>
      <p className="mt-2 text-text-sub">
        Choose how you want to be notified for different types of events.
      </p>

      {/* Preferences Matrix */}
      <div className="mt-8 bg-surface rounded-lg border border-border-warm">
        <NotificationPreferences />
      </div>
    </div>
  );
}
