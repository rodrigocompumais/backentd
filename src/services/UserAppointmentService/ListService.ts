import { Op } from "sequelize";
import UserAppointment from "../../models/UserAppointment";

interface Request {
    companyId: number;
    userId?: number;
    filterType?: "all" | "myAppointments" | "assignedToMe";
    searchParam?: string;
    pageNumber?: string;
}

interface Response {
    appointments: UserAppointment[];
    count: number;
    hasMore: boolean;
}

const ListService = async ({
    companyId,
    userId,
    filterType = "all",
    searchParam,
    pageNumber = "1",
}: Request): Promise<Response> => {
    let whereCondition: any = {
        companyId,
    };

    // Apply filter based on filterType
    if (filterType === "myAppointments" && userId) {
        whereCondition.userId = userId;
    } else if (filterType === "assignedToMe" && userId) {
        whereCondition.assignedUserId = userId;
    }

    // Apply search filter
    if (searchParam) {
        whereCondition = {
            ...whereCondition,
            [Op.or]: [
                { title: { [Op.like]: `%${searchParam}%` } },
                { description: { [Op.like]: `%${searchParam}%` } },
            ],
        };
    }

    const limit = 20;
    const offset = limit * (+pageNumber - 1);

    const { count, rows: appointments } = await UserAppointment.findAndCountAll({
        where: whereCondition,
        limit,
        offset,
        order: [["startTime", "ASC"]],
        include: [
            { association: "user", attributes: ["id", "name", "email"] },
            { association: "assignedUser", attributes: ["id", "name", "email"] },
        ],
    });

    const hasMore = count > offset + appointments.length;

    return {
        appointments,
        count,
        hasMore,
    };
};

export default ListService;
