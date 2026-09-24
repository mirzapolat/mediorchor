// When a Probe counts as held. Undated Proben count as held; dated ones from
// the day after onwards — today's Probe may not have happened yet, so nobody
// is counted absent for it. Everything that tallies attendance (Fehlzeiten,
// labels, statistics, member pages) uses this, so the numbers agree.

// Today as YYYY-MM-DD in the viewer's time zone (not UTC, which is a day off
// around midnight in Europe).
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const isHeld = (date: string | null, today = localToday()) => !date || date < today;
