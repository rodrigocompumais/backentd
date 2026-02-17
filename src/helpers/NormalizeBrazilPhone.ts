/**
 * Normaliza números brasileiros para envio via WhatsApp (E.164 sem '+').
 *
 * Regras:
 * - Remove não-dígitos
 * - Garante prefixo "55" quando houver DDD+número
 * - Se vier sem o 9 (fixo/antigo) com 8 dígitos após DDD, insere "9" (padrão celular BR)
 * - Tenta corrigir duplicação de "9" (caso raro de entrada com 10 dígitos após DDD)
 */
export function normalizeBrazilPhoneForWhatsapp(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";

  // Se já tem 55
  if (digits.startsWith("55")) {
    // 55 + DDD(2) + 8 = 12 -> inserir 9
    if (digits.length === 12) {
      return digits.slice(0, 4) + "9" + digits.slice(4);
    }
    // 55 + DDD(2) + 10 = 14 (possível 9 duplicado) -> se começar com 99 após DDD, remover um 9
    if (digits.length === 14 && digits[4] === "9" && digits[5] === "9") {
      return digits.slice(0, 4) + digits.slice(5);
    }
    return digits;
  }

  // Sem 55: pode vir como DDD+telefone
  if (digits.length === 10) {
    // DDD(2) + 8 -> inserir 9
    return "55" + digits.slice(0, 2) + "9" + digits.slice(2);
  }
  if (digits.length === 11) {
    // DDD(2) + 9
    return "55" + digits;
  }

  // Outros tamanhos: retorna como está (melhor que quebrar), mas sem caracteres.
  return digits;
}

