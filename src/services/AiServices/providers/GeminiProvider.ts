import axios from "axios";
import {
  IAIProvider,
  GenerateTextOptions,
  ChatMessage,
  ChatOptions,
  TranscribeAudioOptions
} from "../AIProviderInterface";
import {
  GEMINI_MODEL,
  GEMINI_BASE_URL,
  validateGeminiApiKey,
  interpretGeminiError
} from "../../../config/gemini";
import AppError from "../../../errors/AppError";

/**
 * Provider Gemini implementando a interface IAIProvider
 * Wrapper do código Gemini existente
 */
export class GeminiProvider implements IAIProvider {
  readonly name = "gemini";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = validateGeminiApiKey(apiKey);
  }

  /**
   * Gera texto a partir de um prompt simples
   */
  async generateText(
    prompt: string,
    options: GenerateTextOptions = {}
  ): Promise<string> {
    const {
      temperature = 0.5,
      maxTokens = 2048,
      topP = 0.95
    } = options;

    try {
      const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;

      const payload = {
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature,
          topK: 40,
          topP,
          maxOutputTokens: maxTokens
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_ONLY_HIGH"
          }
        ]
      };

      const { data } = await axios.post(`${url}?key=${this.apiKey}`, payload, {
        timeout: 90000
      });

      const candidates = data?.candidates || [];
      
      if (candidates.length === 0) {
        throw new AppError("Conteúdo bloqueado pelos filtros de segurança", 400);
      }

      const first = candidates[0];
      
      // Verificar finishReason
      if (first?.finishReason && first.finishReason !== "STOP") {
        if (first.finishReason === "SAFETY") {
          throw new AppError("Conteúdo bloqueado pelos filtros de segurança", 400);
        }
        if (first.finishReason === "MAX_TOKENS") {
          // Continua para tentar extrair o que foi gerado
        }
      }

      const parts = first?.content?.parts || [];
      const text = parts.map((p: any) => p.text).join("\n");

      if (!text || text.trim() === "") {
        throw new AppError("A IA não retornou resposta válida", 500);
      }

      return text.trim();
    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      
      const status = err.response?.status;
      const errorData = err.response?.data;
      
      if (status) {
        const userMessage = interpretGeminiError(status, errorData);
        throw new AppError(`Erro ao gerar texto com Gemini: ${userMessage}`, status);
      }
      
      throw new AppError(`Erro ao gerar texto com Gemini: ${err.message || "Erro desconhecido"}`, 500);
    }
  }

  /**
   * Realiza chat com histórico de mensagens
   */
  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<string> {
    const {
      temperature = 0.5,
      maxTokens = 2048,
      topP = 0.95
    } = options;

    try {
      const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;

      // Converter mensagens para o formato Gemini
      const contents = messages.map(msg => ({
        role: msg.role === "system" ? "user" : msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      }));

      const payload = {
        contents,
        generationConfig: {
          temperature,
          topK: 40,
          topP,
          maxOutputTokens: maxTokens
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_ONLY_HIGH"
          }
        ]
      };

      const { data } = await axios.post(`${url}?key=${this.apiKey}`, payload, {
        timeout: 90000
      });

      const candidates = data?.candidates || [];
      
      if (candidates.length === 0) {
        throw new AppError("Conteúdo bloqueado pelos filtros de segurança", 400);
      }

      const first = candidates[0];
      
      // Verificar finishReason
      if (first?.finishReason && first.finishReason !== "STOP") {
        if (first.finishReason === "SAFETY") {
          throw new AppError("Conteúdo bloqueado pelos filtros de segurança", 400);
        }
        if (first.finishReason === "MAX_TOKENS") {
          // Continua para tentar extrair o que foi gerado
        }
      }

      const parts = first?.content?.parts || [];
      const text = parts.map((p: any) => p.text).join("\n");

      if (!text || text.trim() === "") {
        throw new AppError("A IA não retornou resposta válida", 500);
      }

      return text.trim();
    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      
      const status = err.response?.status;
      const errorData = err.response?.data;
      
      if (status) {
        const userMessage = interpretGeminiError(status, errorData);
        throw new AppError(`Erro ao realizar chat com Gemini: ${userMessage}`, status);
      }
      
      throw new AppError(`Erro ao realizar chat com Gemini: ${err.message || "Erro desconhecido"}`, 500);
    }
  }

  /**
   * Transcreve áudio para texto usando Gemini API
   * Aceita Buffer, FileStream ou caminho de arquivo
   */
  async transcribeAudio(
    audioInput: Buffer | any,
    mimeType: string,
    options: TranscribeAudioOptions = {}
  ): Promise<string> {
    try {
      const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent`;

      // Converter input para Buffer se necessário
      let audioBuffer: Buffer;
      if (Buffer.isBuffer(audioInput)) {
        audioBuffer = audioInput;
      } else if (typeof audioInput === "string") {
        // Se for caminho de arquivo
        const fs = require("fs");
        audioBuffer = fs.readFileSync(audioInput);
      } else {
        // Se for stream, precisamos ler para Buffer
        // Para Gemini, sempre usamos base64, então converter para Buffer primeiro
        const chunks: Buffer[] = [];
        for await (const chunk of audioInput) {
          chunks.push(Buffer.from(chunk));
        }
        audioBuffer = Buffer.concat(chunks);
      }

      // Converter buffer para base64
      const audioBase64 = audioBuffer.toString("base64");

      const payload = {
        contents: [
          {
            parts: [
              {
                text: options.prompt || "Transcreva este áudio de forma literal e completa. Retorne apenas o texto transcrito, sem comentários adicionais."
              },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: audioBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 4096
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_ONLY_HIGH"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_ONLY_HIGH"
          }
        ]
      };

      const { data } = await axios.post(`${url}?key=${this.apiKey}`, payload, {
        timeout: 120000 // 2 minutos para processar áudio
      });

      const candidates = data?.candidates || [];
      
      if (candidates.length === 0) {
        throw new AppError("Não foi possível transcrever o áudio. A API não retornou resultados.", 500);
      }

      const first = candidates[0];
      
      // Verificar finishReason
      if (first?.finishReason && first.finishReason !== "STOP") {
        if (first.finishReason === "SAFETY") {
          throw new AppError("Conteúdo bloqueado pelos filtros de segurança do Gemini.", 400);
        }
        if (first.finishReason === "MAX_TOKENS") {
          // Continua para tentar extrair o que foi gerado
        }
      }

      const parts = first?.content?.parts || [];
      const transcription = parts
        .map((p: any) => p.text || "")
        .filter((t: string) => t.trim() !== "")
        .join("\n");

      if (!transcription || transcription.trim() === "") {
        throw new AppError("Não foi possível transcrever o áudio. A transcrição retornada está vazia.", 500);
      }

      return transcription.trim();
    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      
      const status = err.response?.status;
      const errorData = err.response?.data;
      
      if (status) {
        const userMessage = interpretGeminiError(status, errorData);
        throw new AppError(`Erro ao transcrever áudio: ${userMessage}`, status);
      }
      
      throw new AppError(`Erro ao transcrever áudio: ${err.message || "Erro desconhecido"}`, 500);
    }
  }
}
