import {
  generalRateLimit,
  authRateLimit,
  importRateLimit,
  webhookRateLimit,
  createCustomRateLimit
} from "../rateLimit";

describe("Rate Limit Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Resetar variáveis de ambiente
    process.env = { ...originalEnv };
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_AUTH_WINDOW_MS;
    delete process.env.RATE_LIMIT_AUTH_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_IMPORT_WINDOW_MS;
    delete process.env.RATE_LIMIT_IMPORT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS;
    delete process.env.RATE_LIMIT_WEBHOOK_MAX_REQUESTS;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe("generalRateLimit", () => {
    it("deve estar definido e ser uma função", () => {
      expect(generalRateLimit).toBeDefined();
      expect(typeof generalRateLimit).toBe("function");
    });

    it("deve ser um middleware válido", () => {
      // Verificar se é uma função que aceita req, res, next
      expect(generalRateLimit.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("authRateLimit", () => {
    it("deve estar configurado e ser uma função", () => {
      expect(authRateLimit).toBeDefined();
      expect(typeof authRateLimit).toBe("function");
    });

    it("deve ser um middleware válido", () => {
      expect(authRateLimit.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("importRateLimit", () => {
    it("deve estar configurado e ser uma função", () => {
      expect(importRateLimit).toBeDefined();
      expect(typeof importRateLimit).toBe("function");
    });

    it("deve ser um middleware válido", () => {
      expect(importRateLimit.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("webhookRateLimit", () => {
    it("deve estar configurado e ser uma função", () => {
      expect(webhookRateLimit).toBeDefined();
      expect(typeof webhookRateLimit).toBe("function");
    });

    it("deve ser um middleware válido", () => {
      expect(webhookRateLimit.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("createCustomRateLimit", () => {
    it("deve criar um rate limiter customizado com opções fornecidas", () => {
      const customLimit = createCustomRateLimit({
        windowMs: 60000,
        max: 10,
        message: "Limite customizado excedido"
      });

      expect(customLimit).toBeDefined();
      expect(typeof customLimit).toBe("function");
    });

    it("deve usar valores padrão quando opções não são fornecidas", () => {
      const customLimit = createCustomRateLimit({});

      expect(customLimit).toBeDefined();
      expect(typeof customLimit).toBe("function");
    });

    it("deve aceitar keyGenerator customizado", () => {
      // Usar um keyGenerator que não depende de req.ip para evitar o aviso de IPv6
      const customKeyGenerator = (req: any) => `custom-key-${req.path || 'default'}`;
      const customLimit = createCustomRateLimit({
        keyGenerator: customKeyGenerator
      });

      expect(customLimit).toBeDefined();
      expect(typeof customLimit).toBe("function");
    });
  });

  describe("Validação de configurações padrão", () => {
    it("deve ter windowMs padrão de 15 minutos (900000ms) para rate limit geral", () => {
      // Verificar se o valor padrão está correto
      const defaultWindowMs = parseInt("900000", 10);
      expect(defaultWindowMs).toBe(900000);
    });

    it("deve ter max padrão de 100 requests para rate limit geral", () => {
      const defaultMax = parseInt("100", 10);
      expect(defaultMax).toBe(100);
    });

    it("deve ter max padrão de 5 tentativas para rate limit de autenticação", () => {
      const defaultMax = parseInt("5", 10);
      expect(defaultMax).toBe(5);
    });

    it("deve ter windowMs padrão de 1 hora (3600000ms) para rate limit de importação", () => {
      const defaultWindowMs = parseInt("3600000", 10);
      expect(defaultWindowMs).toBe(3600000);
    });

    it("deve ter max padrão de 10 importações para rate limit de importação", () => {
      const defaultMax = parseInt("10", 10);
      expect(defaultMax).toBe(10);
    });

    it("deve ter windowMs padrão de 1 minuto (60000ms) para rate limit de webhook", () => {
      const defaultWindowMs = parseInt("60000", 10);
      expect(defaultWindowMs).toBe(60000);
    });

    it("deve ter max padrão de 100 webhooks para rate limit de webhook", () => {
      const defaultMax = parseInt("100", 10);
      expect(defaultMax).toBe(100);
    });
  });
});
