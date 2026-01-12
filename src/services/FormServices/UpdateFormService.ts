import Form from "../../models/Form";
import FormField from "../../models/FormField";
import AppError from "../../errors/AppError";

interface Field {
  id?: number;
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
  formId: number;
  companyId: number;
  name?: string;
  description?: string;
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
  isActive?: boolean;
  createContact?: boolean;
  createTicket?: boolean;
  sendWebhook?: boolean;
  webhookUrl?: string;
  settings?: object;
}

const UpdateFormService = async ({
  formId,
  companyId,
  fields,
  ...formData
}: Request): Promise<Form> => {
  const form = await Form.findOne({
    where: { id: formId, companyId },
  });

  if (!form) {
    throw new AppError("ERR_FORM_NOT_FOUND", 404);
  }

  await form.update(formData);
  await form.reload();

  // Verificar se é formulário de cotação
  const formSettings = form.settings as any;
  const isQuotationForm = formSettings?.formType === "quotation";

  if (fields !== undefined) {
    // Delete all existing fields (incluindo campos automáticos se existirem)
    await FormField.destroy({
      where: { formId: form.id },
    });

    // Se for cotação, não criar campos (os dados estão em quotationItems)
    if (!isQuotationForm) {
      // Criar campos: automáticos (se não anônimo) + customizados
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
      if (fields.length > 0) {
        fields.forEach((field, index) => {
          fieldsToCreate.push({
            ...field,
            order: (form.isAnonymous ? 0 : 2) + index,
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
    }
  }

  await form.reload({
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  return form;
};

export default UpdateFormService;
