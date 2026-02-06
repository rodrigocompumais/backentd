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
