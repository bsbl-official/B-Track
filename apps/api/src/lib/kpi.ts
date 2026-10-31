// The developer KPI report, worked out from task history.
//
// Each task's history is replayed into timelines (who held it, its status, its probable date), and
// every event is credited to whoever held the task at that moment. A completed task belongs to the
// person who completed it, timed from when it was assigned to them. Tasks imported from the old sheet
// are left out: they arrived without history, so their start and first probable date are unknown.
import { formatDateOnly } from "./dates.js";
import { prisma } from "./prisma.js";

export const IMPORTED_TASKS_REPORTER_EMAIL = "sheet-import@example.com";

// Statuses the report looks for by name. They come from the seed (there is no admin UI for statuses).
const IN_PROGRESS = "In Progress";
const TESTING = "Testing";
const BLOCKED = "Blocked";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROBABLE_DATE_REASON = "Probable date changed from ";

// Calendar days follow the server's clock, as today() does when it stamps the completed date.
const localDay = (instant: number) => {
  const date = new Date(instant);
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
};
const dayKey = (instant: number) => formatDateOnly(localDay(instant))!;
const dayStart = (date: Date) => new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime();
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);
const parseDay = (value: string) => new Date(`${value}T00:00:00.000Z`);
const round1 = (value: number) => Math.round(value * 10) / 10;

type Span<T> = { value: T; start: number; end: number };

// Replays changes into back-to-back spans; the last one runs on (end = Infinity).
function timeline<T>(initial: T, start: number, changes: Array<{ at: number; value: T }>): Span<T>[] {
  const spans: Span<T>[] = [{ value: initial, start, end: Infinity }];
  for (const change of changes) {
    const last = spans[spans.length - 1];
    if (change.value === last.value) continue;
    last.end = Math.max(change.at, last.start);
    spans.push({ value: change.value, start: last.end, end: Infinity });
  }
  return spans.filter((span) => span.end > span.start);
}

const valueAt = <T>(spans: Span<T>[], at: number): T | undefined => spans.find((span) => span.start <= at && at < span.end)?.value;

export type TaskRef = {
  id: string;
  number: number;
  title: string;
  pos: Array<{ id: string; name: string; color: string }>;
  priority: string | null;
  type: string | null;
};

export type CompletedTask = TaskRef & {
  assignedAt: string;
  startedAt: string | null;
  testingAt: string | null;
  completedDate: string;
  firstProbableDate: string | null;
  finalProbableDate: string | null;
  // Completed date minus first probable date: 0 or less is on time, null without a probable date.
  daysLate: number | null;
  daysToComplete: number;
  timesFailedTesting: number;
  // Status spans while it was theirs, for the timeline chart.
  stages: Array<{ status: string; from: string; to: string }>;
};

export type DateChange = TaskRef & { at: string; from: string; to: string | null; days: number | null; by: string; reason: string | null };
export type TaskEvent = TaskRef & { at: string; by: string };
export type BlockedStretch = TaskRef & { from: string; to: string | null; days: number };

export type PersonReport = {
  person: { id: string; name: string; role: string; isActive: boolean };
  summary: {
    handled: number;
    completed: number;
    onTime: number;
    late: number;
    noDate: number;
    onTimeRate: number | null;
    averageDaysLate: number | null;
    medianDaysToComplete: number | null;
    dateChanges: number;
    daysPushedBack: number;
    failedTesting: number;
    reopened: number;
    blockedDays: number;
    blockedTasks: number;
  };
  completed: CompletedTask[];
  dateChanges: DateChange[];
  failedTesting: TaskEvent[];
  reopened: Array<TaskEvent & { completedDate: string | null }>;
  blocked: BlockedStretch[];
  priorityMix: Array<{ name: string; handled: number; completed: number }>;
  typeMix: Array<{ name: string; handled: number; completed: number }>;
  poShare: Array<{ id: string; name: string; color: string; handled: number; completed: number; share: number }>;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : round1((sorted[middle - 1] + sorted[middle]) / 2);
}

