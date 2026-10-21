// The Home headline, from the count of things waiting on the client. Number words through twelve,
// digits after that.

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** "three" for 3, "13" for 13. */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Nothing needs you right now", "One thing needs you", "Two things need you". */
export function homeHeadline(count: number): string {
  if (count <= 0) return 'Nothing needs you right now';
  if (count === 1) return 'One thing needs you';
  return `${capitalize(numberWord(count))} things need you`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The lede, from the moving counts with zeros skipped: "2 projects, your retainer and 3 requests are moving." */
export function homeLede(moving: { projects: number; retainers: number; requests: number } | undefined): string {
  if (!moving) return '';
  const parts: string[] = [];
  if (moving.projects > 0) parts.push(`${moving.projects} ${plural(moving.projects, 'project', 'projects')}`);
  if (moving.retainers > 0) parts.push(moving.retainers === 1 ? 'your retainer' : `${moving.retainers} retainers`);
  if (moving.requests > 0) parts.push(`${moving.requests} ${plural(moving.requests, 'request', 'requests')}`);
  if (parts.length === 0) return 'No work is open right now.';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const single = parts.length === 1 && (moving.projects === 1 || moving.retainers === 1 || moving.requests === 1);
  return capitalize(`${list} ${single ? 'is' : 'are'} moving.`);
}
