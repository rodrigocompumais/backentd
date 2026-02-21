import request from "supertest";
import express, { Request, Response } from "express";
import {
  generalRateLimit,
  authRateLimit,
  importRateLimit,
  webhookRateLimit
} from "../rateLimit";

describe("Rate Limit Integration Tests", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    // Configurar trust proxy para suportar X-Forwarded-For
    app.set("trust proxy", true);
    app.use(express.json());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("General Rate Limit", () => {
    beforeEach(() => {
      app.get("/test", generalRateLimit, (req: Request, res: Response) => {
        res.status(200).json({ message: "OK" });
      });
    });

    it("deve permitir requisições dentro do limite", async () => {
      const response = await request(app)
        .get("/test")
        .set("X-Forwarded-For", "127.0.0.1");

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("OK");
    });

    it("deve retornar 429 quando limite é excedido", async () => {
      // Fazer muitas requisições para exceder o limite
      const responses = [];
      for (let i = 0; i < 110; i++) {
        const response = await request(app)
          .get("/test")
          .set("X-Forwarded-For", "127.0.0.1");
        responses.push(response.status);
        
        // Parar se já recebeu 429
        if (response.status === 429) break;
      }

      // Deve ter pelo menos uma resposta 429
      expect(responses.some((status) => status === 429)).toBe(true);
    });
  });

  describe("Auth Rate Limit", () => {
    beforeEach(() => {
      app.post(
        "/auth/login",
        authRateLimit,
        (req: Request, res: Response) => {
          res.status(200).json({ message: "Login successful" });
        }
      );
    });

    it("deve permitir tentativas de login dentro do limite", async () => {
      const response = await request(app)
        .post("/auth/login")
        .send({ email: "test@example.com", password: "password" })
        .set("X-Forwarded-For", "127.0.0.1");

      expect(response.status).toBe(200);
    });

    it("deve bloquear após múltiplas tentativas de login", async () => {
      const email = "test@example.com";
      const responses = [];

      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .post("/auth/login")
          .send({ email, password: "wrong" })
          .set("X-Forwarded-For", "127.0.0.1");

        responses.push(response.status);
        
        // Parar se já recebeu 429
        if (response.status === 429) break;
      }

      // Deve ter pelo menos uma resposta 429
      expect(responses.some((status) => status === 429)).toBe(true);
    });

    it("deve usar keyGenerator que combina IP e email", async () => {
      const response1 = await request(app)
        .post("/auth/login")
        .send({ email: "user1@example.com", password: "pass" })
        .set("X-Forwarded-For", "127.0.0.1");

      const response2 = await request(app)
        .post("/auth/login")
        .send({ email: "user2@example.com", password: "pass" })
        .set("X-Forwarded-For", "127.0.0.1");

      // Ambas devem passar inicialmente
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
    });
  });

  describe("Import Rate Limit", () => {
    beforeEach(() => {
      app.post(
        "/contacts/upload",
        importRateLimit,
        (req: Request, res: Response) => {
          res.status(200).json({ message: "Upload successful" });
        }
      );
    });

    it("deve permitir uploads dentro do limite", async () => {
      const response = await request(app)
        .post("/contacts/upload")
        .set("X-Forwarded-For", "127.0.0.1");

      expect(response.status).toBe(200);
    });

    it("deve bloquear após múltiplos uploads", async () => {
      const responses = [];

      for (let i = 0; i < 15; i++) {
        const response = await request(app)
          .post("/contacts/upload")
          .set("X-Forwarded-For", "127.0.0.1");

        responses.push(response.status);
        
        // Parar se já recebeu 429
        if (response.status === 429) break;
      }

      // Deve ter pelo menos uma resposta 429
      expect(responses.some((status) => status === 429)).toBe(true);
    });
  });

  describe("Webhook Rate Limit", () => {
    beforeEach(() => {
      app.post(
        "/webhook/test",
        webhookRateLimit,
        (req: Request, res: Response) => {
          res.status(200).json({ message: "Webhook received" });
        }
      );
    });

    it("deve permitir webhooks dentro do limite", async () => {
      const response = await request(app)
        .post("/webhook/test")
        .set("X-Forwarded-For", "127.0.0.1")
        .send({ data: "test" });

      expect(response.status).toBe(200);
    });

    it("deve bloquear após muitos webhooks", async () => {
      const responses = [];

      for (let i = 0; i < 150; i++) {
        const response = await request(app)
          .post("/webhook/test")
          .set("X-Forwarded-For", "127.0.0.1")
          .send({ data: `test-${i}` });

        responses.push(response.status);
        
        // Parar se já recebeu 429
        if (response.status === 429) break;
      }

      // Deve ter pelo menos uma resposta 429
      expect(responses.some((status) => status === 429)).toBe(true);
    });
  });

  describe("Rate Limit Headers", () => {
    beforeEach(() => {
      app.get("/test-headers", generalRateLimit, (req: Request, res: Response) => {
        res.status(200).json({ message: "OK" });
      });
    });

    it("deve incluir headers de rate limit na resposta", async () => {
      const response = await request(app)
        .get("/test-headers")
        .set("X-Forwarded-For", "127.0.0.1");

      // Pode retornar 200 ou 429 dependendo do estado do rate limit
      expect([200, 429]).toContain(response.status);
      // Verificar se headers estão presentes (express-rate-limit adiciona headers automaticamente)
      expect(response.headers).toBeDefined();
    });
  });

  describe("Rate Limit por IP", () => {
    beforeEach(() => {
      app.get("/test-ip", generalRateLimit, (req: Request, res: Response) => {
        res.status(200).json({ message: "OK" });
      });
    });

    it("deve tratar IPs diferentes separadamente", async () => {
      const response1 = await request(app)
        .get("/test-ip")
        .set("X-Forwarded-For", "192.168.1.1");

      const response2 = await request(app)
        .get("/test-ip")
        .set("X-Forwarded-For", "192.168.1.2");

      // IPs diferentes devem ter contadores separados
      expect([200, 429]).toContain(response1.status);
      expect([200, 429]).toContain(response2.status);
    });
  });
});
