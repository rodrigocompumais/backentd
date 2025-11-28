import { isBrazilianNumber, getCountryCode, formatBlockedNumberLog } from "../ValidateBrazilianNumber";

describe("ValidateBrazilianNumber", () => {
  describe("isBrazilianNumber", () => {
    it("deve retornar true para números brasileiros válidos com 13 dígitos", () => {
      expect(isBrazilianNumber("5511999887766")).toBe(true);
      expect(isBrazilianNumber("5521987654321")).toBe(true);
      expect(isBrazilianNumber("5585988776655")).toBe(true);
    });

    it("deve retornar true para números brasileiros válidos com 12 dígitos", () => {
      expect(isBrazilianNumber("551133334444")).toBe(true);
      expect(isBrazilianNumber("552122223333")).toBe(true);
    });

    it("deve retornar true para números brasileiros com formatação", () => {
      expect(isBrazilianNumber("55 11 99988-7766")).toBe(true);
      expect(isBrazilianNumber("+55 (11) 99988-7766")).toBe(true);
      expect(isBrazilianNumber("+55 21 3333-4444")).toBe(true);
    });

    it("deve retornar false para números não-brasileiros", () => {
      expect(isBrazilianNumber("14155551234")).toBe(false); // EUA
      expect(isBrazilianNumber("447700900123")).toBe(false); // Reino Unido
      expect(isBrazilianNumber("5491123456789")).toBe(false); // Argentina
    });

    it("deve retornar false para números muito curtos", () => {
      expect(isBrazilianNumber("5511999")).toBe(false);
      expect(isBrazilianNumber("551199")).toBe(false);
    });

    it("deve retornar false para números muito longos", () => {
      expect(isBrazilianNumber("55119998877665544")).toBe(false);
    });

    it("deve retornar false para números que não começam com 55", () => {
      expect(isBrazilianNumber("5611999887766")).toBe(false);
      expect(isBrazilianNumber("4511999887766")).toBe(false);
    });
  });

  describe("getCountryCode", () => {
    it("deve extrair código de país do Brasil", () => {
      expect(getCountryCode("5511999887766")).toBe("55");
      expect(getCountryCode("55 11 99988-7766")).toBe("55");
    });

    it("deve extrair código de país dos EUA", () => {
      expect(getCountryCode("14155551234")).toBe("1");
    });

    it("deve extrair código de país do Reino Unido", () => {
      expect(getCountryCode("447700900123")).toBe("44");
    });

    it("deve extrair código de país da Argentina", () => {
      expect(getCountryCode("5491123456789")).toBe("54");
    });
  });

  describe("formatBlockedNumberLog", () => {
    it("deve formatar mensagem de log corretamente", () => {
      const message = formatBlockedNumberLog("14155551234", "1");
      expect(message).toContain("Mensagem bloqueada");
      expect(message).toContain("+1");
      expect(message).toContain("14155551234");
    });

    it("deve formatar mensagem para número do Reino Unido", () => {
      const message = formatBlockedNumberLog("447700900123", "44");
      expect(message).toContain("+44");
      expect(message).toContain("447700900123");
    });
  });
});

