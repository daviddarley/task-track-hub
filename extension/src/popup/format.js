/**
 * Display-only helpers. Nothing here is allowed to reach into an adapter or
 * branch on which service a task came from.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Due dates read as a glance, not a date: "3d late" and "Today" are the two
 * things worth noticing, and anything past next week can just be a date.
 *
 * @param {string | null} iso
 * @param {Date} [now]
 * @returns {{ text: string, overdue: boolean }}
 */
export function formatDue(iso, now = new Date()) {
  if (!iso) return { text: '', overdue: false };
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return { text: '', overdue: false };

  const days = calendarDaysBetween(now, due);

  if (days < 0) {
    const late = Math.abs(days);
    return { text: late === 1 ? '1d late' : `${late}d late`, overdue: true };
  }
  if (days === 0) return { text: 'Today', overdue: true };
  if (days === 1) return { text: 'Tomorrow', overdue: false };
  if (days <= 6) return { text: due.toLocaleDateString(undefined, { weekday: 'short' }), overdue: false };

  const sameYear = due.getFullYear() === now.getFullYear();
  return {
    text: due.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: '2-digit' }),
    }),
    overdue: false,
  };
}

/**
 * Whole calendar days between two instants, ignoring time of day — a task due
 * at 09:00 today is "Today" at 17:00, not "1d late".
 *
 * @param {Date} from
 * @param {Date} to
 * @returns {number}
 */
function calendarDaysBetween(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * @param {string} iso
 * @param {Date} [now]
 * @returns {string}
 */
export function formatAgo(iso, now = new Date()) {
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

/**
 * @param {number} count
 * @param {string} singular
 * @returns {string}
 */
export function plural(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}
