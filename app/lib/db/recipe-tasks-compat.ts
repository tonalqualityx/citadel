/**
 * Recipe tasks database compatibility utilities
 * 
 * PostgreSQL: depends_on_ids are stored as String[] (native array)
 * SQLite: depends_on_ids are stored as JSON string "[...]"
 */

import type { Prisma } from '@prisma/client';

// Detect if we're using SQLite based on DATABASE_URL
export const isSQLite = (): boolean => {
  const dbUrl = process.env.DATABASE_URL || '';
  return dbUrl.startsWith('file:') || dbUrl.includes('.db');
};

/**
 * Serialize depends_on_ids for database storage
 * - PostgreSQL: returns the array as-is
 * - SQLite: returns JSON string
 */
export const serializeDependsOnIds = (ids: string[] | undefined): string[] | string => {
  if (isSQLite()) {
    return JSON.stringify(ids ?? []);
  }
  return ids ?? [];
};

/**
 * Deserialize depends_on_ids from database
 * - PostgreSQL: returns the array as-is
 * - SQLite: parses JSON string
 */
export const deserializeDependsOnIds = (ids: string[] | string | null | undefined): string[] => {
  if (ids === null || ids === undefined) {
    return [];
  }
  
  // If it's already an array (PostgreSQL), return as-is
  if (Array.isArray(ids)) {
    return ids;
  }
  
  // If it's a string (SQLite), parse as JSON
  if (typeof ids === 'string') {
    try {
      const parsed = JSON.parse(ids);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // If parsing fails, treat as empty array
      return [];
    }
  }
  
  return [];
};
