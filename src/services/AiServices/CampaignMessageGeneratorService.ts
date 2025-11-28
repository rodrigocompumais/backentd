import axios from "axios";
import AppError from "../../errors/AppError";
import { getGeminiKey } from "../../config/gemini";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-1.5-flash";

interface GenerateInitialMessageParams {
  companyId: number;
  objective: string;
}

interface GenerateVariationsParams {
  companyId: number;
  originalMessage: string;
  objective: string;
}

interface MessageResponse {
  message: string;
}

interface VariationsResponse {
  variations: string[];
}

const interpretGeminiError = (status: number, errorData: any): string => {
  if (status === 429) {
    return "Limite de requisições excedido. Aguarde alguns minutos.";
  }
  if (status === 400) {
    return "Erro na requisição. Verifique os dados enviados.";
  }
  if (status === 403) {
    return "API Key inválida ou sem permissão. Configure em Integrações.";
  }
  if (status === 404) {
    return "Modelo não encontrado. Entre em contato com o suporte.";
  }
  if (status >= 500) {
    return "Erro no servidor do Gemini. Tente novamente em alguns minutos.";
  }
  return errorData?.error?.message || "Erro desconhecido ao processar com IA";
};

/**
 * Gera mensagem inicial de campanha baseada no objetivo
 * Usa temperature alta (0.85) para máxima criatividade
 */
export const generateInitialMessage = async ({
  companyId,
  objective
}: GenerateInitialMessageParams): Promise<MessageResponse> => {
  const apiKey = await getGeminiKey(companyId);
  
  if (!apiKey) {
    throw new AppError("GEMINI_KEY_MISSING", 400);
  }

  const systemPrompt = `Você é um especialista em marketing e copywriting criativo para WhatsApp Business.

Seu objetivo é criar mensagens de campanha ALTAMENTE PERSUASIVAS e CRIATIVAS para WhatsApp.

CARACTERÍSTICAS IMPORTANTES:
- Seja CRIATIVO e INOVADOR
- Use emojis estrategicamente para impacto visual 📱✨
- Crie senso de urgência quando apropriado ⏰
- Inclua call-to-action claro e direto
- Tom conversacional e amigável
- Linguagem adequada ao objetivo
- Suporte variáveis: {nome}, {empresa}, etc.
- Máximo 600 caracteres (limite WhatsApp)

OBJETIVO DA CAMPANHA:
${objective}

Crie UMA mensagem persuasiva e impactante que atinja esse objetivo.
Retorne APENAS a mensagem, sem explicações adicionais.`;

  try {
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;

    console.log(`🎨 Gerando mensagem inicial de campanha...`);
    console.log(`📝 Objetivo: ${objective}`);

    const { data } = await axios.post(
      `${url}?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: systemPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.85, // Alta criatividade
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024
        }
      },
      {
        timeout: 60000
      }
    );

    const candidates = data?.candidates || [];
    const first = candidates[0];
    const parts = first?.content?.parts || [];
    const text = parts.map((p: any) => p.text).join("\n").trim();

    if (!text) {
      throw new Error("Resposta vazia do Gemini");
    }

    console.log(`✅ Mensagem inicial gerada (${text.length} caracteres)`);

    return {
      message: text
    };
  } catch (err: any) {
    const status = err.response?.status;
    const errorData = err.response?.data;
    
    console.error("❌ Erro ao gerar mensagem inicial:", {
      status,
      data: errorData,
      message: err.message
    });
    
    if (status) {
      const userMessage = interpretGeminiError(status, errorData);
      throw new AppError(userMessage, status === 429 ? 429 : 400);
    }
    
    throw new AppError(`Erro ao gerar mensagem: ${err.message}`, 500);
  }
};

/**
 * Gera 4 variações criativas da mensagem original
 * Mantém a essência mas varia abordagem e estilo
 */
export const generateVariations = async ({
  companyId,
  originalMessage,
  objective
}: GenerateVariationsParams): Promise<VariationsResponse> => {
  const apiKey = await getGeminiKey(companyId);
  
  if (!apiKey) {
    throw new AppError("GEMINI_KEY_MISSING", 400);
  }

  const systemPrompt = `Você é um especialista em marketing e copywriting criativo para WhatsApp Business.

Sua tarefa é criar 4 VARIAÇÕES CRIATIVAS E DISTINTAS da mensagem abaixo, mantendo o mesmo objetivo.

MENSAGEM ORIGINAL:
"${originalMessage}"

OBJETIVO DA CAMPANHA:
${objective}

REGRAS PARA AS VARIAÇÕES:
1. Mantenha a ESSÊNCIA e o OBJETIVO da mensagem original
2. Varie a ESTRUTURA, ABORDAGEM e ESTILO em cada variação
3. Use diferentes ângulos persuasivos (urgência, benefício, exclusividade, etc.)
4. Seja CRIATIVO - evite repetições óbvias
5. Mantenha emojis estratégicos mas varie quais usar
6. Cada variação deve ter tom e personalidade únicos
7. Máximo 600 caracteres por variação
8. Preserve variáveis como {nome}, {empresa} se houver

FORMATO DE RESPOSTA:
Retorne APENAS as 4 variações separadas por "---" (três hífens em linha separada).
Não inclua numeração, explicações ou qualquer outro texto.

Exemplo de formato:
[Variação 1 aqui]
---
[Variação 2 aqui]
---
[Variação 3 aqui]
---
[Variação 4 aqui]`;

  try {
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;

    console.log(`🎨 Gerando 4 variações criativas...`);
    console.log(`📝 Mensagem original: ${originalMessage.substring(0, 50)}...`);

    const { data } = await axios.post(
      `${url}?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: systemPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.9, // Máxima criatividade para variações
          topK: 50,
          topP: 0.95,
          maxOutputTokens: 2048
        }
      },
      {
        timeout: 90000
      }
    );

    const candidates = data?.candidates || [];
    const first = candidates[0];
    const parts = first?.content?.parts || [];
    const text = parts.map((p: any) => p.text).join("\n").trim();

    if (!text) {
      throw new Error("Resposta vazia do Gemini");
    }

    // Separar as variações pelo delimitador "---"
    const variations = text
      .split("---")
      .map(v => v.trim())
      .filter(v => v.length > 0);

    if (variations.length < 4) {
      console.warn(`⚠️ Apenas ${variations.length} variações geradas, esperadas 4`);
      
      // Se não gerou 4, completar com a original modificada
      while (variations.length < 4) {
        variations.push(originalMessage + ` [Variação ${variations.length + 1}]`);
      }
    }

    // Garantir apenas 4 variações
    const finalVariations = variations.slice(0, 4);

    console.log(`✅ ${finalVariations.length} variações geradas com sucesso`);

    return {
      variations: finalVariations
    };
  } catch (err: any) {
    const status = err.response?.status;
    const errorData = err.response?.data;
    
    console.error("❌ Erro ao gerar variações:", {
      status,
      data: errorData,
      message: err.message
    });
    
    if (status) {
      const userMessage = interpretGeminiError(status, errorData);
      throw new AppError(userMessage, status === 429 ? 429 : 400);
    }
    
    throw new AppError(`Erro ao gerar variações: ${err.message}`, 500);
  }
};

export default {
  generateInitialMessage,
  generateVariations
};

