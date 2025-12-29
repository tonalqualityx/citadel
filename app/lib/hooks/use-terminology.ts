import { usePreferences } from './use-preferences';

const TERMS = {
  // Entities
  client: { awesome: 'Patron', standard: 'Client' },
  clients: { awesome: 'Patrons', standard: 'Clients' },
  project: { awesome: 'Pact', standard: 'Project' },
  projects: { awesome: 'Pacts', standard: 'Projects' },
  task: { awesome: 'Quest', standard: 'Task' },
  tasks: { awesome: 'Quests', standard: 'Tasks' },
  sop: { awesome: 'Rune', standard: 'SOP' },
  sops: { awesome: 'Runes', standard: 'SOPs' },
  recipe: { awesome: 'Ritual', standard: 'Template' },
  recipes: { awesome: 'Rituals', standard: 'Templates' },

  // Navigation sections
  dashboard: { awesome: 'Overlook', standard: 'Dashboard' },
  foundry: { awesome: 'Foundry', standard: 'Clients' },
  sanctum: { awesome: 'Sanctum', standard: 'Work' },
  chronicles: { awesome: 'Chronicles', standard: 'Time' },
  grimoire: { awesome: 'Grimoire', standard: 'Knowledge' },
  guild: { awesome: 'Guild', standard: 'Settings' },
  armory: { awesome: 'Armory', standard: 'Resources' },

  // Actions
  newClient: { awesome: 'New Patron', standard: 'New Client' },
  newProject: { awesome: 'New Pact', standard: 'New Project' },
  newTask: { awesome: 'New Quest', standard: 'New Task' },
  newSop: { awesome: 'New Rune', standard: 'New SOP' },
  newRecipe: { awesome: 'New Ritual', standard: 'New Template' },

  // Misc
  site: { awesome: 'Site', standard: 'Site' },
  sites: { awesome: 'Sites', standard: 'Sites' },
  domain: { awesome: 'Domain', standard: 'Domain' },
  domains: { awesome: 'Domains', standard: 'Domains' },
  tool: { awesome: 'Tool', standard: 'Tool' },
  tools: { awesome: 'Tools', standard: 'Tools' },
} as const;

type TermKey = keyof typeof TERMS;

export function useTerminology() {
  const { data } = usePreferences();
  const convention = data?.preferences?.naming_convention || 'awesome';

  function t(key: TermKey): string {
    return TERMS[key][convention];
  }

  function isAwesome(): boolean {
    return convention === 'awesome';
  }

  return { t, convention, isAwesome };
}

// Static function for server components or when hook can't be used
export function getTerminology(convention: 'awesome' | 'standard' = 'awesome') {
  function t(key: TermKey): string {
    return TERMS[key][convention];
  }

  return { t, convention };
}

export type { TermKey };
