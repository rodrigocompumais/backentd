# Configuração do Mercado Pago

## Erro: "Unauthorized use of live credentials"

Este erro ocorre quando há incompatibilidade entre as credenciais e o tipo de cartão usado.

### Causas Comuns:

1. **Credenciais de PRODUÇÃO com cartão de TESTE**
   - Você está usando `APP_USR_...` (produção)
   - Mas está tentando processar com cartão de teste
   - **Solução**: Use credenciais de teste (`TEST_...`)

2. **Credenciais de TESTE em ambiente de PRODUÇÃO**
   - Você está usando `TEST_...` (teste)
   - Mas o ambiente está configurado como produção
   - **Solução**: Use credenciais de produção ou configure `NODE_ENV=development`

### Como Configurar Corretamente:

#### Para Desenvolvimento/Teste:

1. Acesse: https://www.mercadopago.com.br/developers/panel
2. Crie uma aplicação de **TESTE**
3. Obtenha o **Access Token de TESTE** (começa com `TEST_`)
4. Configure no `.env`:
   ```
   MERCADOPAGO_ACCESS_TOKEN=TEST_SEU_TOKEN_AQUI
   MERCADOPAGO_PUBLIC_KEY=TEST_SUA_PUBLIC_KEY_AQUI
   NODE_ENV=development
   ```

#### Para Produção:

1. Acesse: https://www.mercadopago.com.br/developers/panel
2. Crie uma aplicação de **PRODUÇÃO**
3. Obtenha o **Access Token de PRODUÇÃO** (começa com `APP_USR_`)
4. Configure no `.env`:
   ```
   MERCADOPAGO_ACCESS_TOKEN=APP_USR_SEU_TOKEN_AQUI
   MERCADOPAGO_PUBLIC_KEY=APP_USR_SUA_PUBLIC_KEY_AQUI
   NODE_ENV=production
   ```

### Cartões de Teste do Mercado Pago:

Use estes cartões APENAS com credenciais de TESTE:

**Visa Aprovado:**
- Número: `4509 9535 6623 3704`
- CVV: `123`
- Data: Qualquer data futura (ex: 12/25)
- CPF: Qualquer CPF válido

**Mastercard Aprovado:**
- Número: `5031 7557 3453 0604`
- CVV: `123`
- Data: Qualquer data futura
- CPF: Qualquer CPF válido

**Visa Recusado (para testar rejeição):**
- Número: `4012 8888 8888 1881`
- CVV: `123`

### Verificação:

Após configurar, verifique os logs ao iniciar o servidor. Você deve ver:

```
INFO: Credenciais do Mercado Pago detectadas: {
  tokenPrefix: "TEST_1234...",
  isTestToken: true,
  isProductionToken: false,
  nodeEnv: "development"
}
```

Se aparecer um aviso sobre incompatibilidade, corrija as credenciais.

