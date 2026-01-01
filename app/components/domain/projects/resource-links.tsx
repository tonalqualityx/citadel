'use client';

import * as React from 'react';
import {
  Link2,
  Plus,
  ExternalLink,
  Trash2,
  Pencil,
  X,
  Check,
  Figma,
  Github,
  FileText,
  Folder,
  Globe,
  Image,
  Video,
  MessageSquare,
  Trello,
  Database,
} from 'lucide-react';
import {
  useResourceLinks,
  useCreateResourceLink,
  useUpdateResourceLink,
  useDeleteResourceLink,
  type ResourceLink,
} from '@/lib/hooks/use-resource-links';
import { useAuth } from '@/lib/hooks/use-auth';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

// Icon options for resource links
const ICON_OPTIONS = [
  { value: 'link', label: 'Link', icon: Link2 },
  { value: 'figma', label: 'Figma', icon: Figma },
  { value: 'github', label: 'GitHub', icon: Github },
  { value: 'drive', label: 'Google Drive', icon: Folder },
  { value: 'docs', label: 'Document', icon: FileText },
  { value: 'website', label: 'Website', icon: Globe },
  { value: 'image', label: 'Image', icon: Image },
  { value: 'video', label: 'Video', icon: Video },
  { value: 'slack', label: 'Slack', icon: MessageSquare },
  { value: 'trello', label: 'Trello', icon: Trello },
  { value: 'database', label: 'Database', icon: Database },
];

function getIconComponent(iconName: string | null) {
  const option = ICON_OPTIONS.find((o) => o.value === iconName);
  return option?.icon || Link2;
}

interface ResourceLinksProps {
  projectId: string;
  /** Compact mode for display in task views */
  compact?: boolean;
}

export function ResourceLinks({ projectId, compact = false }: ResourceLinksProps) {
  const { isPmOrAdmin } = useAuth();
  const { data, isLoading } = useResourceLinks(projectId);
  const createLink = useCreateResourceLink(projectId);
  const updateLink = useUpdateResourceLink(projectId);
  const deleteLink = useDeleteResourceLink(projectId);

  const [isAdding, setIsAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [icon, setIcon] = React.useState('link');

  const resetForm = () => {
    setName('');
    setUrl('');
    setIcon('link');
    setIsAdding(false);
    setEditingId(null);
  };

  const handleAdd = () => {
    if (!name.trim() || !url.trim()) return;
    createLink.mutate(
      { name: name.trim(), url: url.trim(), icon },
      { onSuccess: resetForm }
    );
  };

  const handleUpdate = (id: string) => {
    if (!name.trim() || !url.trim()) return;
    updateLink.mutate(
      { id, data: { name: name.trim(), url: url.trim(), icon } },
      { onSuccess: resetForm }
    );
  };

  const handleDelete = (id: string) => {
    deleteLink.mutate(id);
  };

  const startEdit = (link: ResourceLink) => {
    setEditingId(link.id);
    setName(link.name);
    setUrl(link.url);
    setIcon(link.icon || 'link');
  };

  const resourceLinks = data?.resource_links || [];

  // Compact mode for task views - just show the links
  if (compact) {
    if (resourceLinks.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-2">
        {resourceLinks.map((link) => {
          const IconComponent = getIconComponent(link.icon);
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-main bg-surface-alt hover:bg-surface-2 rounded-md border border-border transition-colors"
            >
              <IconComponent className="h-3 w-3" />
              {link.name}
              <ExternalLink className="h-2.5 w-2.5 text-text-sub" />
            </a>
          );
        })}
      </div>
    );
  }

  // Full mode for project detail page
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Resource Links
        </CardTitle>
        {isPmOrAdmin && !isAdding && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Add form */}
            {isAdding && (
              <div className="flex items-center gap-2 p-3 bg-surface-alt rounded-lg">
                <Select
                  value={icon}
                  onChange={setIcon}
                  options={ICON_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  className="!w-[150px] shrink-0"
                />
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Link name"
                  className="flex-1 min-w-0"
                />
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-[2] min-w-0"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleAdd}
                  disabled={createLink.isPending || !name.trim() || !url.trim()}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={resetForm}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Links list */}
            {resourceLinks.length === 0 && !isAdding ? (
              <EmptyState
                icon={<Link2 className="h-8 w-8" />}
                title="No resource links"
                description="Add links to Figma, Google Drive, GitHub, or other project resources"
              />
            ) : (
              resourceLinks.map((link) => {
                const IconComponent = getIconComponent(link.icon);
                const isEditing = editingId === link.id;

                if (isEditing) {
                  return (
                    <div
                      key={link.id}
                      className="flex items-center gap-2 p-3 bg-surface-alt rounded-lg"
                    >
                      <Select
                        value={icon}
                        onChange={setIcon}
                        options={ICON_OPTIONS.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        className="!w-[150px] shrink-0"
                      />
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Link name"
                        className="flex-1 min-w-0"
                      />
                      <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://..."
                        className="flex-[2] min-w-0"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUpdate(link.id)}
                        disabled={updateLink.isPending || !name.trim() || !url.trim()}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={resetForm}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                }

                return (
                  <div
                    key={link.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-alt transition-colors group"
                  >
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 flex-1 min-w-0"
                    >
                      <IconComponent className="h-5 w-5 text-text-sub flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-text-main truncate">
                          {link.name}
                        </div>
                        <div className="text-xs text-text-sub truncate">
                          {link.url}
                        </div>
                      </div>
                      <ExternalLink className="h-4 w-4 text-text-sub flex-shrink-0" />
                    </a>
                    {isPmOrAdmin && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            startEdit(link);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            handleDelete(link.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
