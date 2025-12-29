'use client';

import * as React from 'react';
import { ChevronDown, Plus, X, FolderPlus } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Button } from './button';
import { Input } from './input';
import { InlineIconPicker } from './icon-picker';
import { DEFAULT_SECTION_ICON } from '@/lib/config/icons';

// ============================================
// TYPES
// ============================================

export interface RequirementItem {
  id: string;
  type?: 'item';
  text: string;
  sort_order: number;
  // Task completion tracking (when used on tasks)
  completed?: boolean;
  completed_at?: string;
  completed_by?: string;
}

export interface RequirementSection {
  id: string;
  type: 'section';
  title: string;
  icon: string;
  sort_order: number;
  items: RequirementItem[];
}

export type RequirementEntry = RequirementItem | RequirementSection;

// Helper to check if entry is a section
export function isSection(entry: RequirementEntry): entry is RequirementSection {
  return entry.type === 'section';
}

// Helper to normalize legacy items (without type field)
export function normalizeRequirements(entries: unknown[]): RequirementEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry: any, index) => {
    if (entry.type === 'section') {
      return {
        ...entry,
        items: (entry.items || []).map((item: any, i: number) => ({
          ...item,
          type: 'item' as const,
          sort_order: item.sort_order ?? i,
        })),
      } as RequirementSection;
    }
    // Legacy or explicit item
    return {
      ...entry,
      type: 'item' as const,
      sort_order: entry.sort_order ?? index,
    } as RequirementItem;
  });
}

// ============================================
// SECTION EDITOR COMPONENT
// ============================================

interface SectionEditorProps {
  section: RequirementSection;
  onUpdate: (section: RequirementSection) => void;
  onDelete: () => void;
  defaultOpen?: boolean;
}

function SectionEditor({ section, onUpdate, onDelete, defaultOpen = true }: SectionEditorProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(section.title);
  const [newItemText, setNewItemText] = React.useState('');
  const [isAddingItem, setIsAddingItem] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const newItemInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  React.useEffect(() => {
    if (isAddingItem && newItemInputRef.current) {
      newItemInputRef.current.focus();
    }
  }, [isAddingItem]);

  const handleTitleSave = () => {
    if (titleDraft.trim()) {
      onUpdate({ ...section, title: titleDraft.trim() });
    } else {
      setTitleDraft(section.title);
    }
    setIsEditingTitle(false);
  };

  const handleIconChange = (icon: string) => {
    onUpdate({ ...section, icon });
  };

  const handleAddItem = () => {
    if (!newItemText.trim()) return;
    const newItem: RequirementItem = {
      id: crypto.randomUUID(),
      type: 'item',
      text: newItemText.trim(),
      sort_order: section.items.length,
    };
    onUpdate({ ...section, items: [...section.items, newItem] });
    setNewItemText('');
  };

  const handleUpdateItem = (itemId: string, text: string) => {
    const updatedItems = section.items.map((item) =>
      item.id === itemId ? { ...item, text } : item
    );
    onUpdate({ ...section, items: updatedItems });
  };

  const handleRemoveItem = (itemId: string) => {
    const updatedItems = section.items.filter((item) => item.id !== itemId);
    onUpdate({ ...section, items: updatedItems });
  };

  return (
    <div className="border border-border rounded-lg">
      {/* Section Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 bg-surface-alt',
          'hover:bg-surface-alt/80 transition-colors rounded-t-lg'
        )}
      >
        {/* Collapse Toggle */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex-shrink-0"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 text-text-sub transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>

        {/* Icon Picker */}
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <InlineIconPicker
            value={section.icon}
            onChange={handleIconChange}
          />
        </div>

        {/* Title */}
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSave();
              if (e.key === 'Escape') {
                setTitleDraft(section.title);
                setIsEditingTitle(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-transparent border-b-2 border-primary text-sm font-medium text-text-main focus:outline-none min-w-0"
          />
        ) : (
          <span
            onClick={() => setIsEditingTitle(true)}
            className="flex-1 text-sm font-medium text-text-main truncate cursor-text hover:text-primary min-w-0"
          >
            {section.title || 'Untitled Section'}
          </span>
        )}

        {/* Item Count */}
        <span className="text-xs text-text-sub flex-shrink-0">
          {section.items.length} item{section.items.length !== 1 ? 's' : ''}
        </span>

        {/* Delete Button */}
        <button
          type="button"
          onClick={onDelete}
          className="p-1 text-text-sub hover:text-red-500 transition-colors flex-shrink-0"
          title="Delete section"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Section Content */}
      {isOpen && (
        <div className="p-3 space-y-2">
          {section.items.length === 0 && !isAddingItem && (
            <p className="text-sm text-text-sub italic">No items in this section</p>
          )}
          {section.items
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 rounded-lg border border-border group"
              >
                <span className="text-sm text-text-sub w-5">{index + 1}.</span>
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) => handleUpdateItem(item.id, e.target.value)}
                  className="flex-1 bg-transparent text-sm text-text-main focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-text-sub hover:text-red-500 transition-opacity"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}

          {isAddingItem ? (
            <div className="flex items-center gap-2">
              <Input
                ref={newItemInputRef}
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddItem();
                  }
                  if (e.key === 'Escape') {
                    setIsAddingItem(false);
                    setNewItemText('');
                  }
                }}
                placeholder="Add item..."
                className="flex-1"
              />
              <Button type="button" size="sm" onClick={handleAddItem} disabled={!newItemText.trim()}>
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAddingItem(false);
                  setNewItemText('');
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsAddingItem(true)}
              className="w-full justify-start text-text-sub"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add item
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN EDITOR COMPONENT
// ============================================

