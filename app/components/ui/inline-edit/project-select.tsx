'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X, Search } from 'lucide-react';
import { useProjects, Project } from '@/lib/hooks/use-projects';

interface ProjectSelectProps {
  value: string | null;
  onChange: (value: string | null, project?: Project | null) => void;
  placeholder?: string;
  className?: string;
  allowClear?: boolean;
  disabled?: boolean;
}

export function ProjectSelect({
  value,
  onChange,
  placeholder = 'Select project...',
  className = '',
  allowClear = true,
  disabled = false,
}: ProjectSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [dropdownPosition, setDropdownPosition] = React.useState({ top: 0, left: 0 });
  const ref = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const { data, isLoading } = useProjects({ limit: 100 });

  const projects = React.useMemo(() => {
    return data?.projects || [];
  }, [data?.projects]);

  // Update dropdown position when opened or on scroll
  React.useEffect(() => {
    const updatePosition = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setDropdownPosition({
          top: rect.bottom + 4,
          left: rect.left,
        });
      }
    };

    if (isOpen) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      return () => window.removeEventListener('scroll', updatePosition, true);
    }
  }, [isOpen]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  React.useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus();
    }
  }, [isOpen]);

  const selectedProject = projects.find((p: Project) => p.id === value);
  const displayLabel = selectedProject?.name || placeholder;

  const filteredProjects = projects.filter((p: Project) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.client?.name?.toLowerCase().includes(search.toLowerCase())
  );

  const dropdown = isOpen && !disabled && (
    <div
      ref={dropdownRef}
      className="fixed z-[9999] w-72 bg-surface border border-border rounded-lg shadow-lg"
      style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
    >
      {/* Search input */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-text-sub" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface-alt border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Options */}
      <div className="max-h-48 overflow-auto py-1">
        {/* Clear option */}
        {allowClear && value && (
          <button
            type="button"
            onClick={() => {
              onChange(null, null);
              setIsOpen(false);
              setSearch('');
            }}
            className="w-full text-left px-3 py-2 text-sm hover:bg-surface-alt flex items-center gap-2 text-text-sub"
          >
            <X className="h-4 w-4" />
            Clear selection
          </button>
        )}

        {isLoading ? (
          <div className="px-3 py-2 text-sm text-text-sub">Loading...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="px-3 py-2 text-sm text-text-sub">No projects found</div>
        ) : (
          filteredProjects.map((project: Project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                onChange(project.id, project);
                setIsOpen(false);
                setSearch('');
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-alt ${
                project.id === value ? 'bg-primary/10 text-primary' : 'text-text-main'
              }`}
            >
              <div>{project.name}</div>
              {project.client && (
                <div className="text-xs text-text-sub">{project.client.name}</div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded transition-colors ${
          disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:bg-surface-alt'
        }`}
      >
        <span className={value ? 'text-text-main' : 'text-text-sub italic'}>
          {displayLabel}
        </span>
        {!disabled && <ChevronDown className="h-3 w-3 text-text-sub" />}
      </button>

      {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
    </div>
  );
}
