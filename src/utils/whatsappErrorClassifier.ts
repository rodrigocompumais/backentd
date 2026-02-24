import AppError from "../errors/AppError";

export type WhatsAppErrorKind =
  | "connection_closed"
  | "logged_out"
  | "request_aborted"
  | "rate_limited"
  | "not_initialized"
  | "unknown";

export interface ClassifiedWhatsAppError {
  kind: WhatsAppErrorKind;
  statusCode: number;
  retryable: boolean;
  code: string;
  message: string;
}

export const classifyWhatsAppError = (error: any): ClassifiedWhatsAppError => {
  const message = error?.message || "Unknown error";
  const statusCode =
    error?.statusCode ||
    error?.output?.statusCode ||
    error?.output?.payload?.statusCode ||
    500;

  if (
    message === "Connection Closed" ||
    error?.output?.payload?.message === "Connection Closed" ||
    statusCode === 428
  ) {
    return {
      kind: "connection_closed",
      statusCode: 428,
      retryable: true,
      code: "ERR_WAPP_CONNECTION_CLOSED",
      message: "Connection Closed"
    };
  }

  if (statusCode === 401 || statusCode === 403 || message.includes("logged out")) {
    return {
      kind: "logged_out",
      statusCode: 401,
      retryable: false,
      code: "ERR_WAPP_LOGGED_OUT",
      message
    };
  }

  if (
    message === "terminated" ||
    error?.name === "AbortError" ||
    error?.code === "ECONNABORTED"
  ) {
    return {
      kind: "request_aborted",
      statusCode: 499,
      retryable: true,
      code: "ERR_REQUEST_ABORTED",
      message
    };
  }

  if (statusCode === 429) {
    return {
      kind: "rate_limited",
      statusCode: 429,
      retryable: true,
      code: "ERR_WAPP_RATE_LIMIT",
      message
    };
  }

  if (
    message === "ERR_WAPP_NOT_INITIALIZED" ||
    error?.message === "ERR_WAPP_NOT_INITIALIZED"
  ) {
    return {
      kind: "not_initialized",
      statusCode: 428,
      retryable: true,
      code: "ERR_WAPP_NOT_INITIALIZED",
      message
    };
  }

  return {
    kind: "unknown",
    statusCode,
    retryable: false,
    code: "ERR_WAPP_UNKNOWN",
    message
  };
};

export const toAppError = (classification: ClassifiedWhatsAppError): AppError => {
  return new AppError(classification.code, classification.statusCode);
};
