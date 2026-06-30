import { HttpError } from "./transport.js";

export function isHttpErrorCode(error: unknown, code: string): error is HttpError & { code: string } {
  return error instanceof HttpError && error.code === code;
}
