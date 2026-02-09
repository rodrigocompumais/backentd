import Product from "../../models/Product";
import AppError from "../../errors/AppError";

interface Request {
  name: string;
  description?: string;
  value: number;
  quantity?: number;
  isMenuProduct?: boolean;
  variablePrice?: boolean;
  grupo?: string;
  imageUrl?: string;
  companyId: number;
  allowsHalfAndHalf?: boolean;
  halfAndHalfPriceRule?: string | null;
  halfAndHalfGrupo?: string | null;
}

const CreateProductService = async ({
  name,
  description,
  value,
  quantity = 0,
  isMenuProduct = false,
  variablePrice = false,
  allowsHalfAndHalf = false,
  halfAndHalfPriceRule,
  halfAndHalfGrupo,
  grupo,
  imageUrl,
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
    variablePrice: variablePrice || false,
    allowsHalfAndHalf: allowsHalfAndHalf || false,
    halfAndHalfPriceRule: halfAndHalfPriceRule?.trim() || null,
    halfAndHalfGrupo: halfAndHalfGrupo?.trim() || null,
    grupo: grupo?.trim() || null,
    imageUrl: imageUrl?.trim() || null,
    companyId,
  });

  return product;
};

export default CreateProductService;
