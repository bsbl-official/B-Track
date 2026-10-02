import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Express 4 does not forward rejected promises to the error handler on its own.
export function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (request, response, next) => {
    handler(request, response, next).catch(next);
  };
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({ success: false, error: { message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    // Lead with the first specific problem (e.g. "Use at least 8 characters").
    response.status(400).json({
      success: false,
      error: { message: error.issues[0]?.message ?? "Invalid request", issues: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) },
    });
    return;
  }
  // Body-parser errors (e.g. an upload over the size limit) carry their own status.
  if (error?.type === "entity.too.large") {
    response.status(413).json({ success: false, error: { message: "The file is too large (10 MB max)" } });
    return;
  }
  if (typeof error?.status === "number" && error.status >= 400 && error.status < 500 && error.expose) {
    response.status(error.status).json({ success: false, error: { message: error.message } });
    return;
  }
  console.error(error);
  response.status(500).json({ success: false, error: { message: "Internal server error" } });
};
