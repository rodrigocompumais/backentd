import { Readable } from "stream";
import {
  IAIProvider,
  GenerateTextOptions,
  ChatMessage,
  ChatOptions,
  TranscribeAudioOptions
} from "../AIProviderInterface";
import {
  createOpenAIClient,
  OPENAI_DEFAULT_MODEL,
  OPENAI_TRANSCRIPTION_MODEL,
  interpretOpenAIError
} from "../../../config/openai";
import AppError from "../../../errors/AppError";

/**
 * Provider OpenAI implementando a interface IAIProvider
 */
export class OpenAIProvider implements IAIProvider {
  readonly name = "openai";
  private client: ReturnType<typeof createOpenAIClient>;

  constructor(apiKey: string) {
    this.client = createOpenAIClient(apiKey);
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
      const model = OPENAI_DEFAULT_MODEL;
      
      const completion = await this.client.createChatCompletion({
        model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature,
        max_tokens: maxTokens,
        top_p: topP
      });

      const text = completion.data.choices[0]?.message?.content;
      if (!text || text.trim() === "") {
        throw new AppError("A IA não retornou resposta válida", 500);
      }

      return text.trim();
    } catch (err: any) {
      const userMessage = interpretOpenAIError(err);
      throw new AppError(`Erro ao gerar texto com OpenAI: ${userMessage}`, err?.status || 500);
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
      topP = 0.95,
      model = OPENAI_DEFAULT_MODEL
    } = options;

    try {
      // Converter mensagens para o formato OpenAI
      const openAIMessages = messages.map(msg => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const completion = await this.client.createChatCompletion({
        model,
        messages: openAIMessages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP
      });

      const text = completion.data.choices[0]?.message?.content;
      if (!text || text.trim() === "") {
        throw new AppError("A IA não retornou resposta válida", 500);
      }

      return text.trim();
    } catch (err: any) {
      const userMessage = interpretOpenAIError(err);
      throw new AppError(`Erro ao realizar chat com OpenAI: ${userMessage}`, err?.status || 500);
    }
  }

  /**
   * Transcreve áudio para texto usando Whisper API
   * Aceita Buffer, FileStream ou caminho de arquivo
   */
  async transcribeAudio(
    audioInput: Buffer | Readable | string,
    mimeType: string,
    options: TranscribeAudioOptions = {}
  ): Promise<string> {
    try {
      let file: any;

      // Se for string, assumir que é caminho de arquivo
      if (typeof audioInput === "string") {
        const fs = require("fs");
        file = fs.createReadStream(audioInput);
      }
      // Se for Buffer, converter para Readable Stream
      else if (Buffer.isBuffer(audioInput)) {
        file = Readable.from(audioInput);
        // OpenAI SDK precisa de um objeto File-like
        file.name = `audio.${mimeType.split("/")[1] || "mp3"}`;
      }
      // Se já for Readable Stream
      else {
        file = audioInput;
      }

      const response = await this.client.createTranscription(
        file as any, // FileStream ou Buffer
        OPENAI_TRANSCRIPTION_MODEL,
        options.prompt,
        "text", // responseFormat
        undefined, // temperature
        options.language
      );

      // Na API antiga, createTranscription retorna uma string diretamente ou um objeto
      const text = typeof response === "string" ? response : (response as any).text || (response as any).data?.text || "";
      if (!text || text.trim() === "") {
        throw new AppError("A transcrição retornada está vazia", 500);
      }

      return text.trim();
    } catch (err: any) {
      const userMessage = interpretOpenAIError(err);
      throw new AppError(`Erro ao transcrever áudio com OpenAI: ${userMessage}`, err?.status || 500);
    }
  }
}
