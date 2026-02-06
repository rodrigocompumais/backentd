import gracefulShutdown from "http-graceful-shutdown";
import app from "./app";
import { initIO } from "./libs/socket";
import { initPrintWebSocket } from "./libs/printWebSocket";
import { logger } from "./utils/logger";
import { StartAllWhatsAppsSessions } from "./services/WbotServices/StartAllWhatsAppsSessions";
import Company from "./models/Company";
import { startQueueProcess } from "./queues";
import { TransferTicketQueue } from "./wbotTransferTicketQueue";
import cron from "node-cron";
import TestAllGeminiApiKeysService from "./services/AiServices/TestAllGeminiApiKeysService";
import RenewSubscriptionService, { findCompaniesNeedingRenewal } from "./services/SubscriptionService/RenewSubscriptionService";
import CheckRemindersService from "./services/ReminderServices/CheckRemindersService";
import CheckOrderAutoConfirmService from "./services/OrderServices/CheckOrderAutoConfirmService";
import { Op } from "sequelize";
import PrintPedido from "./models/PrintPedido";
import FormResponse from "./models/FormResponse";

const server = app.listen(process.env.PORT, async () => {
  const companies = await Company.findAll();
  const allPromises: any[] = [];
  companies.map(async c => {
    const promise = StartAllWhatsAppsSessions(c.id);
    allPromises.push(promise);
  });

  Promise.all(allPromises).then(() => {
    startQueueProcess();
  });
  
  // Testar chaves da API do Gemini após inicialização
  setTimeout(async () => {
    await TestAllGeminiApiKeysService();
  }, 5000); // Aguardar 5 segundos após o servidor iniciar
  
  logger.info(`Server started on port: ${process.env.PORT}`);
});

cron.schedule("* * * * *", async () => {

  try {
    // console.log("Running a job at 01:00 at America/Sao_Paulo timezone")
    logger.info(`Serviço de transferencia de tickets iniciado`);

    await TransferTicketQueue();
  }
  catch (error) {
    logger.error(error);
  }

});

// Job para verificar e processar renovações de assinaturas
// Roda diariamente às 9h da manhã
cron.schedule("0 9 * * *", async () => {
  try {
    logger.info("Iniciando verificação de renovações de assinaturas...");
    
    const companiesNeedingRenewal = await findCompaniesNeedingRenewal();
    
    logger.info(`Encontradas ${companiesNeedingRenewal.length} empresas que precisam de renovação`);
    
    for (const company of companiesNeedingRenewal) {
      try {
        const result = await RenewSubscriptionService(company.id);
        
        if (result.success) {
          logger.info(`Renovação processada com sucesso para empresa ${company.id} via ${result.method}`);
        } else {
          logger.warn(`Falha ao renovar empresa ${company.id}: ${result.message || result.error}`);
        }
      } catch (error: any) {
        logger.error(`Erro ao processar renovação para empresa ${company.id}:`, error);
        // Continuar com as próximas empresas mesmo se uma falhar
      }
    }
    
    logger.info("Verificação de renovações concluída");
  } catch (error: any) {
    logger.error("Erro no job de renovação de assinaturas:", error);
  }
});

// Job para verificar e enviar lembretes de agendamentos e tarefas
// Roda a cada 1 minuto
cron.schedule("* * * * *", async () => {
  try {
    await CheckRemindersService();
  } catch (error: any) {
    logger.error("Erro ao processar lembretes:", error);
  }
});

// Job para avançar pedidos novo -> confirmado automaticamente
cron.schedule("* * * * *", async () => {
  try {
    await CheckOrderAutoConfirmService();
  } catch (error: any) {
    logger.error("Erro no job de auto-confirmação de pedidos:", error);
  }
});

// Job para reverter jobs de impressão travados (printing há mais de 5 min)
cron.schedule("* * * * *", async () => {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const [affected] = await PrintPedido.update(
      { status: "pending" },
      {
        where: {
          status: "printing",
          updatedAt: { [Op.lt]: fiveMinAgo }
        }
      }
    );
    if (affected > 0) {
      logger.info(`Reverted ${affected} stuck print job(s) to pending`);
    }
  } catch (error: any) {
    logger.error("Erro ao reverter jobs de impressão travados:", error);
  }
});

// Cleanup de jobs expirados (done/error com mais de 24h)
cron.schedule("0 2 * * *", async () => {
  try {
    const result = await PrintPedido.destroy({
      where: {
        status: { [Op.in]: ["done", "error"] },
        expiresAt: { [Op.lt]: new Date() }
      }
    });
    if (result > 0) {
      logger.info(`Cleaned up ${result} expired print job(s)`);
    }
  } catch (error: any) {
    logger.error("Erro no cleanup de jobs de impressão:", error);
  }
});

// Cleanup de respostas/pedidos de formulário com mais de 24h
cron.schedule("0 3 * * *", async () => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await FormResponse.destroy({
      where: { submittedAt: { [Op.lt]: cutoff } }
    });
    if (result > 0) {
      logger.info(`Removidas ${result} resposta(s) de formulário com mais de 24h`);
    }
  } catch (error: any) {
    logger.error("Erro no cleanup de respostas de formulário:", error);
  }
});

initIO(server);
initPrintWebSocket(server);
gracefulShutdown(server);
