/**
 * Database Backup Service
 *
 * Handles database export and import using pg_dump and psql.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execAsync = promisify(exec);

// Table group definitions
export const TABLE_GROUPS = {
  users: {
    name: 'Users & Auth',
    description: 'User accounts, preferences, sessions, API keys, function assignments',
    tables: ['users', 'user_preferences', 'sessions', 'password_reset_tokens', 'api_keys', 'user_functions'],
  },
  reference: {
    name: 'Reference Data',
    description: 'Functions, hosting plans, tools, integrations, DNS providers',
    tables: ['functions', 'hosting_plans', 'maintenance_plans', 'maintenance_plan_sops', 'tools', 'integrations', 'dns_providers'],
  },
  clients: {
    name: 'Clients & Sites',
    description: 'Client records and site configurations',
    tables: ['clients', 'sites', 'domains'],
  },
  projects: {
    name: 'Projects',
    description: 'Projects, phases, team assignments, milestones, resource links',
    tables: ['projects', 'project_phases', 'project_team_assignments', 'milestones', 'project_pages', 'resource_links'],
  },
  tasks: {
    name: 'Tasks',
    description: 'Tasks, comments, time entries, dependencies',
    tables: ['tasks', 'comments', 'time_entries', '_TaskDependencies'],
  },
  sops: {
    name: 'SOPs & Recipes',
    description: 'Standard procedures and project templates',
    tables: ['sops', 'recipes', 'recipe_phases', 'recipe_tasks'],
  },
  activity: {
    name: 'Activity',
    description: 'Activity logs, notifications, notification preferences, Slack mappings, maintenance logs',
    tables: ['activity_logs', 'notifications', 'notification_preferences', 'slack_user_mappings', 'slack_message_threads', 'email_digest_queue', 'slack_notification_batch', 'maintenance_generation_logs'],
  },
  settings: {
    name: 'App Settings',
    description: 'Application configuration',
    tables: ['app_settings'],
  },
} as const;

export type TableGroup = keyof typeof TABLE_GROUPS;

// Dependency order for all tables (parent tables first)
const TABLE_ORDER = [
  // Users (no deps)
  'users',
  'user_preferences',
  'api_keys',
  // Reference data (no deps except functions for sops)
  'functions',
  'user_functions',
  'hosting_plans',
  'maintenance_plans',
  'tools',
  'integrations',
  'dns_providers',
  // Clients (self-ref)
  'clients',
  // Sites (→ clients, hosting_plans, maintenance_plans)
  'sites',
  'domains',
  // SOPs (→ functions)
  'sops',
  // Maintenance plan SOPs (→ maintenance_plans, sops)
  'maintenance_plan_sops',
  // Recipes (no deps)
  'recipes',
  'recipe_phases',
  'recipe_tasks',
  // Projects (→ clients, sites, recipes, users)
  'projects',
  'project_phases',
  'project_team_assignments',
  'milestones',
  'project_pages',
  'resource_links',
  // Tasks (→ projects, clients, project_phases, users, functions, sops)
  'tasks',
  '_TaskDependencies',
  'time_entries',
  'comments',
  // Auth/activity (→ users)
  'sessions',
  'password_reset_tokens',
  'activity_logs',
  'notifications',
  'notification_preferences',
  'slack_user_mappings',
  'slack_message_threads',
  'email_digest_queue',
  'slack_notification_batch',
  // Maintenance generation logs (→ maintenance_plans, sites)
  'maintenance_generation_logs',
  // Settings
  'app_settings',
];

/**
 * Parse DATABASE_URL into connection components
 */
function parseDatabaseUrl(): {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
} {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  // Parse: postgresql://user:password@host:port/database
  const match = url.match(
    /^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/
  );

  if (!match) {
    throw new Error('Invalid DATABASE_URL format');
  }

  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4],
    database: match[5].split('?')[0], // Remove query params
  };
}

/**
 * Get tables in proper dependency order for given groups
 */
export function getTablesInOrder(groups: TableGroup[]): string[] {
  const selectedTables = new Set<string>();

  for (const group of groups) {
    const groupDef = TABLE_GROUPS[group];
    if (groupDef) {
      for (const table of groupDef.tables) {
        selectedTables.add(table);
      }
    }
  }

  // Return tables in dependency order, filtered to selected ones
  return TABLE_ORDER.filter((table) => selectedTables.has(table));
}

/**
 * Export selected tables to SQL dump
 */
export async function exportTables(groups: TableGroup[]): Promise<string> {
  const tables = getTablesInOrder(groups);

  if (tables.length === 0) {
    throw new Error('No tables selected for export');
  }

  const db = parseDatabaseUrl();

  // Build pg_dump command with table selection
  const tableArgs = tables.map((t) => `-t ${t}`).join(' ');

  const command = `PGPASSWORD=${db.password} pg_dump -h ${db.host} -p ${db.port} -U ${db.user} -d ${db.database} ${tableArgs} --data-only --disable-triggers`;

  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer
    });

    if (stderr && !stderr.includes('NOTICE')) {
      console.warn('pg_dump warnings:', stderr);
    }

    // Add header comment
    const header = `-- Indelible Database Export
-- Generated: ${new Date().toISOString()}
-- Tables: ${tables.join(', ')}
-- Groups: ${groups.join(', ')}

`;

    return header + stdout;
  } catch (error) {
    console.error('pg_dump error:', error);
    throw new Error(`Failed to export database: ${(error as Error).message}`);
  }
}

/**
 * Truncate tables in reverse dependency order
 */
export async function truncateTables(groups: TableGroup[]): Promise<void> {
  const tables = getTablesInOrder(groups);

  if (tables.length === 0) {
    return;
  }

  const db = parseDatabaseUrl();

  // Reverse order for truncation (children first)
  const reversedTables = [...tables].reverse();

  // Build TRUNCATE command with CASCADE
  const truncateCommand = `TRUNCATE TABLE ${reversedTables.join(', ')} CASCADE`;

  const command = `PGPASSWORD=${db.password} psql -h ${db.host} -p ${db.port} -U ${db.user} -d ${db.database} -c "${truncateCommand}"`;

  try {
    await execAsync(command);
  } catch (error) {
    console.error('Truncate error:', error);
    throw new Error(`Failed to truncate tables: ${(error as Error).message}`);
  }
}

/**
 * Import SQL dump into database
 */
export async function importSql(sql: string): Promise<void> {
  const db = parseDatabaseUrl();

  // Write SQL to temp file
  const tempFile = join(tmpdir(), `indelible-import-${Date.now()}.sql`);

  try {
    await writeFile(tempFile, sql, 'utf8');

    const command = `PGPASSWORD=${db.password} psql -h ${db.host} -p ${db.port} -U ${db.user} -d ${db.database} -f "${tempFile}"`;

    const { stderr } = await execAsync(command, {
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer
    });

    if (stderr && !stderr.includes('NOTICE') && !stderr.includes('already exists')) {
      console.warn('psql warnings:', stderr);
    }
  } catch (error) {
    console.error('Import error:', error);
    throw new Error(`Failed to import database: ${(error as Error).message}`);
  } finally {
    // Clean up temp file
    try {
      await unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get all available table groups for UI
 */
export function getTableGroups() {
  return Object.entries(TABLE_GROUPS).map(([key, value]) => ({
    id: key,
    name: value.name,
    description: value.description,
    tableCount: value.tables.length,
  }));
}
