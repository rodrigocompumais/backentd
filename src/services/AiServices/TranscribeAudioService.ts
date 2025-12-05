import fs from "fs";
import path from "path";
import axios from "axios";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Setting from "../../models/Setting";
import { GEMINI_MODEL, GEMINI_BASE_URL, validateGeminiApiKey, interpretGeminiError } from "../../config/gemini";
import { logger } from "../../utils/logger";

interface TranscribeAudioParams {
  messageId: string;
  companyId: number;
}

interface TranscribeAudioResponse {
  transcription: string;
  messageId: string;
}

const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");

/**
 * Converte arquivo de áudio para base64
 */
const audioToBase64 = (filePath: string): string => {
  const fileBuffer = fs.readFileSync(filePath);
  return fileBuffer.toString("base64");
};

/**
 * Detecta o tipo MIME do arquivo de áudio baseado na extensão
 */
const getAudioMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/m4a",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".aac": "audio/aac"
  };
  return mimeTypes[ext] || "audio/mpeg";
};

/**
 * Valida o tamanho do arquivo (máximo 100MB)
 */
const validateFileSize = (filePath: string): void => {
  const stats = fs.statSync(filePath);
  const fileSizeInMB = stats.size / (1024 * 1024);
  
  if (fileSizeInMB > 100) {
    throw new AppError(
      `Arquivo de áudio muito grande (${fileSizeInMB.toFixed(2)}MB). O tamanho máximo é 100MB.`,
      400
    );
  }
};

/**
 * Transcreve mensagem de áudio usando Gemini API
 */
const transcribeAudio = async ({
  messageId,
  companyId
}: TranscribeAudioParams): Promise<TranscribeAudioResponse> => {
  try {
    // Buscar mensagem
    const message = await Message.findOne({
      where: {
        id: messageId,
        companyId,
        mediaType: "audio",
        isDeleted: false
      }
    });

    if (!message) {
      throw new AppError("Mensagem de áudio não encontrada ou não pertence a esta empresa.", 404);
    }

    // Obter chave da API do Gemini
    const geminiSetting = await Setting.findOne({
      where: {
        key: "geminiApiKey",
        companyId
      }
    });

    let apiKey: string;
    try {
      apiKey = validateGeminiApiKey(geminiSetting?.value);
    } catch (err: any) {
      throw new AppError(err.message || "Chave da API do Gemini não configurada.", 400);
    }

    // Obter caminho do arquivo de áudio
    // O mediaUrl retorna a URL completa, mas precisamos do nome do arquivo
    const mediaUrlValue = message.getDataValue("mediaUrl");
    if (!mediaUrlValue) {
      throw new AppError("Arquivo de áudio não encontrado para esta mensagem.", 404);
    }

    // Extrair nome do arquivo da URL
    const fileName = mediaUrlValue.includes("/public/")
      ? mediaUrlValue.split("/public/")[1]
      : mediaUrlValue.split("/").pop() || mediaUrlValue;

    const audioFilePath = path.join(publicFolder, fileName);

    // Verificar se arquivo existe
    if (!fs.existsSync(audioFilePath)) {
      logger.error(`Arquivo de áudio não encontrado: ${audioFilePath}`);
      throw new AppError("Arquivo de áudio não encontrado no servidor.", 404);
    }

    // Validar tamanho do arquivo
    validateFileSize(audioFilePath);

    // Converter áudio para base64
    logger.info(`Convertendo áudio para base64: ${audioFilePath}`);
    const audioBase64 = audioToBase64(audioFilePath);
    const mimeType = getAudioMimeType(audioFilePath);

    // Chamar Gemini API para transcrever
    logger.info(`Enviando áudio para transcrição no Gemini (tamanho: ${(audioBase64.length / 1024).toFixed(2)}KB)`);
    
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    
    const response = await axios.post(
      url,
      {
        contents: [
          {
            parts: [
              {
                text: "Transcreva este áudio de forma literal e completa. Retorne apenas o texto transcrito, sem comentários adicionais."
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
      },
      {
        timeout: 120000 // 2 minutos para processar áudio
      }
    );

    const candidates = response.data?.candidates || [];
    
    if (candidates.length === 0) {
      logger.error("Nenhum candidato retornado pelo Gemini para transcrição");
      logger.error("Resposta completa da API:", JSON.stringify(response.data, null, 2));
      throw new AppError("Não foi possível transcrever o áudio. A API não retornou resultados.", 500);
    }

    const first = candidates[0];
    
    // Verificar finishReason
    if (first?.finishReason && first.finishReason !== "STOP") {
      logger.warn(`⚠️ finishReason: ${first.finishReason}`);
      
      if (first.finishReason === "SAFETY") {
        throw new AppError("Conteúdo bloqueado pelos filtros de segurança do Gemini.", 400);
      }
      
      if (first.finishReason === "MAX_TOKENS") {
        logger.warn("⚠️ MAX_TOKENS atingido, transcrição pode estar incompleta");
      }
    }

    const parts = first?.content?.parts || [];
    const transcription = parts
      .map((p: any) => p.text || "")
      .filter((t: string) => t.trim() !== "")
      .join("\n");

    if (!transcription || transcription.trim() === "") {
      logger.error("Transcrição vazia retornada pelo Gemini");
      logger.error("Candidato completo:", JSON.stringify(first, null, 2));
      throw new AppError("Não foi possível transcrever o áudio. A transcrição retornada está vazia.", 500);
    }

    logger.info(`✅ Transcrição concluída com sucesso (${transcription.length} caracteres)`);

    return {
      transcription: transcription.trim(),
      messageId
    };
  } catch (err: any) {
    if (err instanceof AppError) {
      throw err;
    }

    const status = err.response?.status;
    const errorData = err.response?.data;

    logger.error("Erro ao transcrever áudio com Gemini:", {
      status,
      data: errorData,
      message: err.message,
      messageId,
      companyId
    });

    if (status) {
      const userMessage = interpretGeminiError(status, errorData);
      throw new AppError(`Erro ao transcrever áudio: ${userMessage}`, status);
    }

    throw new AppError(
      `Erro ao transcrever áudio: ${err.message || "Erro desconhecido"}`,
      500
    );
  }
};

export default transcribeAudio;

