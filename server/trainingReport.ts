// A piece's training report for a project's managers: how many of the
// project's members practised it, by group, how well the piece sits, and
// which bars go well or badly and in what way — anonymous. Only sums and
// averages leave the server, and any figure about quality needs at least
// MIN_PEOPLE people behind it, so nobody's results can be singled out.
//
// The per-person measures follow the trainer's own (src/tonetrainer/core/
// stats.ts): a run is judged against the whole piece, and a bar counts as
// known when the last three tries at it average GOOD_MEASURE or better.
import { db, authUid, ApiError, forbidden } from './db.ts';
import { canAccessProject } from './policies.ts';

type Args = Record<string, unknown>;

export const MIN_PEOPLE = 3;
const GOOD_MEASURE = 0.85;
const LAST_TRIES = 3;

interface MeasureStat {
  label: string;
  n: number;
  score: number;
  good: number;
  ok: number;
  flat: number;
  sharp: number;
  silent: number;
  biasSum: number;
  biasN: number;
}

interface Session {
  trackId: string;
  trackName: string;
  startedAt: number;
  practiceSec: number;
  notes: number;
  measures: Record<string, MeasureStat>;
  pieceMeasures?: Record<string, { label: string; notes: number }>;
}

type Piece = Map<number, { label: string; notes: number }>;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const accuracyOf = (s: Session, mi: number) => {
  const m = s.measures[mi];
  return m && m.n ? m.score / m.n : null;
};

// The voice's bars: from the newest run (anyone's) that recorded them, else
// the bars sung so far.
const pieceOf = (runs: Session[]): Piece => {
  const known = [...runs].sort((a, b) => b.startedAt - a.startedAt).find((s) => s.pieceMeasures);
  if (known?.pieceMeasures) return new Map(Object.entries(known.pieceMeasures).map(([k, m]) => [Number(k), m]));
  const piece: Piece = new Map();
  for (const s of runs) {
    for (const [k, m] of Object.entries(s.measures)) {
      const prev = piece.get(Number(k));
      if (!prev || m.n > prev.notes) piece.set(Number(k), { label: m.label, notes: m.n });
    }
  }
  return piece;
};

// A run against the whole piece: unsung bars count as 0.
const runScore = (s: Session, piece: Piece) => {
  let total = 0;
  let points = 0;
  for (const [mi, { notes }] of piece) {
    total += notes;
    points += (accuracyOf(s, mi) ?? 0) * notes;
  }
  return total ? points / total : 0;
};

// Share of the piece's bars someone knows (their last tries at each).
const mastery = (runs: Session[], piece: Piece) => {
  if (piece.size === 0) return 0;
  let good = 0;
  for (const mi of piece.keys()) {
    const tries = runs.map((s) => accuracyOf(s, mi)).filter((v): v is number => v !== null).slice(-LAST_TRIES);
    if (tries.length && mean(tries) >= GOOD_MEASURE) good++;
  }
  return good / piece.size;
};

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

