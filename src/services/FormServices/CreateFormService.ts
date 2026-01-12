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

  // Se não for anônimo, criar campos automáticos de Nome e Telefone
  const fieldsToCreate: Field[] = [];
  
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
      placeholder: "Digite seu telefone",
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
