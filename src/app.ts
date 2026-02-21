import "./bootstrap";
import "reflect-metadata";
import "express-async-errors";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";

import "./database";
import uploadConfig from "./config/upload";
import AppError from "./errors/AppError";
import routes from "./routes";
import { logger } from "./utils/logger";
import { messageQueue, sendScheduledMessages } from "./queues";
import bodyParser from "body-parser";
// Rate limit geral desabilitado para VPS - todos os clientes compartilham o mesmo IP
// import { generalRateLimit } from "./middleware/rateLimiter";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

// Configurar trust proxy para detectar corretamente o IP do cliente
// quando a aplicação está atrás de um proxy/load balancer
// Usar 1 ao invés de true para evitar warning do express-rate-limit
app.set("trust proxy", 1);

app.set("queues", {
  messageQueue,
  sendScheduledMessages
});

const bodyparser = require("body-parser");
app.use(bodyParser.json({ limit: "10mb" }));

// Configure CORS to allow requests from frontend
const allowedOrigins = [
  "https://www.compuchat.cloud",
  "https://compuchat.cloud",
  "http://localhost:3000",
  "http://localhost:3333"
];

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === "development") {
        callback(null, true);
      } else {
        callback(null, true); // For now, allow all origins - tighten this in production
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    maxAge: 600 // Cache preflight response for 10 minutes
  })
);

// Ensure OPTIONS requests are handled
app.options("*", cors());
app.use(cookieParser());
app.use(express.json());
app.use(Sentry.Handlers.requestHandler());

// Rate limiting geral DESABILITADO para VPS
// Em VPS, todos os clientes compartilham o mesmo IP, então rate limit por IP bloqueia todos os usuários
// Rate limits específicos (auth, import, webhook) continuam ativos nas rotas que precisam
// Para reativar, descomente a linha abaixo e configure DISABLE_RATE_LIMIT_GENERAL=false
// app.use(generalRateLimit);

app.use("/public", express.static(uploadConfig.directory));
app.use(routes);

app.use(Sentry.Handlers.errorHandler());

app.use(async (err: Error, req: Request, res: Response, _: NextFunction) => {
  if (err instanceof AppError) {
    logger.warn(err);
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error(err);
  return res.status(500).json({ error: "ERR_INTERNAL_SERVER_ERROR" });
});

export default app;
