import Product from "../../models/Product";

interface MenuItem {
  productId: number;
  quantity: number;
  productName?: string;
  productValue?: number;
  grupo?: string;
}

interface CustomField {
  label: string;
  answer: string;
}

interface Request {
  menuItems: MenuItem[];
  customerName: string;
  customerPhone: string;
  customFields?: CustomField[];
}

const FormatMenuOrderMessage = async ({
  menuItems,
  customerName,
  customerPhone,
  customFields = [],
}: Request): Promise<string> => {
  // Buscar informações completas dos produtos se não estiverem no menuItem
  const productIds = menuItems.map((item) => item.productId);
  const products = await Product.findAll({
    where: { id: productIds },
  });

  // Criar mapa de produtos para acesso rápido
  const productMap = new Map(
    products.map((p) => [p.id, { name: p.name, value: p.value, grupo: p.grupo || "Outros" }])
  );

  // Agrupar itens por grupo
  const itemsByGroup: { [key: string]: MenuItem[] } = {};

  menuItems.forEach((item) => {
    const product = productMap.get(item.productId);
    const grupo = item.grupo || product?.grupo || "Outros";
    const productName = item.productName || product?.name || "Produto";
    const productValue = item.productValue || product?.value || 0;

    if (!itemsByGroup[grupo]) {
      itemsByGroup[grupo] = [];
    }

    itemsByGroup[grupo].push({
      ...item,
      productName,
      productValue,
      grupo,
    });
  });

  // Construir mensagem
  let message = "🍽️ *NOVO PEDIDO - CARDÁPIO*\n\n";
  message += `👤 *Cliente:* ${customerName}\n`;
  message += `📱 *Telefone:* ${customerPhone}\n\n`;
  message += "📋 *ITENS DO PEDIDO:*\n\n";

  let total = 0;

  // Adicionar itens agrupados por grupo
  Object.keys(itemsByGroup).forEach((grupo) => {
    message += `*${grupo}*\n`;
    itemsByGroup[grupo].forEach((item) => {
      const itemTotal = (item.productValue || 0) * item.quantity;
      total += itemTotal;
      message += `• ${item.productName} - Qtd: ${item.quantity} - R$ ${itemTotal.toFixed(2).replace(".", ",")}\n`;
    });
    message += "\n";
  });

  message += `💰 *TOTAL:* R$ ${total.toFixed(2).replace(".", ",")}\n`;

  // Adicionar campos customizados se houver
  if (customFields && customFields.length > 0) {
    message += "\n";
    customFields.forEach((field) => {
      if (field.answer && field.answer.trim() !== "") {
        message += `*${field.label}:* ${field.answer}\n`;
      }
    });
  }

  return message;
};

export default FormatMenuOrderMessage;
