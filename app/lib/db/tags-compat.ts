/**
 * Database-aware tag serialization/deserialization utilities
 * 
 * PostgreSQL: tags are stored as String[] (native array)
 * SQLite: tags are stored as JSON string "[...]"
 */

import type { Prisma } from '@prisma/client';

// Detect if we're using SQLite based on DATABASE_URL
export const isSQLite = (): boolean => {
  const dbUrl = process.env.DATABASE_URL || '';
  return dbUrl.startsWith('file:') || dbUrl.includes('.db');
};

/**
 * Serialize tags for database storage
 * - PostgreSQL: returns the array as-is
 * - SQLite: returns JSON string
 */
export const serializeTags = (tags: string[] | undefined): string[] | string => {
  if (isSQLite()) {
    return JSON.stringify(tags ?? []);
  }
  return tags ?? [];
};

/**
 * Deserialize tags from database
 * - PostgreSQL: returns the array as-is
 * - SQLite: parses JSON string
 */
export const deserializeTags = (tags: string[] | string | null | undefined): string[] => {
  if (tags === null || tags === undefined) {
    return [];
  }
  
  // If it's already an array (PostgreSQL), return as-is
  if (Array.isArray(tags)) {
    return tags;
  }
  
  // If it's a string (SQLite), parse as JSON
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // If parsing fails, treat as empty array
      return [];
    }
  }
  
  return [];
};

/**
 * Build tag filter for Prisma where clause
 * - PostgreSQL: uses { has: tag } for array containment
 * - SQLite: uses { contains: tag } for JSON string search
 */
export const buildTagFilter = (tag: string): Prisma.StringNullableListFilter | Prisma.StringFilter => {
  if (isSQLite()) {
    // For SQLite, search for the tag as a JSON string substring
    // e.g., tag "foo" would be stored as "["foo","bar"]", so we search for ""foo""
    return { contains: `"${tag}"` } as Prisma.StringFilter;
  }
  // For PostgreSQL, use native array containment
  return { has: tag } as Prisma.StringNullableListFilter;
};
