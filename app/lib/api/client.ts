type RequestConfig = {
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
};

// Token expiry in milliseconds (should match JWT_ACCESS_EXPIRY)
const ACCESS_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
// Refresh token 5 minutes before it expires
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

class ApiClient {
  private baseUrl = '/api';
  private refreshPromise: Promise<boolean> | null = null;
  private tokenExpiresAt: number | null = null;

  constructor() {
    // Initialize token expiry from sessionStorage if available
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('tokenExpiresAt');
      if (stored) {
        this.tokenExpiresAt = parseInt(stored, 10);
      }
    }
  }

  private setTokenExpiry() {
    this.tokenExpiresAt = Date.now() + ACCESS_TOKEN_EXPIRY_MS;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('tokenExpiresAt', String(this.tokenExpiresAt));
    }
  }

  private clearTokenExpiry() {
    this.tokenExpiresAt = null;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('tokenExpiresAt');
    }
  }

  private shouldRefreshProactively(): boolean {
    if (!this.tokenExpiresAt) return false;
    // Refresh if we're within the buffer period before expiry
    return Date.now() > this.tokenExpiresAt - REFRESH_BUFFER_MS;
  }

  private async refreshToken(): Promise<boolean> {
    // If a refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start a new refresh
    this.refreshPromise = (async () => {
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });

        if (response.ok) {
          this.setTokenExpiry();
          return true;
        }
        this.clearTokenExpiry();
        return false;
      } catch {
        this.clearTokenExpiry();
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    data?: unknown,
    config?: RequestConfig,
    isRetry = false
  ): Promise<T> {
    // Proactive refresh: if token is about to expire, refresh before making the request
    if (this.shouldRefreshProactively() && !isRetry) {
      await this.refreshToken();
    }

    const url = new URL(`${this.baseUrl}${endpoint}`, window.location.origin);

    if (config?.params) {
      Object.entries(config.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...config?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });

    if (response.status === 401 && !isRetry) {
      // Try to refresh token - all concurrent 401s will wait for the same refresh
      const refreshed = await this.refreshToken();

      if (refreshed) {
        // Retry original request (mark as retry to prevent loop)
        return this.request<T>(method, endpoint, data, config, true);
      } else {
        // Refresh failed, redirect to login
        window.location.href = '/login';
        throw new Error('Session expired');
      }
    }

    if (response.status === 401) {
      // If still 401 after retry, redirect to login
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Call this after successful login to track token expiry
  markLoggedIn() {
    this.setTokenExpiry();
  }

  // Call this after logout to clear token expiry
  markLoggedOut() {
    this.clearTokenExpiry();
  }

  get<T>(endpoint: string, config?: RequestConfig): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, config);
  }

  post<T>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('POST', endpoint, data, config);
  }

  patch<T>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('PATCH', endpoint, data, config);
  }

  put<T>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('PUT', endpoint, data, config);
  }

  delete<T>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('DELETE', endpoint, data, config);
  }
}

export const apiClient = new ApiClient();
