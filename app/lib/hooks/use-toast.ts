import { toast, ExternalToast } from 'sonner';

type ToastOptions = ExternalToast;

/**
 * Toast helper functions for common patterns
 * Wraps sonner's toast() with consistent messaging
 */
export const showToast = {
  /**
   * Show a success message
   */
  success: (message: string, options?: ToastOptions) => {
    toast.success(message, options);
  },

  /**
   * Show an error message
   */
  error: (message: string, options?: ToastOptions) => {
    toast.error(message, options);
  },

  /**
   * Show a warning message
   */
  warning: (message: string, options?: ToastOptions) => {
    toast.warning(message, options);
  },

  /**
   * Show an info message
   */
  info: (message: string, options?: ToastOptions) => {
    toast.info(message, options);
  },

  /**
   * Show a loading toast, returns dismiss function
   */
  loading: (message: string, options?: ToastOptions) => {
    return toast.loading(message, options);
  },

  /**
   * Promise toast - shows loading, then success/error
   */
  promise: <T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((error: Error) => string);
    }
  ) => {
    return toast.promise(promise, messages);
  },

  /**
   * Dismiss a specific toast or all toasts
   */
  dismiss: (toastId?: string | number) => {
    toast.dismiss(toastId);
  },

  // =====================================
  // CRUD Operation Helpers
  // =====================================

  /**
   * Show success after creating an entity
   */
  created: (entityName: string, options?: ToastOptions) => {
    toast.success(`${entityName} created successfully`, options);
  },

  /**
   * Show success after updating an entity
   */
  updated: (entityName: string, options?: ToastOptions) => {
    toast.success(`${entityName} updated successfully`, options);
  },

  /**
   * Show success after deleting an entity
   */
  deleted: (entityName: string, options?: ToastOptions) => {
    toast.success(`${entityName} deleted successfully`, options);
  },

  /**
   * Show error for API failures
   */
  apiError: (error: unknown, fallbackMessage = 'An error occurred') => {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallbackMessage;
    toast.error(message);
  },
};

/**
 * Hook for toast notifications
 * Simply returns the showToast helpers
 */
export function useToast() {
  return showToast;
}
