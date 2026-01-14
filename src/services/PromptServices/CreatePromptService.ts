import * as Yup from "yup";
import AppError from "../../errors/AppError";
import Prompt from "../../models/Prompt";
import ShowPromptService from "./ShowPromptService";
import Setting from "../../models/Setting";
import { validateGeminiApiKey } from "../../config/gemini";
import { validateOpenAIApiKey } from "../../config/openai";

interface PromptData {
    name: string;
    apiKey?: string;
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    queueId?: number;
    maxMessages?: number;
    companyId: string | number;
    model: string;
    provider?: string;
    canSendInternalMessages?: boolean;
    canTransferToAgent?: boolean;
    transferQueueId?: number | null;
}

const CreatePromptService = async (promptData: PromptData): Promise<Prompt> => {
    const { name, apiKey, prompt, queueId, maxMessages, companyId, provider = "openai" } = promptData;

    // Validação baseada no provider
    const promptSchema = Yup.object().shape({
        name: Yup.string().required("ERR_PROMPT_NAME_INVALID"),
        prompt: Yup.string().required("ERR_PROMPT_INTELLIGENCE_INVALID"),
        queueId: Yup.number().required("ERR_PROMPT_QUEUEID_INVALID"),
        maxMessages: Yup.number().required("ERR_PROMPT_MAX_MESSAGES_INVALID"),
        companyId: Yup.number().required("ERR_PROMPT_companyId_INVALID"),
        provider: Yup.string().oneOf(["openai", "gemini"], "ERR_PROMPT_PROVIDER_INVALID")
    });

    // Não exigir apiKey no prompt - será buscada das Settings
    try {
        await promptSchema.validate({ name, prompt, queueId, maxMessages, companyId, provider });
    } catch (err) {
        throw new AppError(`${JSON.stringify(err, undefined, 2)}`);
    }

    // Validar que a API key está nas Settings (tanto para Gemini quanto OpenAI)
    if (provider === "gemini") {
        const geminiSetting = await Setting.findOne({
            where: {
                key: "geminiApiKey",
                companyId
            }
        });

        try {
            validateGeminiApiKey(geminiSetting?.value);
        } catch (err: any) {
            throw new AppError("Para usar Gemini, configure a API Key do Gemini em Configurações → Integrações → Chave da API do Gemini", 400);
        }
    } else if (provider === "openai") {
        const openaiSetting = await Setting.findOne({
            where: {
                key: "openaiApiKey",
                companyId
            }
        });

        try {
            validateOpenAIApiKey(openaiSetting?.value);
        } catch (err: any) {
            throw new AppError("Para usar OpenAI, configure a API Key do OpenAI em Configurações → Integrações → Chave da API do OpenAI", 400);
        }
    }

    // Não salvar apiKey no prompt (usará das Settings)
    promptData.apiKey = "";

    // Garantir que provider tenha valor default
    if (!promptData.provider) {
        promptData.provider = "openai";
    }

    let promptTable = await Prompt.create(promptData);
    promptTable = await ShowPromptService({ promptId: promptTable.id, companyId });

    return promptTable;
};

export default CreatePromptService;
