import Form from "../../models/Form";
import FormField from "../../models/FormField";
import AppError from "../../errors/AppError";

interface Field {
  label: string;
  fieldType: string;
  placeholder?: string;
  isRequired?: boolean;
  order: number;
  options?: string[];
  helpText?: string;
  validation?: object;
  hasConditional?: boolean;
  conditionalRules?: object;
  conditionalFieldId?: number;
  metadata?: object;
}

interface Request {
  name: string;
  description?: string;
  companyId: number;
  createdBy: number;
  fields?: Field[];
  primaryColor?: string;
  secondaryColor?: string;
  logoPosition?: string;
  logoUrl?: string;
  successMessage?: string;
  successRedirectUrl?: string;
  requireAuth?: boolean;
  allowMultipleSubmissions?: boolean;
  isAnonymous?: boolean;
  createContact?: boolean;
  createTicket?: boolean;
  sendWebhook?: boolean;
  webhookUrl?: string;
  settings?: object;
}

const CreateFormService = async ({
  name,
  description,
  companyId,
  createdBy,
  fields,
  ...otherSettings
}: Request): Promise<Form> => {
  // Generate unique slug from name
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  // Check if slug already exists
  const existingForm = await Form.findOne({
    where: { slug, companyId },
  });

  let finalSlug = slug;
  if (existingForm) {
    finalSlug = `${slug}-${Date.now()}`;
  }

  const form = await Form.create({
    name,
    description,
    slug: finalSlug,
    companyId,
    createdBy,
    ...otherSettings,
  });

  // Verificar se é formulário de cotação ou cardápio
  const formSettings = form.settings as any;
  const isQuotationForm = formSettings?.formType === "quotation";
  const isMenuForm = formSettings?.formType === "cardapio";

  const fieldsToCreate: Field[] = [];

  if (isQuotationForm) {
    // Para formulários de cotação, criar campos automáticos: Nome do Fornecedor, Telefone, Nome do Vendedor
    fieldsToCreate.push({
      label: "Nome do Fornecedor",
      fieldType: "text",
      placeholder: "Digite o nome do fornecedor",
      isRequired: true,
      order: 0,
      metadata: { isAutoField: true, autoFieldType: "supplierName" },
    } as Field);

    fieldsToCreate.push({
      label: "Telefone",
      fieldType: "phone",
      placeholder: "Digite o telefone (ex: 5534999999999)",
      isRequired: true,
      order: 1,
      metadata: { isAutoField: true, autoFieldType: "phone" },
    } as Field);

    fieldsToCreate.push({
      label: "Nome do Vendedor",
      fieldType: "text",
      placeholder: "Digite o nome do vendedor",
      isRequired: true,
      order: 2,
      metadata: { isAutoField: true, autoFieldType: "sellerName" },
      } as Field);
  } else if (isMenuForm) {
    // Para formulários de cardápio, criar campos automáticos: Nome e Telefone (obrigatórios)
    fieldsToCreate.push({
      label: "Nome",
      fieldType: "text",
      placeholder: "Digite seu nome",
      isRequired: true,
      order: 0,
      metadata: { isAutoField: true, autoFieldType: "name" },
    } as Field);

    fieldsToCreate.push({
      label: "Telefone",
      fieldType: "phone",
      placeholder: "Digite seu telefone (ex: 5534999999999)",
      isRequired: true,
      order: 1,
      metadata: { isAutoField: true, autoFieldType: "phone" },
    } as Field);

    // Campos customizados da aba finalizar serão adicionados pelo gestor
    if (fields && fields.length > 0) {
      fields.forEach((field, index) => {
        fieldsToCreate.push({
          ...field,
          order: 2 + index,
        });
      });
    }
  } else {
    // Se não for cotação nem cardápio, criar campos automáticos de Nome e Telefone se não for anônimo
    if (!form.isAnonymous) {
      // Campo Nome (primeiro)
      fieldsToCreate.push({
        label: "Nome",
        fieldType: "text",
        placeholder: "Digite seu nome",
        isRequired: true,
        order: 0,
        metadata: { isAutoField: true, autoFieldType: "name" },
      } as Field);
      
      // Campo Telefone (segundo)
      fieldsToCreate.push({
        label: "Telefone",
        fieldType: "phone",
        placeholder: "Digite seu telefone (ex: 5534999999999)",
        isRequired: true,
        order: 1,
        metadata: { isAutoField: true, autoFieldType: "phone" },
      } as Field);
    }

    // Adicionar campos customizados após os automáticos
    if (fields && fields.length > 0) {
      fields.forEach((field, index) => {
        fieldsToCreate.push({
          ...field,
          order: (form.isAnonymous ? 0 : 2) + index, // Ajustar ordem
        });
      });
    }
  }

  if (fieldsToCreate.length > 0) {
    const fieldsToInsert = fieldsToCreate.map((field) => ({
      ...field,
      formId: form.id,
    }));
    await FormField.bulkCreate(fieldsToInsert);
  }

  // Reload form with fields
  const formWithFields = await Form.findByPk(form.id, {
    include: [
      {
        association: "fields",
        separate: true,
        order: [["order", "ASC"]],
      },
    ],
  });

  return formWithFields || form;
};

export default CreateFormService;
