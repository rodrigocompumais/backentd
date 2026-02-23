/**
 * Normaliza números brasileiros para envio via WhatsApp (E.164 sem '+').
 *
 * Regras:
 * - Remove não-dígitos
 * - Garante prefixo "55" quando houver DDD+número
 * - Se vier com 8 dígitos após o DDD, **não inventa dígitos** quando já começa com 9
 * - Opcionalmente insere "9" apenas em casos prováveis de celular antigo (8 dígitos iniciando com 6/7/8)
 * - Tenta corrigir duplicação de "9" (caso raro)
 */
export function normalizeBrazilPhoneForWhatsapp(raw: string): string {
  // #region agent log
  const logData = {raw,digitsLength: String(raw || "").replace(/\D/g, "").length};
  fetch('http://127.0.0.1:7242/ingest/654d036a-7e93-40a5-be06-4549cdbdbbac',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NormalizeBrazilPhone.ts:11',message:'normalizeBrazilPhoneForWhatsapp called',data:logData,timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";

  // Se já tem 55
  if (digits.startsWith("55")) {
    // 55 + DDD(2) + 8 = 12 -> pode ser fixo (2-5) ou celular antigo (6-8). Se já começa com 9, não inserir.
    // CORREÇÃO: Não adicionar "9" para números de 12 dígitos que já são válidos.
    // Números de 12 dígitos com 55 + DDD + 8 dígitos são válidos como estão.
    if (digits.length === 12) {
      // Números de 12 dígitos já estão no formato correto (55 + DDD + 8 dígitos)
      // Não modificar números de 12 dígitos, pois podem ser telefones fixos ou celulares antigos válidos
      return digits;
    }
    // Se tem 14 dígitos, remover o 5º dígito (índice 4)
    // Formato: 55 + DDD(2) + 9(duplicado) + número(9) = 14 dígitos
    // Exemplo: 5534999999999 -> 553499999999 (remove o 5º dígito)
    if (digits.length === 14) {
      const normalized = digits.slice(0, 4) + digits.slice(5);
      // Garantir que o resultado não está vazio
      return normalized.length > 0 ? normalized : digits;
    }
    // Se tem 13 dígitos, verificar se há um dígito extra após o DDD
    // Números brasileiros válidos: 55 + DDD(2) + número(8 ou 9) = 12 ou 13 dígitos
    // Se tiver 13 dígitos e o 5º dígito (após o DDD) for 9, pode ser um 9 duplicado.
    // Remover o 5º dígito se o número resultante tiver 8 ou 9 dígitos válidos após o DDD.
    if (digits.length === 13) {
      const numberAfterDdd = digits.slice(4); // Número após DDD (9 dígitos)
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/654d036a-7e93-40a5-be06-4549cdbdbbac',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NormalizeBrazilPhone.ts:39',message:'Checking 13 digits',data:{raw,digits,digitsLength:digits.length,numberAfterDdd,numberAfterDddLength:numberAfterDdd.length,fifthDigit:digits[4],fifthDigitIs9:digits[4]==='9'},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      // Se o número após DDD tem 9 dígitos e o 5º dígito (índice 4) é 9,
      // pode ser um 9 duplicado. Remover o 5º dígito.
      if (numberAfterDdd.length === 9 && digits[4] === "9") {
        const withoutFifth = digits.slice(0, 4) + digits.slice(5);
        const numberAfterDddWithoutFifth = withoutFifth.slice(4);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/654d036a-7e93-40a5-be06-4549cdbdbbac',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NormalizeBrazilPhone.ts:44',message:'Removing 5th digit from 13 digits',data:{raw,digits,withoutFifth,numberAfterDddWithoutFifth,numberAfterDddWithoutFifthLength:numberAfterDddWithoutFifth.length,willReturn:numberAfterDddWithoutFifth.length >= 8 && numberAfterDddWithoutFifth.length <= 9},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        // Se após remover ficar com 8 ou 9 dígitos válidos, usar esse formato
        if (numberAfterDddWithoutFifth.length >= 8 && numberAfterDddWithoutFifth.length <= 9) {
          return withoutFifth;
        }
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/654d036a-7e93-40a5-be06-4549cdbdbbac',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NormalizeBrazilPhone.ts:53',message:'Returning original 13 digits',data:{raw,digits,result:digits},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      return digits;
    }
    return digits;
  }

  // Sem 55: pode vir como DDD+telefone
  if (digits.length === 10) {
    const local8 = digits.slice(2);
    const first = local8[0];
    if (first === "9") return "55" + digits;
    if (first === "6" || first === "7" || first === "8") {
      return "55" + digits.slice(0, 2) + "9" + digits.slice(2);
    }
    return "55" + digits;
  }
  if (digits.length === 11) {
    // DDD(2) + 9
    return "55" + digits;
  }

  // Outros tamanhos: retorna como está (melhor que quebrar), mas sem caracteres.
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/654d036a-7e93-40a5-be06-4549cdbdbbac',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'NormalizeBrazilPhone.ts:74',message:'normalizeBrazilPhoneForWhatsapp returning final result',data:{raw,digits,result:digits},timestamp:Date.now(),runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  return digits;
}

