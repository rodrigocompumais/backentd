import { Server as HttpServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { Op } from "sequelize";
import PrintDevice from "../models/PrintDevice";
import PrintPedido from "../models/PrintPedido";
import { logger } from "../utils/logger";
import HandlePrintJobAckService from "../services/PrintJobService/HandlePrintJobAckService";
import { dispatchJob } from "../services/PrintJobService/CreateAndDispatchPrintJobService";

interface ConnectionInfo {
  ws: WebSocket;
  companyId: number;
  deviceId: string;
}

const WS_PATH = "/ws/print";
const connections = new Map<string, ConnectionInfo>();

function getConnectionKey(companyId: number, deviceId: string): string {
  return `${companyId}:${deviceId}`;
}

function extractAuthFromRequest(request: import("http").IncomingMessage): {
  token: string | null;
  deviceId: string | null;
} {
  const authHeader = request.headers["authorization"];
  const deviceIdHeader = request.headers["x-device-id"];

  let token: string | null = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }

  const deviceId =
    typeof deviceIdHeader === "string" ? deviceIdHeader.trim() : null;

  return { token, deviceId };
}

export function initPrintWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket, request, connectionInfo: ConnectionInfo) => {
    const { companyId, deviceId } = connectionInfo;
    const key = getConnectionKey(companyId, deviceId);

    logger.info(
      `Print agent connected: companyId=${companyId} deviceId=${deviceId}`
    );

    // Dispatch pending jobs for this device
    PrintPedido.findAll({
      where: {
        companyId,
        deviceId,
        status: { [Op.in]: ["pending", "printing"] },
        expiresAt: { [Op.gt]: new Date() }
      },
      order: [["createdAt", "ASC"]]
    }).then((jobs) => {
      jobs.forEach((job) => {
        if (job.status === "printing") {
          job.update({ status: "pending" }).then(() => dispatchJob(job));
        } else {
          dispatchJob(job);
        }
      });
    }).catch((err) => {
      logger.error("Error dispatching pending jobs on connect:", err?.message);
    });

    ws.send(
      JSON.stringify({
        event: "ready",
        message: "Connected successfully"
      })
    );

    ws.on("message", async (data: WebSocket.Data) => {
      try {
        const raw = data.toString();
        const msg = JSON.parse(raw);

        if (msg.event === "ack") {
          const jobId = msg.job_id;
          const status = msg.status;
          const message = msg.message;

          if (!jobId || !status) {
            logger.warn("Invalid ack received: missing job_id or status");
            return;
          }

          await HandlePrintJobAckService({
            jobId,
            status,
            message,
            companyId,
            deviceId
          });
        }
      } catch (err: any) {
        logger.error("Error processing WebSocket message:", err?.message);
      }
    });

    ws.on("close", () => {
      if (connections.get(key)?.ws === ws) {
        connections.delete(key);
      }
      logger.info(
        `Print agent disconnected: companyId=${companyId} deviceId=${deviceId}`
      );
    });

    ws.on("error", (err) => {
      logger.error(
        `Print WebSocket error companyId=${companyId} deviceId=${deviceId}:`,
        err?.message
      );
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = request.url?.split("?")[0];
    if (pathname !== WS_PATH) {
      return;
    }

    const { token, deviceId } = extractAuthFromRequest(request);

    if (!token || !deviceId) {
      logger.warn("Print WS upgrade rejected: missing token or X-Device-Id");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    PrintDevice.findOne({
      where: { token, deviceId }
    })
      .then((device) => {
        if (!device) {
          logger.warn("Print WS upgrade rejected: invalid token or deviceId");
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        const key = getConnectionKey(device.companyId, device.deviceId);
        const existing = connections.get(key);
        if (existing && existing.ws.readyState === WebSocket.OPEN) {
          existing.ws.close();
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          const connInfo: ConnectionInfo = {
            ws,
            companyId: device.companyId,
            deviceId: device.deviceId
          };
          connections.set(key, connInfo);
          wss.emit("connection", ws, request, connInfo);
        });
      })
      .catch((err) => {
        logger.error("Print WS auth error:", err?.message);
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      });
  });

  logger.info(`Print WebSocket server listening on path ${WS_PATH}`);
}

export function sendPrintJob(
  companyId: number,
  deviceId: string,
  job: { id: number; conteudo: object }
): boolean {
  const key = getConnectionKey(companyId, deviceId);
  const conn = connections.get(key);

  if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    conn.ws.send(
      JSON.stringify({
        event: "print_job",
        job_id: job.id,
        conteudo: job.conteudo
      })
    );
    return true;
  } catch (err) {
    logger.error("Error sending print job via WebSocket:", err);
    return false;
  }
}

export function isAgentConnected(companyId: number, deviceId: string): boolean {
  const key = getConnectionKey(companyId, deviceId);
  const conn = connections.get(key);
  return !!conn && conn.ws.readyState === WebSocket.OPEN;
}
