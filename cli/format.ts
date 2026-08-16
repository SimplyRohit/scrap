/**
 * Terminal formatting.
 *
 * Colour is disabled when stdout is not a TTY or when NO_COLOR is set, so piping
 * into an agent yields clean text rather than escape codes.
 */

const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const code = (open: number, close: number) => (text: string) =>
  enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;

export const bold = code(1, 22);
export const dim = code(2, 22);
export const red = code(31, 39);
export const green = code(32, 39);
export const yellow = code(33, 39);
export const blue = code(34, 39);
export const magenta = code(35, 39);
export const cyan = code(36, 39);

export function severityColor(severity: string): (text: string) => string {
  switch (severity) {
    case 'CRITICAL':
      return red;
    case 'HIGH':
      return magenta;
    case 'MEDIUM':
      return yellow;
    default:
      return dim;
  }
}

export function riskColor(level: string): (text: string) => string {
  switch (level) {
    case 'CRITICAL':
    case 'HIGH_RISK':
      return red;
    case 'HIGH':
    case 'MODERATE_RISK':
      return magenta;
    case 'MEDIUM':
      return yellow;
    case 'LOW':
    case 'LOW_RISK':
      return blue;
    default:
      return green;
  }
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Confidence is coloured by band so a low-confidence claim cannot read as fact. */
export function confidenceLabel(value: number): string {
  const text = percent(value);
  if (value >= 0.75) return green(text);
  if (value >= 0.5) return yellow(text);
  return dim(text);
}

export function heading(text: string): string {
  return `\n${bold(text)}\n${dim('─'.repeat(Math.min(text.length, 60)))}`;
}

export function bullet(text: string, indent = 2): string {
  return `${' '.repeat(indent)}${dim('•')} ${text}`;
}

export function table(rows: string[][]): string {
  if (rows.length === 0) return '';

  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => stripAnsi(row[column] ?? '').length)));

  return rows
    .map((row) =>
      row
        .map((cell, column) => {
          const padding = widths[column] - stripAnsi(cell ?? '').length;
          return (cell ?? '') + ' '.repeat(Math.max(0, padding));
        })
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[\d+m/g, '');
}
