import gracefulShutdown from "http-graceful-shutdown";
import app from "./app";
import { initIO } from "./libs/socket";
import { logger } from "./utils/logger";
import { StartAllWhatsAppsSessions } from "./services/WbotServices/StartAllWhatsAppsSessions";
import Company from "./models/Company";
import { startQueueProcess } from "./queues";
import { TransferTicketQueue } from "./wbotTransferTicketQueue";
import cron from "node-cron";
import TestAllGeminiApiKeysService from "./services/AiServices/TestAllGeminiApiKeysService";
import RenewSubscriptionService, { findCompaniesNeedingRenewal } from "./services/SubscriptionService/RenewSubscriptionService";
import CheckRemindersService from "./services/ReminderServices/CheckRemindersService";

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

initIO(server);
gracefulShutdown(server);
