import { processPayment, createCardToken, translateMercadoPagoError } from "./MercadoPagoService";
import AppError from "../../errors/AppError";
import { Payment } from "mercadopago";

// Mock do Mercado Pago
jest.mock("mercadopago", () => ({
  MercadoPagoConfig: jest.fn(),
  Payment: jest.fn(),
  Preference: jest.fn(),
}));

// Mock do logger
jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe("MercadoPagoService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Configurar variáveis de ambiente
    process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST_123456789";
    process.env.NODE_ENV = "test";
  });

  describe("processPayment", () => {
    const mockPaymentData = {
      transactionAmount: 100,
      description: "Teste",
      paymentMethodId: "visa",
      token: "test_token_123",
      installments: 1,
      identificationType: "CPF",
      identificationNumber: "12345678909",
      payer: {
        email: "teste@teste.com",
        firstName: "Teste",
        lastName: "Usuario",
      },
    };

    it("deve processar pagamento com sucesso", async () => {
      // Arrange
      const mockPaymentInstance = {
        create: jest.fn().mockResolvedValue({
          id: "payment_123",
          status: "approved",
          status_detail: "accredited",
          transaction_amount: 100,
          date_created: new Date(),
          date_approved: new Date(),
        }),
      };
      (Payment as jest.Mock).mockImplementation(() => mockPaymentInstance);

      // Act
      const result = await processPayment(mockPaymentData);

      // Assert
      expect(result.status).toBe("approved");
      expect(result.id).toBe("payment_123");
      expect(mockPaymentInstance.create).toHaveBeenCalled();
    });

    it("deve validar token vazio", async () => {
      // Arrange
      const invalidPaymentData = {
        ...mockPaymentData,
        token: "",
      };

      // Act & Assert
      await expect(processPayment(invalidPaymentData)).rejects.toThrow(AppError);
    });

    it("deve validar paymentMethodId vazio", async () => {
      // Arrange
      const invalidPaymentData = {
        ...mockPaymentData,
        paymentMethodId: "",
      };

      // Act & Assert
      await expect(processPayment(invalidPaymentData)).rejects.toThrow(AppError);
    });

    it("deve traduzir erro 'Unauthorized use of live credentials'", async () => {
      // Arrange
      const mockPaymentInstance = {
        create: jest.fn().mockRejectedValue({
          message: "Unauthorized use of live credentials",
          cause: [],
        }),
      };
      (Payment as jest.Mock).mockImplementation(() => mockPaymentInstance);

      // Act & Assert
      await expect(processPayment(mockPaymentData)).rejects.toThrow(
        "Erro de configuração do pagamento"
      );
    });

    it("deve traduzir erro 'Bin not found'", async () => {
      // Arrange
      const mockPaymentInstance = {
        create: jest.fn().mockRejectedValue({
          message: "Bin not found",
          cause: [],
        }),
      };
      (Payment as jest.Mock).mockImplementation(() => mockPaymentInstance);

      // Act & Assert
      await expect(processPayment(mockPaymentData)).rejects.toThrow(
        "Não foi possível identificar o cartão"
      );
    });
  });

  describe("createCardToken", () => {
    const mockCardData = {
      cardNumber: "4509535666233704",
      cardholderName: "Teste Usuario",
      expirationMonth: "12",
      expirationYear: "25",
      securityCode: "123",
      identificationType: "CPF",
      identificationNumber: "12345678909",
    };

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    it("deve criar token com sucesso", async () => {
      // Arrange
      const mockTokenResponse = {
        id: "token_123",
        first_six_digits: "450953",
        last_four_digits: "3704",
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockTokenResponse),
      });

      // Act
      const { createCardToken } = require("./MercadoPagoService");
      const result = await createCardToken(mockCardData);

      // Assert
      expect(result.id).toBe("token_123");
      expect(global.fetch).toHaveBeenCalled();
    });

    it("deve validar número do cartão inválido", async () => {
      // Arrange
      const invalidCardData = {
        ...mockCardData,
        cardNumber: "123", // Muito curto
      };

      // Act & Assert
      const { createCardToken } = require("./MercadoPagoService");
      await expect(createCardToken(invalidCardData)).rejects.toThrow(
        "Número do cartão inválido"
      );
    });

    it("deve validar nome do titular vazio", async () => {
      // Arrange
      const invalidCardData = {
        ...mockCardData,
        cardholderName: "",
      };

      // Act & Assert
      const { createCardToken } = require("./MercadoPagoService");
      await expect(createCardToken(invalidCardData)).rejects.toThrow(
        "Nome do titular inválido"
      );
    });

    it("deve validar CVV inválido", async () => {
      // Arrange
      const invalidCardData = {
        ...mockCardData,
        securityCode: "12", // Muito curto
      };

      // Act & Assert
      const { createCardToken } = require("./MercadoPagoService");
      await expect(createCardToken(invalidCardData)).rejects.toThrow(
        "Código de segurança"
      );
    });
  });

  describe("translateMercadoPagoError", () => {
    it("deve traduzir 'Unauthorized use of live credentials'", () => {
      const error = { message: "Unauthorized use of live credentials" };
      const { translateMercadoPagoError } = require("./MercadoPagoService");
      const result = translateMercadoPagoError(error);
      expect(result).toContain("Erro de configuração");
    });

    it("deve traduzir 'Bin not found'", () => {
      const error = { message: "Bin not found" };
      const { translateMercadoPagoError } = require("./MercadoPagoService");
      const result = translateMercadoPagoError(error);
      expect(result).toContain("Não foi possível identificar o cartão");
    });

    it("deve retornar mensagem genérica para erro desconhecido", () => {
      const error = { message: "Erro desconhecido" };
      const { translateMercadoPagoError } = require("./MercadoPagoService");
      const result = translateMercadoPagoError(error);
      expect(result).toContain("Erro ao processar pagamento");
    });
  });
});