const piece_training_report = (args: Args) => {
  const uid = authUid();
  if (!uid) throw new ApiError('Authentication required', 401, '42501');
  const projectId = text(args.p_project_id);
  const pieceId = text(args.p_piece_id);
  // A named parameter, as the predicate may not use it (see rpc.ts).
  const allowed = (db.prepare(`select (${canAccessProject('@pid')}) as v`).get({ pid: projectId }) as { v: number }).v;
  if (!allowed) throw forbidden('Access denied');
  if (!db.prepare('select 1 from project_pieces where project_id = ? and piece_id = ?').get(projectId, pieceId)) {
    throw new ApiError('Piece not found', 404);
  }

  // The project's active members with an account, and their group.
  const members = db
    .prepare(
      `select user_id, group_name from members
       where project_id = ? and status = 'active' and user_id is not null`,
    )
    .all(projectId) as Array<{ user_id: string; group_name: string | null }>;
  const groupOf = new Map(members.map((m) => [m.user_id, m.group_name?.trim() || null]));
  const groupRows = db
    .prepare('select name, color from project_groups where project_id = ? order by position, created_at')
    .all(projectId) as Array<{ name: string; color: string }>;

  // Their graded runs of this piece, per person.
  const rows = db
    .prepare(
      `select user_id, data from practice_sessions
       where piece_id = ? and user_id in (select value from json_each(?)) order by started_at`,
    )
    .all(pieceId, JSON.stringify([...groupOf.keys()])) as Array<{ user_id: string; data: string }>;
  const byPerson = new Map<string, Session[]>();
  let practiceSec = 0;
  let lastRunAt: number | null = null;
  for (const row of rows) {
    let s: Session;
    try {
      s = JSON.parse(row.data) as Session;
    } catch {
      continue;
    }
    practiceSec += Number(s.practiceSec) || 0;
    if (!s.notes || !s.measures) continue;
    byPerson.set(row.user_id, [...(byPerson.get(row.user_id) ?? []), s]);
    lastRunAt = Math.max(lastRunAt ?? 0, Number(s.startedAt) || 0);
  }

  // Each voice's runs (all people) and its bars.
  const runsByTrack = new Map<string, { name: string; runs: Session[] }>();
  for (const runs of byPerson.values()) {
    for (const s of runs) {
      const entry = runsByTrack.get(s.trackId) ?? { name: s.trackName, runs: [] };
      entry.runs.push(s);
      runsByTrack.set(s.trackId, entry);
    }
  }
  const pieces = new Map([...runsByTrack].map(([id, { runs }]) => [id, pieceOf(runs)]));

  // Per person: the voice they practised most, how much of it they know and
  // how their latest run of it went.
  const people = [...byPerson].map(([userId, runs]) => {
    const counts = new Map<string, number>();
    for (const s of runs) counts.set(s.trackId, (counts.get(s.trackId) ?? 0) + 1);
    const trackId = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const own = runs.filter((s) => s.trackId === trackId);
    const piece = pieces.get(trackId) ?? new Map();
    return {
      group: groupOf.get(userId) ?? null,
      runs: runs.length,
      mastery: mastery(own, piece),
      latest: runScore(own[own.length - 1], piece),
    };
  });

  const enough = people.length >= MIN_PEOPLE;
  // People by how much of the piece they know: under 25 %, 25–50, 50–75, 75+.
  const buckets = [0, 0, 0, 0];
  for (const p of people) buckets[Math.min(3, Math.floor(p.mastery * 4))]++;

  // Groups: the project's own (in their order), then any other name members
  // carry, then members without a group.
  const groupNames = [
    ...groupRows.map((g) => g.name),
    ...[...new Set(members.map((m) => m.group_name?.trim()).filter((g): g is string => Boolean(g)))].filter(
      (g) => !groupRows.some((r) => r.name === g),
    ),
  ];
  const groupStats = [...groupNames, null].flatMap((name) => {
    const memberCount = members.filter((m) => (m.group_name?.trim() || null) === name).length;
    if (memberCount === 0) return [];
    const trained = people.filter((p) => p.group === name);
    // In a small group even who practised would point at someone: no numbers.
    const small = memberCount < MIN_PEOPLE;
    return [
      {
        name,
        color: groupRows.find((g) => g.name === name)?.color ?? null,
        members: memberCount,
        trained: small ? null : trained.length,
        runs: small ? null : trained.reduce((a, p) => a + p.runs, 0),
        // Only with enough people behind it.
        mastery: trained.length >= MIN_PEOPLE ? mean(trained.map((p) => p.mastery)) : null,
      },
    ];
  });

  // Bar by bar, per voice: each person counts once (their last tries at the
  // bar), what went wrong is summed over all their notes there.
  const tracks = [...runsByTrack].map(([trackId, { name, runs }]) => {
    const personRuns = new Map<string, Session[]>();
    for (const [userId, all] of byPerson) {
      const own = all.filter((s) => s.trackId === trackId);
      if (own.length) personRuns.set(userId, own);
    }
    const piece = pieces.get(trackId) ?? new Map();
    const measures =
      personRuns.size < MIN_PEOPLE
        ? []
        : [...piece].sort((a, b) => a[0] - b[0]).map(([mi, { label }]) => {
            let tries = 0;
            const perPerson: number[] = [];
            const grades = { good: 0, ok: 0, flat: 0, sharp: 0, silent: 0 };
            const biases: number[] = [];
            for (const own of personRuns.values()) {
              const accs = own.map((s) => accuracyOf(s, mi)).filter((v): v is number => v !== null);
              if (!accs.length) continue;
              perPerson.push(mean(accs.slice(-LAST_TRIES)));
              tries += accs.length;
              for (const s of own) {
                const m = s.measures[mi];
                if (!m) continue;
                for (const g of Object.keys(grades) as Array<keyof typeof grades>) grades[g] += m[g] || 0;
                if (m.biasN) biases.push(m.biasSum / m.biasN);
              }
            }
            const notes = Object.values(grades).reduce((a, b) => a + b, 0);
            const share = (n: number) => (notes ? n / notes : 0);
            return {
              index: mi,
              label,
              people: perPerson.length,
              tries,
              accuracy: perPerson.length ? mean(perPerson) : null,
              good: share(grades.good),
              ok: share(grades.ok),
              flat: share(grades.flat),
              sharp: share(grades.sharp),
              silent: share(grades.silent),
              bias: biases.length ? mean(biases) : null,
            };
          });
    return { id: trackId, name, people: personRuns.size, runs: runs.length, bars: piece.size, measures };
  });

  return {
    minPeople: MIN_PEOPLE,
    members: members.length,
    trained: people.length,
    runs: people.reduce((a, p) => a + p.runs, 0),
    practiceMinutes: Math.round(practiceSec / 60),
    lastRunAt,
    overall: enough
      ? {
          mastery: mean(people.map((p) => p.mastery)),
          latest: mean(people.map((p) => p.latest)),
          buckets,
        }
      : null,
    groups: groupStats,
    tracks: tracks.sort((a, b) => b.people - a.people),
  };
};

export const trainingReportFunctions = { piece_training_report };
