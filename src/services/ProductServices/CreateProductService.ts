import Product from "../../models/Product";
import AppError from "../../errors/AppError";

interface Request {
  name: string;
  description?: string;
  value: number;
  quantity?: number;
  isMenuProduct?: boolean;
  grupo?: string;
  companyId: number;
}

const CreateProductService = async ({
  name,
  description,
  value,
  quantity = 0,
  isMenuProduct = false,
  grupo,
  companyId,
}: Request): Promise<Product> => {
  if (!name || name.trim() === "") {
    throw new AppError("ERR_PRODUCT_NAME_REQUIRED", 400);
  }

  if (value === undefined || value === null || value < 0) {
    throw new AppError("ERR_PRODUCT_VALUE_INVALID", 400);
  }

  const product = await Product.create({
    name: name.trim(),
    description: description?.trim() || null,
    value,
    quantity: quantity || 0,
    isMenuProduct: isMenuProduct || false,
    grupo: grupo?.trim() || null,
    companyId,
  });

  return product;
};

export default CreateProductService;