interface SectionedRequirementsEditorProps {
  requirements: RequirementEntry[];
  onChange: (requirements: RequirementEntry[]) => void;
  emptyMessage?: string;
}

export function SectionedRequirementsEditor({
  requirements,
  onChange,
  emptyMessage = 'No requirements',
}: SectionedRequirementsEditorProps) {
  const [localEntries, setLocalEntries] = React.useState<RequirementEntry[]>(() =>
    normalizeRequirements(requirements)
  );
  const [newItemText, setNewItemText] = React.useState('');
  const [isAddingItem, setIsAddingItem] = React.useState(false);
  const [isAddingSection, setIsAddingSection] = React.useState(false);
  const [newSectionTitle, setNewSectionTitle] = React.useState('');
  const newItemInputRef = React.useRef<HTMLInputElement>(null);
  const newSectionInputRef = React.useRef<HTMLInputElement>(null);

  // Sync local state when props change
  React.useEffect(() => {
    setLocalEntries(normalizeRequirements(requirements));
  }, [requirements]);

  React.useEffect(() => {
    if (isAddingItem && newItemInputRef.current) {
      newItemInputRef.current.focus();
    }
  }, [isAddingItem]);

  React.useEffect(() => {
    if (isAddingSection && newSectionInputRef.current) {
      newSectionInputRef.current.focus();
    }
  }, [isAddingSection]);

  const handleUpdate = (entries: RequirementEntry[]) => {
    setLocalEntries(entries);
    onChange(entries);
  };

  // Separate items and sections
  const topLevelItems = localEntries.filter((e): e is RequirementItem => !isSection(e));
  const sections = localEntries.filter((e): e is RequirementSection => isSection(e));

  const handleAddItem = () => {
    if (!newItemText.trim()) return;
    const newItem: RequirementItem = {
      id: crypto.randomUUID(),
      type: 'item',
      text: newItemText.trim(),
      sort_order: localEntries.length,
    };
    handleUpdate([...localEntries, newItem]);
    setNewItemText('');
  };

  const handleAddSection = () => {
    if (!newSectionTitle.trim()) return;
    const newSection: RequirementSection = {
      id: crypto.randomUUID(),
      type: 'section',
      title: newSectionTitle.trim(),
      icon: DEFAULT_SECTION_ICON,
      sort_order: localEntries.length,
      items: [],
    };
    handleUpdate([...localEntries, newSection]);
    setNewSectionTitle('');
    setIsAddingSection(false);
  };

  const handleUpdateItem = (itemId: string, text: string) => {
    const updated = localEntries.map((entry) =>
      !isSection(entry) && entry.id === itemId ? { ...entry, text } : entry
    );
    handleUpdate(updated);
  };

  const handleRemoveItem = (itemId: string) => {
    const updated = localEntries.filter((entry) => entry.id !== itemId);
    handleUpdate(updated);
  };

  const handleUpdateSection = (sectionId: string, section: RequirementSection) => {
    const updated = localEntries.map((entry) =>
      isSection(entry) && entry.id === sectionId ? section : entry
    );
    handleUpdate(updated);
  };

  const handleRemoveSection = (sectionId: string) => {
    const updated = localEntries.filter((entry) => entry.id !== sectionId);
    handleUpdate(updated);
  };

  const isEmpty = topLevelItems.length === 0 && sections.length === 0;

  return (
    <div className="space-y-3">
      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setIsAddingItem(true)}
          disabled={isAddingItem}
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Item
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setIsAddingSection(true)}
          disabled={isAddingSection}
        >
          <FolderPlus className="h-4 w-4 mr-1" />
          Add Section
        </Button>
      </div>

      {/* Add Item Input */}
      {isAddingItem && (
        <div className="flex items-center gap-2">
          <Input
            ref={newItemInputRef}
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddItem();
              }
              if (e.key === 'Escape') {
                setIsAddingItem(false);
                setNewItemText('');
              }
            }}
            placeholder="Add a requirement..."
            className="flex-1"
          />
          <Button type="button" size="sm" onClick={handleAddItem} disabled={!newItemText.trim()}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsAddingItem(false);
              setNewItemText('');
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Add Section Input */}
      {isAddingSection && (
        <div className="flex items-center gap-2">
          <Input
            ref={newSectionInputRef}
            value={newSectionTitle}
            onChange={(e) => setNewSectionTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddSection();
              }
              if (e.key === 'Escape') {
                setIsAddingSection(false);
                setNewSectionTitle('');
              }
            }}
            placeholder="Section title..."
            className="flex-1"
          />
          <Button type="button" size="sm" onClick={handleAddSection} disabled={!newSectionTitle.trim()}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsAddingSection(false);
              setNewSectionTitle('');
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Empty State */}
      {isEmpty && !isAddingItem && !isAddingSection && (
        <p className="text-sm text-text-sub italic py-2">{emptyMessage}</p>
      )}

      {/* Top-level Items */}
      {topLevelItems.length > 0 && (
        <div className="space-y-2">
          {topLevelItems
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 rounded-lg border border-border group"
              >
                <span className="text-sm text-text-sub w-5">{index + 1}.</span>
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) => handleUpdateItem(item.id, e.target.value)}
                  className="flex-1 bg-transparent text-sm text-text-main focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveItem(item.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-text-sub hover:text-red-500 transition-opacity"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Sections */}
      {sections.length > 0 && (
        <div className="space-y-3">
          {sections
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((section) => (
              <SectionEditor
                key={section.id}
                section={section}
                onUpdate={(updated) => handleUpdateSection(section.id, updated)}
                onDelete={() => handleRemoveSection(section.id)}
              />
            ))}
        </div>
      )}
    </div>
  );
}
