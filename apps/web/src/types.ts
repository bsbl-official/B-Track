export type Named = { id: string; name: string };
export type Colored = Named & { color: string };

// Permission keys the API grants through roles (see apps/api/src/lib/permissions.ts).
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

export type AuthConfig = {
  googleClientId: string | null;
  devLogin: boolean;
  devUsers?: Array<{ email: string; name: string; role: { name: string } }>;
  minPasswordLength: number;
};

// What "Continue with Google" leads to: straight in, or the sign-up form.
export type GoogleResult =
  | { result: "signed-in" }
  | { result: "sign-up"; token: string; email: string; firstName: string; lastName: string };

export type Profile = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  hasPassword: boolean;
  // An admin reset the password: the person must choose a new one before using the app.
  mustChangePassword: boolean;
  googleLinked: boolean;
  // The role's permissions adjusted by any per-person grants or removals.
  permissions: string[];
  role: { id: string; name: string; isAssignable: boolean; canTest: boolean };
};

export type Status = Colored & {
  sortOrder: number;
  isClosed: boolean;
  isInitial: boolean;
  nextStatusIds: string[];
};
export type Priority = Colored & { rank: number };
export type TaskType = Colored & { sortOrder: number };
export type MetaUser = Named & { roleName: string; isAssignable: boolean; canTest: boolean };

export type Meta = {
  users: MetaUser[];
  clients: Colored[];
  types: TaskType[];
  priorities: Priority[];
  statuses: Status[];
};

// What the signed-in user may do with a task, decided by the API.
export type TaskAccess = {
  view: boolean;
  edit: boolean;
  delete: boolean;
  setStatus: boolean;
  setPriority: boolean;
  assign: "anyone" | "self" | "none";
  // Choose "Tested by": on tasks they created or are assigned to (or any, with edit-all).
  setTester: boolean;
  comment: boolean;
};

export type Task = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  typeId: string | null;
  priorityId: string | null;
  statusId: string;
  assigneeId: string | null;
  testedById: string | null;
  reporterId: string;
  clients: Colored[];
  type: Colored | null;
  priority: Priority | null;
  status: Colored & { isClosed: boolean };
  reporter: Named;
  assignee: Named | null;
  testedBy: Named | null;
  reportedDate: string;
  expectedDeliveryDate: string | null;
  deliveredDate: string | null;
  gapDays: number | null;
  commentCount: number;
  attachmentCount: number;
  latestComment: { body: string; author: string; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
  access: TaskAccess;
};

export type Comment = { id: string; body: string; createdAt: string; author: Named };
export type HistoryEntry = {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  actor: Named;
};
// Evidence file on a task (the bytes are fetched from its URL, see api.attachmentUrl).
export type Attachment = { id: string; fileName: string; mimeType: string; size: number; createdAt: string; uploader: Named };
export type TaskDetail = Task & { comments: Comment[]; history: HistoryEntry[]; attachments: Attachment[] };

export type TaskUpdate = Partial<{
  title: string;
  description: string | null;
  clientIds: string[];
  typeId: string | null;
  priorityId: string | null;
  statusId: string;
  assigneeId: string | null;
  testedById: string | null;
  reportedDate: string;
  expectedDeliveryDate: string | null;
  deliveredDate: string | null;
}>;

export type NewTask = {
  title: string;
  description?: string;
  clientIds: string[];
  typeId: string | null;
  priorityId?: string | null;
  statusId?: string;
  assigneeId: string | null;
  testedById: string | null;
  reportedDate: string;
  expectedDeliveryDate: string | null;
  comment?: string;
};

export type Dashboard = {
  scope: "all" | "mine";
  cards: { assignedToMe: number; open: number; overdue: number; dueSoon: number; deliveredRecently: number; total: number };
  byStatus: Array<Colored & { count: number }>;
  deadlines: Array<{
    id: string;
    number: number;
    title: string;
    client: string;
    priority: Colored;
    expectedDeliveryDate: string;
    gapDays: number | null;
  }>;
  activity: Array<{
    id: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
    actor: string;
    task: { id: string; number: number; title: string };
  }>;
};

export type Notification = {
  id: string;
  message: string;
  taskId: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  actor: Named | null;
};
export type Notifications = { items: Notification[]; unreadCount: number };

export type ManagedClient = Colored & { isActive: boolean; createdAt: string; _count: { tasks: number } };

export type PermissionInfo = { key: string; group: string; label: string; description: string };
export type AccessRole = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  isAssignable: boolean;
  canTest: boolean;
  isDefault: boolean;
  _count: { users: number };
};
export type UserStatus = "PENDING" | "APPROVED" | "REJECTED";
export type AccessUser = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarUrl: string | null;
  status: UserStatus;
  isActive: boolean;
  hasPassword: boolean;
  mustChangePassword: boolean;
  grantedPermissions: string[];
  revokedPermissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
  roleId: string;
};
export type AccessData = { permissions: PermissionInfo[]; roles: AccessRole[]; users: AccessUser[] };
