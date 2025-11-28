/**
 * Valida se um número é brasileiro (código de país +55)
 * @param number - Número do WhatsApp com ou sem formatação
 * @returns true se o número é brasileiro, false caso contrário
 */
export const isBrazilianNumber = (number: string): boolean => {
  // Remove todos os caracteres não numéricos
  const cleanNumber = number.replace(/\D/g, "");
  
  // Número brasileiro deve ter 12 ou 13 dígitos (55 + DDD + número)
  // 12 dígitos: 55 + DDD (2) + telefone fixo (8)
  // 13 dígitos: 55 + DDD (2) + celular (9)
  if (cleanNumber.length < 12 || cleanNumber.length > 13) {
    return false;
  }
  
  // Verifica se começa com 55 (código do Brasil)
  return cleanNumber.startsWith("55");
};

/**
 * Extrai o código do país de um número
 * @param number - Número do WhatsApp
 * @returns Código do país (ex: "55", "1", "44")
 */
export const getCountryCode = (number: string): string => {
  const cleanNumber = number.replace(/\D/g, "");
  
  // Códigos de país mais comuns têm 1-3 dígitos
  // Brasil: 55, EUA: 1, Reino Unido: 44, etc.
  if (cleanNumber.length >= 2) {
    const twoDigits = cleanNumber.substring(0, 2);
    // Lista de códigos de 2 dígitos
    const twoDigitCodes = ["55", "44", "49", "33", "34", "39", "41", "43", "45", "46", "47", "48", "51", "52", "53", "54", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98"];
    
    if (twoDigitCodes.includes(twoDigits)) {
      return twoDigits;
    }
  }
  
  if (cleanNumber.length >= 1) {
    // Código de 1 dígito (EUA/Canadá)
    return cleanNumber.substring(0, 1);
  }
  
  return "";
};

/**
 * Formata mensagem de log com informações do número bloqueado
 * @param number - Número bloqueado
 * @param countryCode - Código do país
 * @returns Mensagem formatada para log
 */
export const formatBlockedNumberLog = (number: string, countryCode: string): string => {
  return `Mensagem bloqueada: número não-brasileiro (+${countryCode}) - ${number}`;
};

