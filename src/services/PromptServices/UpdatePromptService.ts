import * as Yup from "yup";
import AppError from "../../errors/AppError";
import Prompt from "../../models/Prompt";
import ShowPromptService from "./ShowPromptService";
import Setting from "../../models/Setting";
import { validateGeminiApiKey } from "../../config/gemini";

interface PromptData {
    id?: number;
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

interface Request {
    promptData: PromptData;
    promptId: string | number;
    companyId: string | number;
}

const UpdatePromptService = async ({
    promptId,
    promptData,
    companyId
}: Request): Promise<Prompt | undefined> => {
    const promptTable = await ShowPromptService({ promptId: promptId, companyId });

    const provider = promptData.provider || promptTable.provider || "openai";

    // Validação baseada no provider
    const promptSchema = Yup.object().shape({
        name: Yup.string().required("ERR_PROMPT_NAME_INVALID"),
        prompt: Yup.string().required("ERR_PROMPT_PROMPT_INVALID"),
        queueId: Yup.number().required("ERR_PROMPT_QUEUEID_INVALID"),
        maxMessages: Yup.number().required("ERR_PROMPT_MAX_MESSAGES_INVALID"),
        provider: Yup.string().oneOf(["openai", "gemini"], "ERR_PROMPT_PROVIDER_INVALID")
    });

    // Se for OpenAI, apiKey é obrigatória
    if (provider === "openai") {
        promptSchema.fields.apiKey = Yup.string().required("ERR_PROMPT_APIKEY_INVALID");
    }

    const { name, apiKey, prompt, maxTokens, temperature, promptTokens, completionTokens, totalTokens, queueId, maxMessages, model, canSendInternalMessages, canTransferToAgent, transferQueueId } = promptData;

    try {
        await promptSchema.validate({ name, apiKey, prompt, maxTokens, temperature, promptTokens, completionTokens, totalTokens, queueId, maxMessages, provider });
    } catch (err) {
        throw new AppError(`${JSON.stringify(err, undefined, 2)}`);
    }

    // Se for Gemini, validar que a API key está nas Settings
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

        // Para Gemini, não salvar apiKey no prompt (usará das Settings)
        promptData.apiKey = "";
    }

    // Garantir que provider tenha valor
    const updateData: any = { 
        name, 
        prompt, 
        maxTokens, 
        temperature, 
        promptTokens, 
        completionTokens, 
        totalTokens, 
        queueId, 
        maxMessages, 
        model, 
        provider,
        canSendInternalMessages: canSendInternalMessages !== undefined ? canSendInternalMessages : false,
        canTransferToAgent: canTransferToAgent !== undefined ? canTransferToAgent : false,
        transferQueueId: transferQueueId || null
    };
    
    // Só incluir apiKey se for OpenAI
    if (provider === "openai" && apiKey) {
        updateData.apiKey = apiKey;
    } else if (provider === "gemini") {
        updateData.apiKey = "";
    }

    await promptTable.update(updateData);
    await promptTable.reload();
    return promptTable;
};

export default UpdatePromptService;
