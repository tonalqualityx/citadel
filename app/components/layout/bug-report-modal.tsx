'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Bug } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import {
  useBugReportSettings,
  isBugReportConfigured,
} from '@/lib/hooks/use-bug-report-settings';
import { getConsoleLogs, formatConsoleLogsForReport } from '@/lib/hooks/use-console-capture';
import { showToast } from '@/lib/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';

const bugReportSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  impact: z.string().min(1, 'Please select the impact level'),
  description: z.string().optional(),
});

type BugReportFormData = z.infer<typeof bugReportSchema>;

interface BugReportPayload {
  title: string;
  description?: string;
  priority: number;
  page_url: string;
  browser_info: string;
  console_logs: string;
}

const IMPACT_OPTIONS = [
  { value: '1', label: 'Critical', description: "I can't do my work" },
  { value: '2', label: 'High', description: 'Significant disruption' },
  { value: '3', label: 'Medium', description: 'Annoying but manageable' },
  { value: '4', label: 'Low', description: 'Minor issue' },
];

export function BugReportModal() {
  const [open, setOpen] = React.useState(false);
  const { data: settings, isLoading: settingsLoading } = useBugReportSettings();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<BugReportFormData>({
    resolver: zodResolver(bugReportSchema),
    defaultValues: {
      title: '',
      impact: '',
      description: '',
    },
  });

  const selectedImpact = watch('impact');

  const submitBugReport = useMutation({
    mutationFn: async (payload: BugReportPayload) => {
      return apiClient.post('/bug-report', payload);
    },
    onSuccess: () => {
      showToast.success('Bug report submitted');
      reset();
      setOpen(false);
    },
    onError: (error: any) => {
      showToast.apiError(error, 'Failed to submit bug report');
    },
  });

  const onSubmit = handleSubmit((data) => {
    const payload: BugReportPayload = {
      title: data.title,
      description: data.description,
      priority: parseInt(data.impact),
      page_url: window.location.href,
      browser_info: navigator.userAgent,
      console_logs: formatConsoleLogsForReport(),
    };

    submitBugReport.mutate(payload);
  });

  // Don't render anything if settings aren't configured
  if (settingsLoading) return null;
  if (!isBugReportConfigured(settings)) return null;

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-text-sub hover:text-text-main"
      >
        <Bug className="h-4 w-4" />
        <span className="hidden sm:inline">Report Bug</span>
      </Button>

      <ModalContent size="lg">
        <ModalHeader>
          <ModalTitle>Report a Bug</ModalTitle>
        </ModalHeader>

        <ModalBody>
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Title */}
            <div>
              <Input
                label="What's happening? *"
                {...register('title')}
                error={errors.title?.message}
                placeholder="Brief description of the issue"
                autoFocus
              />
            </div>

            {/* Impact */}
            <div>
              <label className="block text-sm font-medium text-text-main mb-2">
                Impact on your work *
              </label>
              <div className="grid grid-cols-2 gap-2">
                {IMPACT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setValue('impact', option.value)}
                    className={`p-3 text-left rounded-lg border transition-colors ${
                      selectedImpact === option.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border-warm hover:border-border-warm/80 bg-surface'
                    }`}
                  >
                    <div className="font-medium text-text-main">{option.label}</div>
                    <div className="text-sm text-text-sub">{option.description}</div>
                  </button>
                ))}
              </div>
              {errors.impact?.message && (
                <p className="text-sm text-red-500 mt-2">{errors.impact.message}</p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                Additional details
              </label>
              <textarea
                {...register('description')}
                className="w-full h-24 px-3 py-2 rounded-lg border border-border-warm bg-surface text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary resize-none"
                placeholder="Steps to reproduce, what you expected to happen, etc."
              />
            </div>

            {/* Info about auto-captured data */}
            <div className="text-xs text-text-sub bg-surface-alt rounded-lg p-3">
              <p>
                The following will be automatically included to help us diagnose the issue:
              </p>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                <li>Current page URL</li>
                <li>Browser information</li>
                <li>Recent console errors/warnings</li>
              </ul>
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={submitBugReport.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitBugReport.isPending}
              >
                {submitBugReport.isPending ? (
                  <>
                    <Spinner size="sm" className="mr-2" />
                    Submitting...
                  </>
                ) : (
                  'Submit Report'
                )}
              </Button>
            </div>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
