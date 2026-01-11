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

  if (fields !== undefined) {
    // Delete all existing fields
    await FormField.destroy({
      where: { formId: form.id },
    });

    // Create new fields
    if (fields.length > 0) {
      const fieldsToCreate = fields.map((field) => ({
        ...field,
        formId: form.id,
      }));
      await FormField.bulkCreate(fieldsToCreate);
    }
  }

  await form.reload({
    include: [{ association: "fields", order: [["order", "ASC"]] }],
  });

  return form;
};

export default UpdateFormService;
