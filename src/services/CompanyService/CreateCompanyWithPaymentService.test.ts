import CreateCompanyWithPaymentService from "./CreateCompanyWithPaymentService";
import { processPayment } from "../PaymentService/MercadoPagoService";
import Company from "../../models/Company";
import Plan from "../../models/Plan";
import User from "../../models/User";
import Invoices from "../../models/Invoices";
import sequelize from "../../database";
import AppError from "../../errors/AppError";

// Mock das dependências
jest.mock("../PaymentService/MercadoPagoService");
jest.mock("../../models/Company");
jest.mock("../../models/Plan");
jest.mock("../../models/User");
jest.mock("../../models/Invoices");
jest.mock("../../models/Setting");
jest.mock("../../database");
jest.mock("../../libs/socket");

describe("CreateCompanyWithPaymentService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockCompanyData = {
    name: "Empresa Teste",
    email: "teste@teste.com",
    phone: "(34) 99999-9999",
    password: "123456",
    planId: 1,
    campaignsEnabled: true,
    recurrence: "MENSAL",
  };

  const mockPaymentData = {
    transactionAmount: 100,
    paymentMethodId: "visa",
    token: "test_token_123",
    installments: 1,
    identificationType: "CPF",
    identificationNumber: "12345678909",
    payer: {
      email: "teste@teste.com",
      firstName: "Teste",
      lastName: "Empresa",
    },
    issuerId: "",
  };

  const mockPlan = {
    id: 1,
    name: "Plano Teste",
    value: 100,
  };

  const mockPaymentResult = {
    id: "payment_123",
    status: "approved",
    statusDetail: "accredited",
    transactionAmount: 100,
    dateCreated: new Date(),
    dateApproved: new Date(),
  };

  it("deve criar empresa com pagamento aprovado", async () => {
    // Arrange
    (Plan.findByPk as jest.Mock).mockResolvedValue(mockPlan);
    (Company.findOne as jest.Mock).mockResolvedValue(null);
    (processPayment as jest.Mock).mockResolvedValue(mockPaymentResult);
    
    const mockTransaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    (sequelize.transaction as jest.Mock).mockResolvedValue(mockTransaction);

    const mockCompany = {
      id: 1,
      name: mockCompanyData.name,
      email: mockCompanyData.email,
      update: jest.fn().mockResolvedValue(undefined),
    };
    (Company.create as jest.Mock).mockResolvedValue(mockCompany);
    (User.create as jest.Mock).mockResolvedValue({});
    (Invoices.create as jest.Mock).mockResolvedValue({ id: 1 });

    // Act
    const result = await CreateCompanyWithPaymentService({
      companyData: mockCompanyData,
      paymentData: mockPaymentData,
    });

    // Assert
    expect(processPayment).toHaveBeenCalled();
    expect(Company.create).toHaveBeenCalled();
    expect(mockTransaction.commit).toHaveBeenCalled();
    expect(result.company).toBeDefined();
    expect(result.payment.status).toBe("approved");
  });

  it("não deve criar empresa se pagamento for rejeitado", async () => {
    // Arrange
    (Plan.findByPk as jest.Mock).mockResolvedValue(mockPlan);
    (Company.findOne as jest.Mock).mockResolvedValue(null);
    
    const rejectedPayment = {
      ...mockPaymentResult,
      status: "rejected",
      statusDetail: "cc_rejected_insufficient_amount",
    };
    (processPayment as jest.Mock).mockResolvedValue(rejectedPayment);

    // Act & Assert
    await expect(
      CreateCompanyWithPaymentService({
        companyData: mockCompanyData,
        paymentData: mockPaymentData,
      })
    ).rejects.toThrow(AppError);

    expect(Company.create).not.toHaveBeenCalled();
  });

  it("não deve criar empresa se pagamento falhar", async () => {
    // Arrange
    (Plan.findByPk as jest.Mock).mockResolvedValue(mockPlan);
    (Company.findOne as jest.Mock).mockResolvedValue(null);
    (processPayment as jest.Mock).mockRejectedValue(
      new AppError("Erro ao processar pagamento", 400)
    );

    // Act & Assert
    await expect(
      CreateCompanyWithPaymentService({
        companyData: mockCompanyData,
        paymentData: mockPaymentData,
      })
    ).rejects.toThrow(AppError);

    expect(Company.create).not.toHaveBeenCalled();
  });

  it("deve validar se plano existe", async () => {
    // Arrange
    (Plan.findByPk as jest.Mock).mockResolvedValue(null);

    // Act & Assert
    await expect(
      CreateCompanyWithPaymentService({
        companyData: mockCompanyData,
        paymentData: mockPaymentData,
      })
    ).rejects.toThrow("Plano não encontrado");
  });

  it("deve validar se valor do pagamento corresponde ao plano", async () => {
    // Arrange
    (Plan.findByPk as jest.Mock).mockResolvedValue(mockPlan);
    const wrongAmountPayment = {
      ...mockPaymentData,
      transactionAmount: 200, // Valor diferente do plano
    };

    // Act & Assert
    await expect(
      CreateCompanyWithPaymentService({
        companyData: mockCompanyData,
        paymentData: wrongAmountPayment,
      })
    ).rejects.toThrow("Valor do pagamento não corresponde ao valor do plano");
  });

  it("não deve criar empresa se já existir com mesmo email ou nome", async () => {
    // Arrange
    (Plan.findByPk as jest.Mock).mockResolvedValue(mockPlan);
    (Company.findOne as jest.Mock).mockResolvedValue({ id: 1, name: "Empresa Existente" });

    // Act & Assert
    await expect(
      CreateCompanyWithPaymentService({
        companyData: mockCompanyData,
        paymentData: mockPaymentData,
      })
    ).rejects.toThrow("Já existe uma empresa com este email ou nome");
  });

  it("deve fazer rollback se houver erro após criar empresa", async () => {
    // Arrange
    (Plan.findByPk as jest.Mock).mockResolvedValue(mockPlan);
    (Company.findOne as jest.Mock).mockResolvedValue(null);
    (processPayment as jest.Mock).mockResolvedValue(mockPaymentResult);
    
    const mockTransaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    (sequelize.transaction as jest.Mock).mockResolvedValue(mockTransaction);

    const mockCompany = {
      id: 1,
      name: mockCompanyData.name,
      email: mockCompanyData.email,
    };
    (Company.create as jest.Mock).mockResolvedValue(mockCompany);
    (User.create as jest.Mock).mockRejectedValue(new Error("Erro ao criar usuário"));

    // Act & Assert
    await expect(
      CreateCompanyWithPaymentService({
        companyData: mockCompanyData,
        paymentData: mockPaymentData,
      })
    ).rejects.toThrow();

    expect(mockTransaction.rollback).toHaveBeenCalled();
  });
});

