'use client';

import { useEffect } from 'react';

interface ConsoleLogEntry {
  type: 'error' | 'warn';
  timestamp: Date;
  message: string;
  stack?: string;
}

// Global storage for console logs - persists across component renders
const consoleLogs: ConsoleLogEntry[] = [];
const MAX_LOGS = 20;

// Track if we've already overridden console methods
let isInitialized = false;
let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;

function formatArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

function addLogEntry(type: 'error' | 'warn', args: any[]) {
  const entry: ConsoleLogEntry = {
    type,
    timestamp: new Date(),
    message: formatArgs(args),
  };

  // Check if first arg is an Error for stack trace
  if (args[0] instanceof Error) {
    entry.stack = args[0].stack;
  }

  consoleLogs.push(entry);

  // Keep only the last MAX_LOGS entries
  while (consoleLogs.length > MAX_LOGS) {
    consoleLogs.shift();
  }
}

function initializeCapture() {
  if (isInitialized || typeof window === 'undefined') return;

  originalConsoleError = console.error;
  originalConsoleWarn = console.warn;

  console.error = (...args: any[]) => {
    addLogEntry('error', args);
    originalConsoleError?.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    addLogEntry('warn', args);
    originalConsoleWarn?.apply(console, args);
  };

  // Also capture unhandled errors
  window.addEventListener('error', (event) => {
    addLogEntry('error', [`Unhandled error: ${event.message} at ${event.filename}:${event.lineno}`]);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    addLogEntry('error', [`Unhandled promise rejection: ${event.reason}`]);
  });

  isInitialized = true;
}

/**
 * Hook to initialize console capture.
 * Call this once at the app root level to start capturing console errors/warnings.
 */
export function useConsoleCapture() {
  useEffect(() => {
    initializeCapture();
  }, []);
}

/**
 * Get all captured console logs.
 * Returns a copy of the logs array.
 */
export function getConsoleLogs(): ConsoleLogEntry[] {
  return [...consoleLogs];
}

/**
 * Clear all captured console logs.
 */
export function clearConsoleLogs() {
  consoleLogs.length = 0;
}

/**
 * Format console logs for display in bug report description.
 */
export function formatConsoleLogsForReport(): string {
  if (consoleLogs.length === 0) {
    return 'No console errors or warnings captured.';
  }

  return consoleLogs
    .map((log) => {
      const time = log.timestamp.toLocaleTimeString();
      const prefix = log.type === 'error' ? '[ERROR]' : '[WARN]';
      let line = `${prefix} ${time} - ${log.message}`;
      if (log.stack) {
        // Include first few lines of stack trace
        const stackLines = log.stack.split('\n').slice(0, 3).join('\n');
        line += `\n${stackLines}`;
      }
      return line;
    })
    .join('\n\n');
}
