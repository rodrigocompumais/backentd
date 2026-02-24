import { logger } from "./logger";

type MetricsRecord = {
  reconnectAttempts: number;
  reconnectSuccess: number;
  sendSuccess: number;
  sendFailures: number;
  connectionClosed: number;
  requestAborted: number;
  closeByStatusCode: Record<string, number>;
  closeByReasonCode: Record<string, number>;
  lastErrorCode?: string;
};

const metrics = new Map<string, MetricsRecord>();

const getKey = (companyId: number, whatsappId: number): string =>
  `${companyId}:${whatsappId}`;

const getRecord = (companyId: number, whatsappId: number): MetricsRecord => {
  const key = getKey(companyId, whatsappId);
  if (!metrics.has(key)) {
    metrics.set(key, {
      reconnectAttempts: 0,
      reconnectSuccess: 0,
      sendSuccess: 0,
      sendFailures: 0,
      connectionClosed: 0,
        requestAborted: 0,
        closeByStatusCode: {},
        closeByReasonCode: {}
    });
  }
  return metrics.get(key)!;
};

export const metricsReconnectAttempt = (companyId: number, whatsappId: number): void => {
  getRecord(companyId, whatsappId).reconnectAttempts += 1;
};

export const metricsReconnectSuccess = (companyId: number, whatsappId: number): void => {
  getRecord(companyId, whatsappId).reconnectSuccess += 1;
};

export const metricsSendSuccess = (companyId: number, whatsappId: number): void => {
  getRecord(companyId, whatsappId).sendSuccess += 1;
};

export const metricsSendFailure = (
  companyId: number,
  whatsappId: number,
  errorCode: string
): void => {
  const record = getRecord(companyId, whatsappId);
  record.sendFailures += 1;
  record.lastErrorCode = errorCode;
  if (errorCode === "ERR_WAPP_CONNECTION_CLOSED") record.connectionClosed += 1;
  if (errorCode === "ERR_REQUEST_ABORTED") record.requestAborted += 1;
};

export const metricsConnectionClose = (
  companyId: number,
  whatsappId: number,
  statusCode?: number,
  reasonCode?: string
): void => {
  const record = getRecord(companyId, whatsappId);
  record.connectionClosed += 1;

  const statusKey = String(statusCode ?? "unknown");
  record.closeByStatusCode[statusKey] = (record.closeByStatusCode[statusKey] || 0) + 1;

  const reasonKey = reasonCode || "unknown";
  record.closeByReasonCode[reasonKey] = (record.closeByReasonCode[reasonKey] || 0) + 1;
};

export const logWbotMetricsSnapshot = (): void => {
  const snapshot = Array.from(metrics.entries()).map(([key, value]) => {
    const [companyId, whatsappId] = key.split(":");
    return {
      companyId: Number(companyId),
      whatsappId: Number(whatsappId),
      ...value
    };
  });

  if (snapshot.length > 0) {
    logger.debug("Wbot metrics snapshot", { snapshot });
  }
};
