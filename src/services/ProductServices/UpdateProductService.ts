import Product from "../../models/Product";
import AppError from "../../errors/AppError";

interface Request {
  productId: number;
  companyId: number;
  name?: string;
  description?: string;
  value?: number;
  quantity?: number;
  isMenuProduct?: boolean;
  variablePrice?: boolean;
  allowsHalfAndHalf?: boolean;
  halfAndHalfPriceRule?: string | null;
  halfAndHalfGrupo?: string | null;
  grupo?: string;
  imageUrl?: string;
}

const UpdateProductService = async ({
  productId,
  companyId,
  name,
  description,
  value,
  quantity,
  isMenuProduct,
  variablePrice,
  allowsHalfAndHalf,
  halfAndHalfPriceRule,
  halfAndHalfGrupo,
  grupo,
  imageUrl,
}: Request): Promise<Product> => {
  const product = await Product.findOne({
    where: { id: productId, companyId },
  });

  if (!product) {
    throw new AppError("ERR_PRODUCT_NOT_FOUND", 404);
  }

  if (name !== undefined) {
    if (!name || name.trim() === "") {
      throw new AppError("ERR_PRODUCT_NAME_REQUIRED", 400);
    }
    product.name = name.trim();
  }

  if (description !== undefined) {
    product.description = description?.trim() || null;
  }

  if (value !== undefined) {
    if (value === null || value < 0) {
      throw new AppError("ERR_PRODUCT_VALUE_INVALID", 400);
    }
    product.value = value;
  }

  if (quantity !== undefined) {
    product.quantity = quantity;
  }

  if (isMenuProduct !== undefined) {
    product.isMenuProduct = isMenuProduct;
  }

  if (variablePrice !== undefined) {
    product.variablePrice = variablePrice;
  }

  if (allowsHalfAndHalf !== undefined) {
    product.allowsHalfAndHalf = allowsHalfAndHalf;
  }

  if (halfAndHalfPriceRule !== undefined) {
    product.halfAndHalfPriceRule = halfAndHalfPriceRule?.trim() || null;
  }

  if (halfAndHalfGrupo !== undefined) {
    product.halfAndHalfGrupo = halfAndHalfGrupo?.trim() || null;
  }

  if (grupo !== undefined) {
    product.grupo = grupo?.trim() || null;
  }

  if (imageUrl !== undefined) {
    product.imageUrl = imageUrl?.trim() || null;
  }

  await product.save();

  return product;
};

export default UpdateProductService;
