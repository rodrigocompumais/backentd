import {
  generalRateLimit,
  authRateLimit,
  importRateLimit,
  webhookRateLimit,
  createCustomRateLimit
} from "../rateLimiter";

describe("Rate Limiter Middleware", () => {
  describe("Exports", () => {
    it("deve exportar generalRateLimit", () => {
      expect(generalRateLimit).toBeDefined();
      expect(typeof generalRateLimit).toBe("function");
    });

    it("deve exportar authRateLimit", () => {
      expect(authRateLimit).toBeDefined();
      expect(typeof authRateLimit).toBe("function");
    });

    it("deve exportar importRateLimit", () => {
      expect(importRateLimit).toBeDefined();
      expect(typeof importRateLimit).toBe("function");
    });

    it("deve exportar webhookRateLimit", () => {
      expect(webhookRateLimit).toBeDefined();
      expect(typeof webhookRateLimit).toBe("function");
    });

    it("deve exportar createCustomRateLimit", () => {
      expect(createCustomRateLimit).toBeDefined();
      expect(typeof createCustomRateLimit).toBe("function");
    });
  });

  describe("Middleware Functions", () => {
    it("generalRateLimit deve ser uma função middleware", () => {
      expect(generalRateLimit.length).toBeGreaterThanOrEqual(3); // req, res, next
    });

    it("authRateLimit deve ser uma função middleware", () => {
      expect(authRateLimit.length).toBeGreaterThanOrEqual(3);
    });

    it("importRateLimit deve ser uma função middleware", () => {
      expect(importRateLimit.length).toBeGreaterThanOrEqual(3);
    });

    it("webhookRateLimit deve ser uma função middleware", () => {
      expect(webhookRateLimit.length).toBeGreaterThanOrEqual(3);
    });
  });
});
