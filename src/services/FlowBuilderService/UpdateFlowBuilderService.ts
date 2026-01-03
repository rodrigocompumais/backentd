import { FlowBuilderModel } from "../../models/FlowBuilder";
import { WebhookModel } from "../../models/Webhook";
import { randomString } from "../../utils/randomCode";

interface Request {
  companyId: number;
  name?: string;
  flowId: number;
  flow?: any;
}

const UpdateFlowBuilderService = async ({
  companyId,
  name,
  flowId,
  flow: flowData
}: Request): Promise<String> => {
  try {

    // Se name for undefined, não tenta buscar duplicidade
    if (name) {
      const nameExist = await FlowBuilderModel.findOne({
        where: {
          name,
          company_id: companyId
        }
      })

      // Se encontrar e não for o mesmo ID (caso estivesse editando o proprio nome), mas aqui é update genérico
      if (nameExist && nameExist.id !== flowId) {
        return 'exist'
      }
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (flowData) updateData.flow = flowData;

    await FlowBuilderModel.update(updateData, {
      where: { id: flowId, company_id: companyId }
    });

    return 'ok';
  } catch (error) {
    console.error("Erro ao inserir o usuário:", error);

    return error
  }
};

export default UpdateFlowBuilderService;
