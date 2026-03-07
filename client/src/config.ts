/**
 * Centralized API configuration.
 *
 * All client-side code should import API_BASE from here instead of
 * hard-coding the '/api' path. This makes it trivial to change the
 * API base path later (e.g., if the server moves to a subpath).
 *
 * NOTE: If you change this value, also update the proxy in vite.config.ts.
 */
export const API_BASE = '/api';
