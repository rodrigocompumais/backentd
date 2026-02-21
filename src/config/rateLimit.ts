import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Configurações de Rate Limiting
 * 
 * Define diferentes presets de rate limiting para diferentes tipos de rotas.
 * Configurações podem ser sobrescritas via variáveis de ambiente.
 */

// Rate Limit Geral - Proteção base para todas as rotas
export const generalRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 minutos padrão
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10), // 100 requests por janela
  message: {
    error: "ERR_RATE_LIMIT_EXCEEDED",
    message: "Muitas requisições deste IP, por favor tente novamente mais tarde."
  },
  standardHeaders: true, // Retorna informações de rate limit nos headers `RateLimit-*`
  legacyHeaders: false, // Desabilita headers `X-RateLimit-*`
  skip: (req) => {
    // Pular rate limit em ambiente de desenvolvimento para rotas de teste
    if (process.env.NODE_ENV === "development" && req.path.startsWith("/test")) {
      return true;
    }
    return false;
  }
});

// Rate Limit de Autenticação - Mais restritivo para proteção contra brute force
export const authRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || "900000", 10), // 15 minutos padrão
  max: parseInt(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || "5", 10), // 5 tentativas por janela
  message: {
    error: "ERR_AUTH_RATE_LIMIT_EXCEEDED",
    message: "Muitas tentativas de login. Por favor, tente novamente em 15 minutos."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Contar todas as tentativas, mesmo as bem-sucedidas
  keyGenerator: (req) => {
    // Extrair IP do request e normalizar usando ipKeyGenerator para suporte correto a IPv6
    // Combinar IP + email para melhor rastreamento
    const rawIp = req.ip || req.socket.remoteAddress || "unknown";
    const normalizedIp = ipKeyGenerator(rawIp);
    const email = req.body?.email || req.body?.username || "";
    return email ? `${normalizedIp}-${email}` : normalizedIp;
  }
});

// Rate Limit de Importação - Limites específicos para uploads e importações
export const importRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_IMPORT_WINDOW_MS || "3600000", 10), // 1 hora padrão
  max: parseInt(process.env.RATE_LIMIT_IMPORT_MAX_REQUESTS || "10", 10), // 10 importações por hora
  message: {
    error: "ERR_IMPORT_RATE_LIMIT_EXCEEDED",
    message: "Limite de importações excedido. Por favor, aguarde antes de tentar novamente."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});

// Rate Limit de Webhooks - Configuração diferenciada para webhooks externos
export const webhookRateLimit = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WEBHOOK_WINDOW_MS || "60000", 10), // 1 minuto padrão
  max: parseInt(process.env.RATE_LIMIT_WEBHOOK_MAX_REQUESTS || "100", 10), // 100 webhooks por minuto
  message: {
    error: "ERR_WEBHOOK_RATE_LIMIT_EXCEEDED",
    message: "Limite de requisições de webhook excedido."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false
});

/**
 * Função helper para criar rate limiters customizados
 * 
 * @param options - Opções de configuração do rate limiter
 * @returns Rate limiter configurado
 */
export const createCustomRateLimit = (options: {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (req: any) => string;
}) => {
  // Se um keyGenerator customizado for fornecido, garantir que use ipKeyGenerator para IPv6
  let finalKeyGenerator = options.keyGenerator;
  
  if (options.keyGenerator) {
    // Wrapper para garantir que IPs sejam normalizados
    finalKeyGenerator = (req: any) => {
      const result = options.keyGenerator!(req);
      // Se o resultado contém um IP não normalizado, normalizar
      if (result && typeof result === 'string') {
        // Verificar se parece ser um IP e normalizar se necessário
        const ipMatch = result.match(/^([\d\.:a-fA-F]+)(-.*)?$/);
        if (ipMatch && ipMatch[1]) {
          const normalizedIp = ipKeyGenerator(ipMatch[1]);
          return ipMatch[2] ? `${normalizedIp}${ipMatch[2]}` : normalizedIp;
        }
      }
      return result;
    };
  }
  
  return rateLimit({
    windowMs: options.windowMs || 900000,
    max: options.max || 100,
    message: {
      error: "ERR_RATE_LIMIT_EXCEEDED",
      message: options.message || "Limite de requisições excedido."
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: finalKeyGenerator
  });
};
