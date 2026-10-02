import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { join, resolve } from "node:path";
import { env } from "./config/env.js";
import { errorHandler, HttpError } from "./lib/http.js";
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

app.use("/api", (_request, _response, next) => next(new HttpError(404, "Not found")));

// In production the API also serves the built web app, so the site and the API share one origin
// (and the session cookie stays first-party). Locally, Vite serves the web app instead.
if (env.NODE_ENV === "production") {
  const webDist = resolve(import.meta.dirname, "../../web/dist");
  app.use(express.static(webDist, { index: false, maxAge: "1h" }));
  app.get("*", (_request, response) => response.sendFile(join(webDist, "index.html")));
}

app.use(errorHandler);