export async function buildKpiReport(from: string, to: string, onlyPeople: string[] | null, onlyPos: string[] | null) {
  const periodStart = dayStart(parseDay(from));
  const periodEndDay = parseDay(to);
  periodEndDay.setUTCDate(periodEndDay.getUTCDate() + 1);
  const now = Date.now();
  const periodEnd = Math.min(dayStart(periodEndDay), now);
  const inPeriod = (at: number) => at >= periodStart && at < periodEnd;

  const [tasks, users, statuses, priorities, types, excludedImported] = await Promise.all([
    prisma.task.findMany({
      where: {
        reporter: { email: { not: IMPORTED_TASKS_REPORTER_EMAIL } },
        // With a PO filter, only tasks for at least one of those POs.
        ...(onlyPos ? { clients: { some: { id: { in: onlyPos } } } } : {}),
      },
      select: {
        id: true,
        number: true,
        title: true,
        createdAt: true,
        assigneeId: true,
        expectedDeliveryDate: true,
        deliveredDate: true,
        status: { select: { name: true, isClosed: true } },
        clients: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
        type: { select: { name: true, isRoutine: true } },
        priority: { select: { name: true } },
        history: {
          where: { field: { in: ["Status", "Assignee", "Probable date"] } },
          orderBy: { createdAt: "asc" },
          select: { field: true, oldValue: true, newValue: true, oldRef: true, newRef: true, createdAt: true, actor: { select: { id: true, name: true } } },
        },
        comments: {
          where: { body: { startsWith: PROBABLE_DATE_REASON } },
          select: { body: true, createdAt: true, authorId: true },
        },
      },
    }),
    prisma.user.findMany({ select: { id: true, name: true, isActive: true, role: { select: { name: true } } } }),
    prisma.status.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true, color: true, isClosed: true } }),
    prisma.priority.findMany({ orderBy: { rank: "asc" }, select: { name: true, color: true } }),
    prisma.taskType.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true, color: true } }),
    prisma.task.count({ where: { reporter: { email: IMPORTED_TASKS_REPORTER_EMAIL } } }),
  ]);

  const closedStatuses = new Set(statuses.filter((status) => status.isClosed).map((status) => status.name));
  const usersById = new Map(users.map((user) => [user.id, user]));
  // Older history rows name the assignee without an id; a name only counts when it's unique.
  const idsByName = new Map<string, string | null>();
  for (const user of users) idsByName.set(user.name, idsByName.has(user.name) ? null : user.id);
  const byName = (name: string) => idsByName.get(name) ?? null;

  const people = new Map<string, PersonReport>();
  const handledTasks = new Map<string, Map<string, TaskRef>>();
  const personFor = (userId: string) => {
    let report = people.get(userId);
    if (!report) {
      const user = usersById.get(userId);
      report = {
        person: { id: userId, name: user?.name ?? "Unknown", role: user?.role.name ?? "", isActive: user?.isActive ?? false },
        summary: { handled: 0, completed: 0, onTime: 0, late: 0, noDate: 0, onTimeRate: null, averageDaysLate: null, medianDaysToComplete: null, dateChanges: 0, daysPushedBack: 0, failedTesting: 0, reopened: 0, blockedDays: 0, blockedTasks: 0 },
        completed: [],
        dateChanges: [],
        failedTesting: [],
        reopened: [],
        blocked: [],
        priorityMix: [],
        typeMix: [],
        poShare: [],
      };
      people.set(userId, report);
      handledTasks.set(userId, new Map());
    }
    return report;
  };
  const markHandled = (userId: string, ref: TaskRef) => {
    personFor(userId);
    handledTasks.get(userId)!.set(ref.id, ref);
  };

  for (const task of tasks) {
    const created = task.createdAt.getTime();
    const ref: TaskRef = {
      id: task.id,
      number: task.number,
      title: task.title,
      pos: task.clients,
      priority: task.priority?.name ?? null,
      type: task.type?.name ?? null,
    };
    const rows = task.history.map((row) => ({ ...row, at: row.createdAt.getTime() }));
    const statusRows = rows.filter((row) => row.field === "Status");
    const probableRows = rows.filter((row) => row.field === "Probable date");

    // Who held the task, walked back from today's assignee so a repeated name resolves to the right person.
    const assigneeRows = rows.filter((row) => row.field === "Assignee");
    let holder = task.assigneeId;
    const assigneeChanges: Array<{ at: number; value: string | null }> = [];
    for (const row of [...assigneeRows].reverse()) {
      const toId =
        row.newValue === null ? null : row.newRef ?? (holder && usersById.get(holder)?.name === row.newValue ? holder : byName(row.newValue));
      assigneeChanges.unshift({ at: row.at, value: toId });
      holder = row.oldValue === null ? null : row.oldRef ?? byName(row.oldValue);
    }
    const holders = timeline(holder, created, assigneeChanges);
    const statusSpans = timeline(statusRows[0]?.oldValue ?? task.status.name, created, statusRows.map((row) => ({ at: row.at, value: row.newValue ?? "" })));
    const probable = timeline(
      probableRows[0] ? probableRows[0].oldValue : formatDateOnly(task.expectedDeliveryDate),
      created,
      probableRows.map((row) => ({ at: row.at, value: row.newValue })),
    );

    // Tasks someone held during the period, unless the task was already closed for all of that time.
    for (const span of holders) {
      if (!span.value || span.end <= periodStart || span.start >= periodEnd) continue;
      const a = Math.max(span.start, periodStart);
      const b = Math.min(span.end, periodEnd);
      const openAtSomePoint = statusSpans.some((status) => status.start < b && status.end > a && !closedStatuses.has(status.value));
      if (openAtSomePoint) markHandled(span.value, ref);
    }

    // Daily (routine) tasks have no probable date, so they're left out of completions and date changes.
    const isRoutine = task.type?.isRoutine ?? false;

    // 1, 2, 8. Completed in the period: credited to whoever held it when it was (last) completed.
    const deliveredKey = formatDateOnly(task.deliveredDate);
    if (!isRoutine && task.status.isClosed && deliveredKey && deliveredKey >= from && deliveredKey <= to) {
      const lastCompletion = [...statusRows].reverse().find((row) => row.newValue && closedStatuses.has(row.newValue));
      const completedAt = lastCompletion?.at ?? created;
      const span = holders.find((item) => item.start <= completedAt && completedAt < item.end);
      if (span?.value) {
        const owner = personFor(span.value);
        markHandled(span.value, ref);
        const within = (at: number) => at >= span.start && at <= completedAt;
        const firstEntry = (status: string) => {
          if (valueAt(statusSpans, span.start) === status) return span.start;
          return statusRows.find((row) => row.newValue === status && within(row.at))?.at ?? null;
        };
        const startedAt = firstEntry(IN_PROGRESS);
        const testingAt = firstEntry(TESTING);
        const firstProbable =
          valueAt(probable, span.start) ?? probableRows.find((row) => row.newValue && within(row.at))?.newValue ?? null;
        const finalProbable = valueAt(probable, completedAt) ?? null;
        const daysLate = firstProbable ? daysBetween(parseDay(firstProbable), task.deliveredDate!) : null;
        owner.completed.push({
          ...ref,
          assignedAt: new Date(span.start).toISOString(),
          startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
          testingAt: testingAt === null ? null : new Date(testingAt).toISOString(),
          completedDate: deliveredKey,
          firstProbableDate: firstProbable,
          finalProbableDate: finalProbable,
          daysLate,
          daysToComplete: Math.max(0, daysBetween(localDay(span.start), task.deliveredDate!)),
          timesFailedTesting: statusRows.filter((row) => row.oldValue === TESTING && row.newValue === IN_PROGRESS && within(row.at)).length,
          stages: statusSpans
            .filter((status) => status.start < completedAt && status.end > span.start)
            .map((status) => ({
              status: status.value,
              from: new Date(Math.max(status.start, span.start)).toISOString(),
              to: new Date(Math.min(status.end, completedAt)).toISOString(),
            })),
        });
      }
    }

    // 3. Probable date moves (the first date set doesn't count), with the reason given.
    for (const row of probableRows) {
      if (isRoutine || !row.oldValue || !inPeriod(row.at)) continue;
      const userId = valueAt(holders, row.at);
      if (!userId) continue;
      const reason = task.comments
        .filter((comment) => comment.authorId === row.actor.id && Math.abs(comment.createdAt.getTime() - row.at) < 10_000)
        .map((comment) => comment.body.slice(comment.body.indexOf(": ") + 2))[0];
      personFor(userId).dateChanges.push({
        ...ref,
        at: new Date(row.at).toISOString(),
        from: row.oldValue,
        to: row.newValue,
        days: row.newValue ? daysBetween(parseDay(row.oldValue), parseDay(row.newValue)) : null,
        by: row.actor.name,
        reason: reason ?? null,
      });
    }

    for (const row of statusRows) {
      if (!inPeriod(row.at)) continue;
      // 4. Sent back from testing.
      if (row.oldValue === TESTING && row.newValue === IN_PROGRESS) {
        const userId = valueAt(holders, row.at);
        if (userId) personFor(userId).failedTesting.push({ ...ref, at: new Date(row.at).toISOString(), by: row.actor.name });
      }
      // 5. Reopened: charged to whoever completed it.
      if (row.oldValue && closedStatuses.has(row.oldValue) && row.newValue && !closedStatuses.has(row.newValue)) {
        const completion = [...statusRows].reverse().find((earlier) => earlier.at < row.at && earlier.newValue && closedStatuses.has(earlier.newValue));
        const completedAt = completion?.at ?? created;
        const userId = valueAt(holders, completedAt) ?? valueAt(holders, row.at);
        if (userId) {
          personFor(userId).reopened.push({ ...ref, at: new Date(row.at).toISOString(), by: row.actor.name, completedDate: dayKey(completedAt) });
        }
      }
    }

    // 6. Time in Blocked within the period, split between whoever held the task meanwhile.
    for (const status of statusSpans) {
      if (status.value !== BLOCKED) continue;
      for (const span of holders) {
        if (!span.value) continue;
        const a = Math.max(status.start, span.start, periodStart);
        const b = Math.min(status.end, span.end, periodEnd);
        if (b <= a) continue;
        personFor(span.value).blocked.push({
          ...ref,
          from: new Date(a).toISOString(),
          to: b === now && status.end === Infinity ? null : new Date(b).toISOString(),
          days: round1((b - a) / DAY_MS),
        });
      }
    }
  }

  for (const [userId, report] of people) {
    const handled = [...handledTasks.get(userId)!.values()];
    const { completed, summary } = report;
    const completedIds = new Set(completed.map((task) => task.id));
    const late = completed.filter((task) => task.daysLate !== null && task.daysLate > 0);

    summary.handled = handled.length;
    summary.completed = completed.length;
    summary.onTime = completed.filter((task) => task.daysLate !== null && task.daysLate <= 0).length;
    summary.late = late.length;
    summary.noDate = completed.filter((task) => task.daysLate === null).length;
    summary.onTimeRate = summary.onTime + summary.late ? Math.round((summary.onTime / (summary.onTime + summary.late)) * 100) : null;
    summary.averageDaysLate = late.length ? round1(late.reduce((sum, task) => sum + task.daysLate!, 0) / late.length) : null;
    summary.medianDaysToComplete = median(completed.map((task) => task.daysToComplete));
    summary.dateChanges = report.dateChanges.length;
    summary.daysPushedBack = report.dateChanges.reduce((sum, change) => sum + Math.max(0, change.days ?? 0), 0);
    summary.failedTesting = report.failedTesting.length;
    summary.reopened = report.reopened.length;
    summary.blockedDays = round1(report.blocked.reduce((sum, stretch) => sum + stretch.days, 0));
    summary.blockedTasks = new Set(report.blocked.map((stretch) => stretch.id)).size;

    const mix = (names: string[], key: (task: TaskRef) => string | null) =>
      [...names, "Not set"]
        .map((name) => ({
          name,
          handled: handled.filter((task) => (key(task) ?? "Not set") === name).length,
          completed: completed.filter((task) => (key(task) ?? "Not set") === name).length,
        }))
        .filter((row) => row.name !== "Not set" || row.handled > 0);
    report.priorityMix = mix(priorities.map((priority) => priority.name), (task) => task.priority);
    report.typeMix = mix(types.map((type) => type.name), (task) => task.type);

    // A task with several POs counts toward each of them (only the chosen ones, with a PO filter);
    // shares are of all those PO slots.
    const pos = new Map<string, PersonReport["poShare"][number]>();
    for (const task of handled) {
      for (const po of task.pos.filter((item) => !onlyPos || onlyPos.includes(item.id))) {
        const row = pos.get(po.id) ?? { ...po, handled: 0, completed: 0, share: 0 };
        row.handled += 1;
        if (completedIds.has(task.id)) row.completed += 1;
        pos.set(po.id, row);
      }
    }
    const slots = [...pos.values()].reduce((sum, row) => sum + row.handled, 0);
    report.poShare = [...pos.values()]
      .map((row) => ({ ...row, share: slots ? Math.round((row.handled / slots) * 1000) / 10 : 0 }))
      .sort((a, b) => b.handled - a.handled || a.name.localeCompare(b.name));

    completed.sort((a, b) => a.completedDate.localeCompare(b.completedDate) || a.number - b.number);
    report.dateChanges.sort((a, b) => a.at.localeCompare(b.at));
    report.failedTesting.sort((a, b) => a.at.localeCompare(b.at));
    report.reopened.sort((a, b) => a.at.localeCompare(b.at));
    report.blocked.sort((a, b) => a.from.localeCompare(b.from));
  }

  // Everyone asked for appears (even with nothing to show); otherwise everyone who had work.
  if (onlyPeople) {
    for (const id of onlyPeople) if (usersById.has(id)) personFor(id);
  }
  const reports = [...people.values()]
    .filter((report) => !onlyPeople || onlyPeople.includes(report.person.id))
    .sort((a, b) => b.summary.completed - a.summary.completed || b.summary.handled - a.summary.handled || a.person.name.localeCompare(b.person.name));

  return {
    from,
    to,
    generatedAt: new Date(now).toISOString(),
    excludedImported,
    statuses: statuses.map(({ name, color }) => ({ name, color })),
    priorities,
    types,
    people: reports,
  };
}
