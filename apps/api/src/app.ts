import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./lib/http.js";
import { requireAuth } from "./middleware/auth.js";
import { accessRouter } from "./routes/access.js";
import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { metaRouter } from "./routes/meta.js";
import { notificationsRouter } from "./routes/notifications.js";
import { tasksRouter } from "./routes/tasks.js";

export const app = express();

app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/api/health", (_request, response) => {
  response.status(200).json({
    success: true,
    data: { status: "ok" },
  });
});

app.use("/api/auth", authRouter);
app.use("/api/meta", requireAuth, metaRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/tasks", requireAuth, tasksRouter);
app.use("/api/clients", requireAuth, clientsRouter);
app.use("/api/notifications", requireAuth, notificationsRouter);
app.use("/api/access", requireAuth, accessRouter);

app.use(errorHandler);
