import axios from "axios";
import Setting from "../../models/Setting";
import { GEMINI_MODEL, GEMINI_BASE_URL, validateGeminiApiKey } from "../../config/gemini";
import { logger } from "../../utils/logger";

interface GenerateFlowRequest {
    prompt: string;
    companyId: number;
}

interface FlowStructure {
    nodes: any[];
    edges: any[];
}

const GenerateFlowService = async ({
    prompt,
    companyId
}: GenerateFlowRequest): Promise<FlowStructure | null> => {
    try {
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
            logger.error(`Erro ao validar API key do Gemini: ${err.message}`);
            throw new Error("Erro ao validar API Key do Gemini: " + err.message);
        }

        const systemPrompt = `Você é um especialista em criar fluxos de conversa para chatbots.
Sua tarefa é converter a solicitação do usuário em um JSON de fluxo válido.

Estrutura do JSON Obrigatória:
{
  "nodes": [
    { "id": "1", "type": "start", "position": { "x": 250, "y": 100 }, "data": { "label": "Inicio do fluxo" } },
    { "id": "2", "type": "message", "position": { "x": 250, "y": 300 }, "data": { "label": "Exemplo de mensagem" } }
  ],
  "edges": [
    { "id": "e1-2", "source": "1", "target": "2", "type": "smoothstep" }
  ]
}

Regras:
1. O nó inicial DEVE ter id "1" e type "start".
2. Use os seguintes tipos de nós:
   - "message": para enviar mensagens de texto (campo data.label).
   - "menu": para menus de opções (campo data.message e data.arrayOption: [{number: 1, value: "Opção 1"}, ...]).
   - "ticket": para transferir para fila (campo data.queue e data.label).
   - "condition": para horário (data.condition: "time", data.key: "open").
   - "openai": para IA (data.name, data.prompt).
   - "gemini": para IA Gemini (data.name, data.prompt).
3. Conecte os nós logicamente usando "edges". Para menu, use "sourceHandle": "a1", "a2" etc. correspondente ao número da opção.
4. Distribua os nós visualmente alterando "position.x" e "position.y" para não ficarem sobrepostos (aumente Y para descer, aumente X para ramificações).
5. RESPONDA APENAS O JSON. Sem markdown, sem explicações.

Solicitação do usuário: ${prompt}`;

        const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

        const { data } = await axios.post(
            url,
            {
                contents: [
                    {
                        role: "user",
                        parts: [{ text: systemPrompt }]
                    }
                ],
                generationConfig: {
                    temperature: 0.2, // Baixa temperatura para JSON estruturado
                    maxOutputTokens: 2048,
                }
            },
            { timeout: 60000 }
        );

        const candidates = data?.candidates || [];
        if (candidates.length === 0) {
            throw new Error("Nenhuma resposta do Gemini.");
        }

        const textResponse = candidates[0]?.content?.parts?.[0]?.text;
        if (!textResponse) {
            throw new Error("Resposta vazia do Gemini.");
        }

        // Limpar markdown se houver e extrair apenas o JSON
        let cleanedJson = textResponse;

        // Tentar encontrar o JSON entre blocos de código
        const jsonMatch = textResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
            cleanedJson = jsonMatch[1];
        } else {
            // Fallback: tentar encontrar o primeiro { e o último }
            const firstBrace = textResponse.indexOf('{');
            const lastBrace = textResponse.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanedJson = textResponse.substring(firstBrace, lastBrace + 1);
            }
        }

        try {
            const flow = JSON.parse(cleanedJson);
            return flow;
        } catch (e) {
            logger.error("Erro ao fazer parse do JSON gerado pelo Gemini", e);
            logger.error("Resposta original:", textResponse);
            throw new Error("O Gemini não gerou um JSON válido. Tente refazer o prompt.");
        }
    } catch (error: any) {
        logger.error(`GenerateFlowService Error: ${error.message}`);
        throw error;
    }
};

export default GenerateFlowService;
