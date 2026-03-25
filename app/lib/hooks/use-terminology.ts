import { useState, useEffect } from 'react';
import { usePreferences } from './use-preferences';

const TERMS = {
  // Entities
  client: { awesome: 'Patron', standard: 'Client' },
  clients: { awesome: 'Patrons', standard: 'Clients' },
  project: { awesome: 'Commission', standard: 'Project' },
  projects: { awesome: 'Commissions', standard: 'Projects' },
  task: { awesome: 'Quest', standard: 'Task' },
  tasks: { awesome: 'Quests', standard: 'Tasks' },
  sop: { awesome: 'Rune', standard: 'SOP' },
  sops: { awesome: 'Runes', standard: 'SOPs' },
  recipe: { awesome: 'Ritual', standard: 'Template' },
  recipes: { awesome: 'Rituals', standard: 'Templates' },
  deal: { awesome: 'Accord', standard: 'Deal' },
  deals: { awesome: 'Accords', standard: 'Deals' },
  retainer: { awesome: 'Charter', standard: 'Retainer' },
  retainers: { awesome: 'Charters', standard: 'Retainers' },
  product: { awesome: 'Ware', standard: 'Product' },
  products: { awesome: 'Wares', standard: 'Products' },
  meeting: { awesome: 'Meeting', standard: 'Meeting' },
  meetings: { awesome: 'Meetings', standard: 'Meetings' },
  keep: { awesome: 'Keep', standard: 'Site Service' },
  keeps: { awesome: 'Keeps', standard: 'Site Services' },
  commission: { awesome: 'Commission', standard: 'Project' },
  commissions: { awesome: 'Commissions', standard: 'Projects' },

  // Navigation sections
  dashboard: { awesome: 'Overlook', standard: 'Dashboard' },
  foundry: { awesome: 'Foundry', standard: 'Clients' },
  sanctum: { awesome: 'Sanctum', standard: 'Work' },
  chronicles: { awesome: 'Chronicles', standard: 'Time' },
  grimoire: { awesome: 'Grimoire', standard: 'Knowledge' },
  guild: { awesome: 'Guild', standard: 'Settings' },
  armory: { awesome: 'Armory', standard: 'Resources' },
  parley: { awesome: 'Parley', standard: 'Sales' },

  // Actions
  newClient: { awesome: 'New Patron', standard: 'New Client' },
  newProject: { awesome: 'New Commission', standard: 'New Project' },
  newTask: { awesome: 'New Quest', standard: 'New Task' },
  newSop: { awesome: 'New Rune', standard: 'New SOP' },
  newRecipe: { awesome: 'New Ritual', standard: 'New Template' },
  newDeal: { awesome: 'New Accord', standard: 'New Deal' },
  newRetainer: { awesome: 'New Charter', standard: 'New Retainer' },
  newProduct: { awesome: 'New Ware', standard: 'New Product' },
  newKeep: { awesome: 'New Keep', standard: 'New Site Service' },

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Use default during SSR and initial render for hydration consistency
  // Only use actual preference after component mounts
  const convention = mounted
    ? (data?.preferences?.naming_convention || 'awesome')
    : 'awesome';

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
