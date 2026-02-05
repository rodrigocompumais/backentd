import Product from "../../models/Product";
import { Op } from "sequelize";

interface Request {
  companyId: number;
  searchParam?: string;
  pageNumber?: number;
  isMenuProduct?: boolean;
}

interface Response {
  products: Product[];
  count: number;
  hasMore: boolean;
}

const ListProductsService = async ({
  companyId,
  searchParam,
  pageNumber = 1,
  isMenuProduct,
}: Request): Promise<Response> => {
  const whereCondition: any = { companyId };

  if (searchParam) {
    whereCondition[Op.or] = [
      { name: { [Op.iLike]: `%${searchParam}%` } },
      { description: { [Op.iLike]: `%${searchParam}%` } },
      { grupo: { [Op.iLike]: `%${searchParam}%` } },
    ];
  }

  if (isMenuProduct !== undefined) {
    whereCondition.isMenuProduct = isMenuProduct;
  }

  const limit = 20;
  const offset = (pageNumber - 1) * limit;

  const { count, rows: products } = await Product.findAndCountAll({
    where: whereCondition,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return {
    products,
    count,
    hasMore: count > offset + limit,
  };
};

export default ListProductsService;
