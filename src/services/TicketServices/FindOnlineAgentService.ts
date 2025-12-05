import { Op } from "sequelize";
import User from "../../models/User";
import Ticket from "../../models/Ticket";
import Queue from "../../models/Queue";
import { logger } from "../../utils/logger";

interface FindOnlineAgentParams {
  companyId: number;
  queueId?: number | null;
}

/**
 * Busca um atendente online disponível para transferência
 * Considera carga de trabalho (tickets abertos) para balanceamento
 */
export const findOnlineAgent = async ({
  companyId,
  queueId
}: FindOnlineAgentParams): Promise<User | null> => {
  try {
    // Construir condições de busca
    const whereConditions: any = {
      companyId,
      online: true,
      profile: "user" // Apenas usuários, não admins
    };

    // Se queueId fornecido, buscar apenas usuários dessa fila
    let users: User[];
    if (queueId) {
      users = await User.findAll({
        where: whereConditions,
        include: [
          {
            model: Queue,
            as: "queues",
            where: { id: queueId },
            required: true
          }
        ]
      });
    } else {
      // Buscar todos os usuários online da empresa
      users = await User.findAll({
        where: whereConditions,
        include: [
          {
            model: Queue,
            as: "queues",
            required: false
          }
        ]
      });
    }

    if (users.length === 0) {
      logger.info(`Nenhum atendente online encontrado para empresa ${companyId}${queueId ? ` na fila ${queueId}` : ""}`);
      return null;
    }

    // Calcular carga de trabalho de cada usuário (tickets abertos)
    const usersWithWorkload = await Promise.all(
      users.map(async (user) => {
        const openTicketsCount = await Ticket.count({
          where: {
            userId: user.id,
            status: { [Op.in]: ["open", "pending"] },
            companyId
          }
        });

        return {
          user,
          workload: openTicketsCount
        };
      })
    );

    // Ordenar por carga de trabalho (menor primeiro) e retornar o primeiro
    usersWithWorkload.sort((a, b) => a.workload - b.workload);

    const selectedAgent = usersWithWorkload[0].user;
    logger.info(
      `Atendente online encontrado: ${selectedAgent.name} (ID: ${selectedAgent.id}) com ${usersWithWorkload[0].workload} tickets abertos`
    );

    return selectedAgent;
  } catch (error: any) {
    logger.error(`Erro ao buscar atendente online: ${error.message}`);
    return null;
  }
};

export default findOnlineAgent;

