/** Format a timestamped breadcrumb line. */
export declare function formatBreadcrumb(detail: string, timestamp?: string): string;
/**
 * Append a breadcrumb to log lines, keeping a rolling window.
 * Notes (lines after a '---' separator) are preserved and not counted.
 * Returns the new log string.
 */
export declare function applyBreadcrumb(log: string, breadcrumb: string): string;
/**
 * Append a reflection note to log lines.
 * Notes go after the '---' separator and are never trimmed.
 * Returns the new log string.
 */
export declare function applyNote(log: string, note: string): string;
