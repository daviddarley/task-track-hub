/**
 * Display-only helpers. Nothing here is allowed to reach into an adapter or
 * branch on which service a task came from.
 */

const MS_PER_DAY = 86_400_000;

export interface DueLabel {
  text: string;
  overdue: boolean;
}

/**
 * Due dates read at a glance, not as dates: "3d late" and "Today" are the two
 * things worth noticing, and anything past next week can just be a date.
 */
export function formatDue(iso: string | null, now: Date = new Date()): DueLabel {
  if (!iso) return { text: '', overdue: false };

  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return { text: '', overdue: false };

  const days = calendarDaysBetween(now, due);

  if (days < 0) {
    const late = Math.abs(days);
    return { text: `${late}d late`, overdue: true };
  }
  if (days === 0) return { text: 'Today', overdue: true };
  if (days === 1) return { text: 'Tomorrow', overdue: false };
  if (days <= 6) return { text: due.toLocaleDateString(undefined, { weekday: 'short' }), overdue: false };

  const sameYear = due.getFullYear() === now.getFullYear();
  return {
    text: due.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: '2-digit' as const }),
    }),
    overdue: false,
  };
}

/**
 * Whole calendar days between two instants, ignoring time of day — a task due
 * at 09:00 today is "Today" at 17:00, not "1d late".
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

export function formatAgo(iso: string, now: Date = new Date()): string {
  if (!iso) return 'never';

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'never';

  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

export function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}
