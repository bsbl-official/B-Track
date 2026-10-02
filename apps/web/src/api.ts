import type {
  AccessData,
  AccessRole,
  AccessUser,
  AuthConfig,
  GoogleResult,
  UserStatus,
  Comment,
  Dashboard,
  ManagedClient,
  Meta,
  NewTask,
  Notifications,
  Profile,
  Task,
  TaskDetail,
  TaskUpdate,
  Attachment,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

// Fired when the API says the session is gone, so the app can return to the sign-in page.
export const SESSION_EXPIRED_EVENT = "btrack:session-expired";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
  });
  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) {
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(body?.error?.message ?? `Request failed with status ${response.status}`, response.status);
  }
  return body.data as T;
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  authConfig: () => request<AuthConfig>("/auth/config"),
  login: (email: string, password: string) => request<GoogleResult>("/auth/login", send("POST", { email, password })),
  continueWithGoogle: (credential: string) => request<GoogleResult>("/auth/google", send("POST", { credential })),
  signup: (details: { token: string; firstName: string; lastName: string; password: string }) =>
    request<{ result: "signed-in" | "pending" }>("/auth/signup", send("POST", details)),
  devLogin: (email: string) => request<GoogleResult>("/auth/dev/login", send("POST", { email })),
  devGoogle: (identity: { email: string; firstName: string; lastName: string }) =>
    request<GoogleResult>("/auth/dev/google", send("POST", identity)),
  me: () => request<Profile>("/auth/me"),
  updateMe: (names: { firstName: string; lastName: string }) => request<void>("/auth/me", send("PATCH", names)),
  changePassword: (passwords: { currentPassword?: string; newPassword: string }) =>
    request<void>("/auth/me/password", send("POST", passwords)),
  logout: () => request<void>("/auth/logout", send("POST")),

  meta: () => request<Meta>("/meta"),
  dashboard: () => request<Dashboard>("/dashboard"),

  listTasks: () => request<Task[]>("/tasks"),
  getTask: (id: string) => request<TaskDetail>(`/tasks/${id}`),
  createTask: (task: NewTask) => request<Task>("/tasks", send("POST", task)),
  updateTask: (id: string, update: TaskUpdate) => request<Task>(`/tasks/${id}`, send("PATCH", update)),
  deleteTask: (id: string) => request<void>(`/tasks/${id}`, send("DELETE")),
  addComment: (taskId: string, body: string) => request<Comment>(`/tasks/${taskId}/comments`, send("POST", { body })),
  // The file itself is the request body; the server reads its type from Content-Type.
  uploadAttachment: (taskId: string, file: File) =>
    request<Attachment>(`/tasks/${taskId}/attachments?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    }),
  deleteAttachment: (taskId: string, attachmentId: string) => request<void>(`/tasks/${taskId}/attachments/${attachmentId}`, send("DELETE")),
  attachmentUrl: (taskId: string, attachmentId: string, download = false) =>
    `/api/tasks/${taskId}/attachments/${attachmentId}${download ? "?download" : ""}`,

  listClients: () => request<ManagedClient[]>("/clients"),
  createClient: (name: string) => request<ManagedClient>("/clients", send("POST", { name })),
  updateClient: (id: string, update: { name?: string; color?: string; isActive?: boolean }) =>
    request<ManagedClient>(`/clients/${id}`, send("PATCH", update)),

  notifications: () => request<Notifications>("/notifications"),
  markNotificationRead: (id: string) => request<void>(`/notifications/${id}/read`, send("POST")),
  markAllNotificationsRead: () => request<void>("/notifications/read-all", send("POST")),

  access: () => request<AccessData>("/access"),
  createRole: (role: Omit<AccessRole, "id" | "_count">) => request<AccessRole>("/access/roles", send("POST", role)),
  updateRole: (id: string, update: Partial<Omit<AccessRole, "id" | "_count">>) =>
    request<AccessRole>(`/access/roles/${id}`, send("PATCH", update)),
  deleteRole: (id: string) => request<void>(`/access/roles/${id}`, send("DELETE")),
  createUser: (user: { email: string; firstName: string; lastName: string; roleId: string }) =>
    request<AccessUser>("/access/users", send("POST", user)),
  updateUser: (
    id: string,
    update: Partial<{
      roleId: string;
      isActive: boolean;
      email: string;
      firstName: string;
      lastName: string;
      grantedPermissions: string[];
      revokedPermissions: string[];
      status: Exclude<UserStatus, "PENDING">;
    }>,
  ) =>
    request<AccessUser>(`/access/users/${id}`, send("PATCH", update)),
  resetPassword: (id: string) =>
    request<{ temporaryPassword: string }>(`/access/users/${id}/reset-password`, send("POST")),
};
