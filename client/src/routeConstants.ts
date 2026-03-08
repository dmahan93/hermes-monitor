/**
 * Shared routing constants used by both AppContext (URL parsing) and
 * ViewSwitcher (navigation). Kept in a dedicated file to avoid circular
 * imports between context and component layers.
 */

export type ViewMode = 'kanban' | 'terminals' | 'prs' | 'config' | 'manager';

export const VALID_VIEWS: readonly ViewMode[] = ['kanban', 'terminals', 'prs', 'config', 'manager'];

/** Default view when no segment is present or an unknown segment is used */
export const DEFAULT_VIEW: ViewMode = 'kanban';
