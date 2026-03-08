/**
 * Strip ANSI escape sequences from terminal output for readable text.
 *
 * Handles:
 * - CSI sequences: ESC[ ... letter
 * - OSC sequences: ESC] ... BEL/ST
 * - Simple escapes: ESC followed by single char (e.g. ESC(B)
 * - Mode switches: ESC= / ESC>
 * - Carriage returns
 */
export function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r/g, '');
}
