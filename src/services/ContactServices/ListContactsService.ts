import { Sequelize, Op } from "sequelize";
import Contact from "../../models/Contact";
import User from "../../models/User";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  companyId: number;
}

interface Response {
  contacts: Contact[];
  count: number;
  hasMore: boolean;
}

const ListContactsService = async ({
  searchParam = "",
  pageNumber = "1",
  companyId
}: Request): Promise<Response> => {
  const whereCondition = {
    [Op.or]: [
      {
        name: Sequelize.where(
          Sequelize.fn("LOWER", Sequelize.col("Contacts.name")),
          "LIKE",
          `%${searchParam.toLowerCase().trim()}%`
        )
      },
      { number: { [Op.like]: `%${searchParam.toLowerCase().trim()}%` } }
    ],
    companyId: {
      [Op.eq]: companyId
    }
  };
  const limit = 30;
  const offset = limit * (+pageNumber - 1);

  try {
    const { count, rows: contacts } = await Contact.findAndCountAll({
      where: whereCondition,
      limit,
      offset,
      order: [[Sequelize.col("Contacts.name"), "ASC"]],
      include: [
        {
          model: User,
          as: "user",
          required: false, // LEFT JOIN para incluir contatos sem usuário vinculado
          attributes: ["id", "name", "email"]
        }
      ]
    });

    return {
      contacts,
      count,
      hasMore: count > offset + contacts.length
    };
  } catch (error: any) {
    // Se houver erro com o include (coluna userId pode não existir ainda), tentar sem o include
    console.error("Erro ao listar contatos com include de user:", error.message);
    const { count, rows: contacts } = await Contact.findAndCountAll({
      where: whereCondition,
      limit,
      offset,
      order: [[Sequelize.col("Contacts.name"), "ASC"]]
    });

    return {
      contacts,
      count,
      hasMore: count > offset + contacts.length
    };
  }

};

export default ListContactsService;
