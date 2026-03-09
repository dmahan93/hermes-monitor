/**
 * Shared port constants — single source of truth: shared/constants.json
 *
 * Both CJS consumers (bin/lib/hub.js) and ESM consumers (server code) read
 * from the same JSON file. This eliminates the risk of values drifting apart.
 * A test in cli-hub.test.ts verifies both modules expose the same values.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const shared = require('../../shared/constants.json');

/** Offset added to server port to get the client (Vite dev server) port. */
export const CLIENT_PORT_OFFSET: number = shared.CLIENT_PORT_OFFSET;

/** First server port assigned to repos by the registry. */
export const BASE_PORT: number = shared.BASE_PORT;

/** Default hub manager port. Overridden via HUB_PORT env var. */
export const DEFAULT_HUB_PORT: number = shared.DEFAULT_HUB_PORT;

/** Maximum valid TCP port number. */
export const MAX_PORT: number = shared.MAX_PORT;
