/**
 * Shared port constants — single source of truth for the hub system.
 *
 * These values are also defined in shared/constants.json for CJS consumers
 * (bin/lib/hub.js). If you change a value here, update the JSON file too.
 *
 * A test in cli-hub.test.ts verifies that both files stay in sync.
 */

/** Offset added to server port to get the client (Vite dev server) port. */
export const CLIENT_PORT_OFFSET = 1000;

/** First server port assigned to repos by the registry. */
export const BASE_PORT = 4001;

/** Default hub manager port. Overridden via HUB_PORT env var. */
export const DEFAULT_HUB_PORT = 3000;

/** Maximum valid TCP port number. */
export const MAX_PORT = 65535;
