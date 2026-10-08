// Reminders for the assigned dev when an open task is due today or overdue.
// Created when the person's notifications are fetched (no background job on the free host);
// the reminder key makes each one appear only once.
import { formatDateOnly, today } from "./dates.js";
import { prisma } from "./prisma.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (date: Date) => `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]}`;

export async function createDeadlineReminders(userId: string) {
  const day = today();
  const tasks = await prisma.task.findMany({
    where: { assigneeId: userId, status: { isClosed: false }, expectedDeliveryDate: { lte: day } },
    select: { id: true, number: true, title: true, expectedDeliveryDate: true },
  });
  if (tasks.length === 0) return;

  await prisma.notification.createMany({
    skipDuplicates: true,
    data: tasks.map((task) => {
      const due = task.expectedDeliveryDate!;
      const dueToday = due.getTime() === day.getTime();
      // Due today: once that day. Overdue: once per probable date, so moving the date and missing it again reminds again.
      return {
        userId,
        taskId: task.id,
        reminderKey: `${dueToday ? "due-today" : "overdue"}:${task.id}:${formatDateOnly(due)}`,
        message: dueToday
          ? `#${task.number} “${task.title}” is due today`
          : `#${task.number} “${task.title}” is overdue (probable date was ${shortDate(due)})`,
      };
    }),
  });
}
