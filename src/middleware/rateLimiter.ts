import { Request, Response, NextFunction } from "express";
import { createCustomRateLimit as createConfiguredCustomRateLimit } from "../config/rateLimit";

/**
 * Hotfix operacional:
 * Desabilita TODOS os rate limits das rotas de forma centralizada.
 * Mantém as assinaturas para não quebrar imports/rotas existentes.
 *
 * Para reativar no futuro, basta voltar a exportar diretamente de ../config/rateLimit
 * ou aplicar uma flag dedicada de rollout.
 */
const noOpRateLimit = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};

export const generalRateLimit = noOpRateLimit;
export const authRateLimit = noOpRateLimit;
export const importRateLimit = noOpRateLimit;
export const webhookRateLimit = noOpRateLimit;

// Mantém função disponível; retorna middleware sem bloqueio para qualquer configuração.
export const createCustomRateLimit = (_options?: Parameters<typeof createConfiguredCustomRateLimit>[0]) =>
  noOpRateLimit;
