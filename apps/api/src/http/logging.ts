import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { postgresErrorInfo } from "@docket/db";
import type { NextFunction, Request, Response } from "express";

const log = new Logger("HTTP");

function requestPath(req: Request): string {
  const raw = req.originalUrl || req.url || "";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
}

/** One line per request. Never logs bodies, cookies, or tokens. */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on("finish", () => {
    const line = `${req.method} ${requestPath(req)} ${res.statusCode} ${Date.now() - started}ms`;
    if (res.statusCode >= 500) log.error(line);
    else if (res.statusCode >= 400) log.warn(line);
    else log.log(line);
  });
  next();
}

function formatUnknownError(err: unknown): string {
  const pg = postgresErrorInfo(err);
  const message = err instanceof Error ? err.message : String(err);
  if (!pg) return message;
  const bits = [`${message} [${pg.code}]`];
  if (pg.constraint) bits.push(`constraint=${pg.constraint}`);
  if (pg.detail) bits.push(pg.detail);
  return bits.join(" ");
}

/**
 * Logs the real driver/Postgres cause (Drizzle hides it on `cause`) and keeps
 * 500 bodies generic so SQL never reaches the browser.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const where = `${req.method} ${requestPath(req)}`;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= 500) {
        log.error(`${where} ${status} ${exception.message}`, exception.stack);
      }
      res.status(status).json(typeof body === "string" ? { statusCode: status, message: body } : body);
      return;
    }

    log.error(`${where} 500 ${formatUnknownError(exception)}`, exception instanceof Error ? exception.stack : undefined);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: "Internal server error",
    });
  }
}
