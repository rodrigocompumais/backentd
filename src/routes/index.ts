import { Router } from "express";

// ============================================
// Autenticação e Usuários
// ============================================
import authRoutes from "./authRoutes";
import userRoutes from "./userRoutes";
import forgotsRoutes from "./forgotPasswordRoutes";

// ============================================
// Contatos e Listas
// ============================================
import contactRoutes from "./contactRoutes";
import contactListRoutes from "./contactListRoutes";
import contactListItemRoutes from "./contactListItemRoutes";

// ============================================
// Tickets e Atendimento
// ============================================
import ticketRoutes from "./ticketRoutes";
import ticketNoteRoutes from "./ticketNoteRoutes";
import ticketTagRoutes from "./ticketTagRoutes";
import queueRoutes from "./queueRoutes";
import queueOptionRoutes from "./queueOptionRoutes";
import queueIntegrationRoutes from "./queueIntegrationRoutes";

// ============================================
// Mensagens e Chat
// ============================================
import messageRoutes from "./messageRoutes";
import chatRoutes from "./chatRoutes";
import whatsappRoutes from "./whatsappRoutes";
import whatsappSessionRoutes from "./whatsappSessionRoutes";
import instagramRoutes from "./instagramRoutes";

// ============================================
// Campanhas e Fluxos
// ============================================
import campaignRoutes from "./campaignRoutes";
import campaignSettingRoutes from "./campaignSettingRoutes";
import flowDefaultRoutes from "./flowDefaultRoutes";
import flowBuilder from "./flowBuilderRoutes";
import flowCampaignRoutes from "./flowCampaignRoutes";

// ============================================
// Arquivos e Uploads
// ============================================
import filesRoutes from "./filesRoutes";
import formRoutes from "./formRoutes";

// ============================================
// Pagamentos e Webhooks
// ============================================
import mercadoPagoRoutes from "./mercadoPagoRoutes";
import gupshupWebhookRoutes from "./gupshupWebhookRoutes";
import gupshupValidationRoutes from "./gupshupValidationRoutes";
import invoiceRoutes from "./invoicesRoutes";
import subscriptionRoutes from "./subScriptionRoutes";

// ============================================
// Configurações e Sistema
// ============================================
import settingRoutes from "./settingRoutes";
import companyRoutes from "./companyRoutes";
import companyModuleRoutes from "./companyModuleRoutes";
import planRoutes from "./planRoutes";
import moduleRoutes from "./moduleRoutes";

// ============================================
// Recursos Adicionais
// ============================================
import aiRoutes from "./aiRoutes";
import helpRoutes from "./helpRoutes";
import helpArticleRoutes from "./helpArticleRoutes";
import dashboardRoutes from "./dashboardRoutes";
import scheduleRoutes from "./scheduleRoutes";
import tagRoutes from "./tagRoutes";
import quickMessageRoutes from "./quickMessageRoutes";
import taskRoutes from "./taskRoutes";
import promptRoutes from "./promptRouter";
import announcementRoutes from "./announcementRoutes";
import translationRoutes from "./translationRoutes";
import customProposalRoutes from "./customProposalRoutes";
import userQuickButtonRoutes from "./userQuickButtonRoutes";
import userAppointmentRoutes from "./userAppointmentRoutes";
import productRoutes from "./productRoutes";
import mesaRoutes from "./mesaRoutes";
import printDeviceRoutes from "./printDeviceRoutes";
import deliveryRoutes from "./deliveryRoutes";
import appointmentServiceRoutes from "./appointmentServiceRoutes";
import appointmentRoutes from "./appointmentRoutes";

const routes = Router();

// ============================================
// Autenticação e Usuários
// ============================================
routes.use("/auth", authRoutes);
routes.use(userRoutes);
routes.use(forgotsRoutes);

// ============================================
// Contatos e Listas
// ============================================
routes.use(contactRoutes);
routes.use(contactListRoutes);
routes.use(contactListItemRoutes);

// ============================================
// Tickets e Atendimento
// ============================================
routes.use(ticketRoutes);
routes.use(ticketNoteRoutes);
routes.use(ticketTagRoutes);
routes.use(queueRoutes);
routes.use(queueOptionRoutes);
routes.use(queueIntegrationRoutes);

// ============================================
// Mensagens e Chat
// ============================================
routes.use(messageRoutes);
routes.use(chatRoutes);
routes.use(whatsappRoutes);
routes.use(whatsappSessionRoutes);
routes.use(instagramRoutes);

// ============================================
// Campanhas e Fluxos
// ============================================
routes.use(campaignRoutes);
routes.use(campaignSettingRoutes);
routes.use(flowDefaultRoutes);
routes.use(flowBuilder);
routes.use(flowCampaignRoutes);

// ============================================
// Arquivos e Uploads
// ============================================
routes.use(filesRoutes);
routes.use(formRoutes);

// ============================================
// Pagamentos e Webhooks
// ============================================
routes.use(mercadoPagoRoutes);
routes.use(gupshupWebhookRoutes);
routes.use(gupshupValidationRoutes);
routes.use(invoiceRoutes);
routes.use(subscriptionRoutes);

// ============================================
// Configurações e Sistema
// ============================================
routes.use(settingRoutes);
routes.use(companyRoutes);
routes.use(companyModuleRoutes);
routes.use(planRoutes);
routes.use(moduleRoutes);

// ============================================
// Recursos Adicionais
// ============================================
routes.use(aiRoutes);
routes.use(helpRoutes);
routes.use(helpArticleRoutes);
routes.use(dashboardRoutes);
routes.use(scheduleRoutes);
routes.use(tagRoutes);
routes.use(quickMessageRoutes);
routes.use(taskRoutes);
routes.use(promptRoutes);
routes.use(announcementRoutes);
routes.use(translationRoutes);
routes.use(customProposalRoutes);
routes.use(userQuickButtonRoutes);
routes.use(userAppointmentRoutes);
routes.use(productRoutes);
routes.use(mesaRoutes);
routes.use(printDeviceRoutes);
routes.use(deliveryRoutes);
routes.use(appointmentServiceRoutes);
routes.use(appointmentRoutes);

export default routes;
