'use client';

import * as React from 'react';
import { Download, Upload, AlertTriangle, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';

interface TableGroup {
  id: string;
  name: string;
  description: string;
  tableCount: number;
}

const DEFAULT_GROUPS = [
  { id: 'users', name: 'Users & Auth', description: 'User accounts, preferences, sessions', tableCount: 4 },
  { id: 'reference', name: 'Reference Data', description: 'Functions, hosting plans, tools, integrations', tableCount: 5 },
  { id: 'clients', name: 'Clients & Sites', description: 'Client records and site configurations', tableCount: 3 },
  { id: 'projects', name: 'Projects', description: 'Projects, phases, team assignments, milestones', tableCount: 5 },
  { id: 'tasks', name: 'Tasks', description: 'Tasks, comments, time entries', tableCount: 3 },
  { id: 'sops', name: 'SOPs & Recipes', description: 'Standard procedures and project templates', tableCount: 4 },
  { id: 'activity', name: 'Activity', description: 'Activity logs, notifications (optional)', tableCount: 2 },
];

export default function DatabasePage() {
  const [groups, setGroups] = React.useState<TableGroup[]>(DEFAULT_GROUPS);
  const [selectedGroups, setSelectedGroups] = React.useState<Set<string>>(
    new Set(['users', 'reference', 'clients', 'projects', 'tasks', 'sops'])
  );
  const [isExporting, setIsExporting] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [showImportConfirm, setShowImportConfirm] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Fetch groups on mount
  React.useEffect(() => {
    fetch('/api/admin/database/tables')
      .then((res) => res.json())
      .then((data) => {
        if (data.groups) {
          setGroups(data.groups);
        }
      })
      .catch(() => {
        // Use defaults on error
      });
  }, []);

  const toggleGroup = (groupId: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedGroups(new Set(groups.map((g) => g.id)));
  };

  const deselectAll = () => {
    setSelectedGroups(new Set());
  };

  const handleExport = async () => {
    if (selectedGroups.size === 0) {
      toast.error('Please select at least one group to export');
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch('/api/admin/database/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: Array.from(selectedGroups) }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Export failed');
      }

      // Get filename from Content-Disposition header
      const disposition = response.headers.get('Content-Disposition');
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || 'indelible-backup.sql';

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Database exported successfully');
    } catch (error) {
      toast.error((error as Error).message || 'Failed to export database');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.sql')) {
        toast.error('Please select a .sql file');
        return;
      }
      setImportFile(file);
      setShowImportConfirm(true);
    }
  };

  const handleImport = async () => {
    if (!importFile || selectedGroups.size === 0) {
      return;
    }

    setIsImporting(true);
    setShowImportConfirm(false);

    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('groups', JSON.stringify(Array.from(selectedGroups)));

      const response = await fetch('/api/admin/database/import', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Import failed');
      }

      toast.success('Database imported successfully');
      setImportFile(null);
    } catch (error) {
      toast.error((error as Error).message || 'Failed to import database');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const cancelImport = () => {
    setShowImportConfirm(false);
    setImportFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-main">Database Management</h1>
        <p className="text-text-sub">Import and export database for migrations</p>
      </div>

      {/* Table Groups Selection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Select Data to Include</CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="ghost" size="sm" onClick={deselectAll}>
                Deselect All
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {groups.map((group) => (
              <label
                key={group.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-surface-alt cursor-pointer transition-colors"
              >
                <div className="pt-0.5">
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedGroups.has(group.id)
                        ? 'bg-primary border-primary text-white'
                        : 'border-border-warm'
                    }`}
                  >
                    {selectedGroups.has(group.id) && <Check className="w-3 h-3" />}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="font-medium text-text-main">{group.name}</div>
                  <div className="text-sm text-text-sub">
                    {group.description}
                    <span className="text-text-muted ml-2">({group.tableCount} tables)</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={selectedGroups.has(group.id)}
                  onChange={() => toggleGroup(group.id)}
                  className="sr-only"
                />
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Export/Import Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Export Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Export
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-sub">
              Download a SQL backup of the selected data groups. This file can be used to restore
              data on another server.
            </p>
            <Button
              onClick={handleExport}
              disabled={isExporting || selectedGroups.size === 0}
              className="w-full"
            >
              {isExporting ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download SQL Backup
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Import Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showImportConfirm ? (
              <>
                <p className="text-sm text-text-sub">
                  Upload a SQL backup file to restore data. This will replace existing data in the
                  selected groups.
                </p>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".sql"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="sql-file-input"
                  />
                  <label htmlFor="sql-file-input">
                    <Button
                      variant="secondary"
                      className="w-full cursor-pointer"
                      asChild
                      disabled={isImporting || selectedGroups.size === 0}
                    >
                      <span>
                        <Upload className="w-4 h-4 mr-2" />
                        Choose SQL File
                      </span>
                    </Button>
                  </label>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-warning">Warning: Destructive Operation</p>
                      <p className="text-sm text-text-sub mt-1">
                        This will delete all existing data in the selected groups before importing.
                        This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="text-sm text-text-sub">
                  <strong>File:</strong> {importFile?.name}
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="destructive"
                    onClick={handleImport}
                    disabled={isImporting}
                    className="flex-1"
                  >
                    {isImporting ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        Importing...
                      </>
                    ) : (
                      'Import & Replace'
                    )}
                  </Button>
                  <Button variant="secondary" onClick={cancelImport} disabled={isImporting}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
