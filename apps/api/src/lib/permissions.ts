// Every action the API guards. Roles grant these keys; code checks keys, never role names.
export const PERMISSIONS = {
  taskCreate: "task.create",
  taskViewAll: "task.view_all",
  taskEditAll: "task.edit_all",
  taskAssignAny: "task.assign_any",
  taskSetPriority: "task.set_priority",
  taskSetStatus: "task.set_status",
  commentCreate: "comment.create",
  dashboardViewAll: "dashboard.view_all",
  poManage: "po.manage",
  accessManage: "access.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Shown on the Access management page.
export const PERMISSION_CATALOGUE: Array<{ key: Permission; group: string; label: string; description: string }> = [
  { key: PERMISSIONS.taskCreate, group: "Tasks", label: "Create tasks", description: "Add new tasks. People can always edit their own tasks (created by or assigned to them) and delete the ones they created." },
  { key: PERMISSIONS.taskViewAll, group: "Tasks", label: "See all tasks", description: "Without this, a user sees only tasks they created or are assigned to." },
  { key: PERMISSIONS.taskEditAll, group: "Tasks", label: "Edit & delete any task", description: "Change or delete any task, not just their own." },
  { key: PERMISSIONS.taskAssignAny, group: "Tasks", label: "Assign to anyone", description: "Move tasks from one person to another. Without this, people can only assign their own or unassigned tasks to themselves, or unassign them." },
  { key: PERMISSIONS.taskSetPriority, group: "Tasks", label: "Set priority", description: "Set or change the priority of their own tasks (or any task, with “Edit & delete any task”). Without this, priority is left for others to set." },
  { key: PERMISSIONS.taskSetStatus, group: "Tasks", label: "Change status", description: "Move tasks through the workflow (their own, assigned, or all with “Edit & delete any task”)." },
  { key: PERMISSIONS.commentCreate, group: "Tasks", label: "Comment", description: "Comment on tasks they can see." },
  { key: PERMISSIONS.dashboardViewAll, group: "Dashboard", label: "See team-wide dashboard", description: "See metrics for every task across all POs. Without this, the dashboard shows only their own numbers: tasks assigned to them, overdue, due soon and completed." },
  { key: PERMISSIONS.poManage, group: "Administration", label: "Manage POs", description: "Create, rename and archive POs." },
  { key: PERMISSIONS.accessManage, group: "Administration", label: "Manage access", description: "Open this page: change roles, permissions and users." },
];

// A person's permissions: their role's, plus any granted to them, minus any revoked from them.
export function effectivePermissions(user: { grantedPermissions: string[]; revokedPermissions: string[]; role: { permissions: string[] } }): string[] {
  const permissions = new Set([...user.role.permissions, ...user.grantedPermissions]);
  for (const permission of user.revokedPermissions) permissions.delete(permission);
  return [...permissions];
}
