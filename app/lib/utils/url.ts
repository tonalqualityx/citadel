/**
 * URL utility functions with safe parsing
 */

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely extract the hostname from a URL
 * Returns null if the URL is invalid
 */
export function getHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Safely extract the origin from a URL (protocol + hostname + port)
 * Returns null if the URL is invalid
 */
export function getOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
