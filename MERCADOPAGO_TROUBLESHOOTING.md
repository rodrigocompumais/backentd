# Guia de Troubleshooting - Mercado Pago

Este guia ajuda a diagnosticar e resolver problemas comuns relacionados à integração do Mercado Pago.

## Índice

1. [Verificação Rápida](#verificação-rápida)
2. [Erros Comuns](#erros-comuns)
3. [Como Verificar Credenciais](#como-verificar-credenciais)
4. [Como Testar Integração](#como-testar-integração)
5. [Diagnóstico Automático](#diagnóstico-automático)

## Verificação Rápida

### 1. Verificar Variáveis de Ambiente

Certifique-se de que as seguintes variáveis estão configuradas no arquivo `.env`:

```bash
MERCADOPAGO_ACCESS_TOKEN=TEST_SEU_TOKEN_AQUI  # ou APP_USR_SEU_TOKEN_AQUI para produção
MERCADOPAGO_PUBLIC_KEY=TEST_SUA_PUBLIC_KEY_AQUI  # ou APP_USR_SUA_PUBLIC_KEY_AQUI
NODE_ENV=development  # ou production
```

### 2. Verificar Formato do Token

- **Teste**: Deve começar com `TEST_`
- **Produção**: Deve começar com `APP_USR_`

### 3. Verificar Compatibilidade

- **Desenvolvimento**: Use credenciais de teste (`TEST_...`)
- **Produção**: Use credenciais de produção (`APP_USR_...`)

## Erros Comuns

### Erro: "Unauthorized use of live credentials"

**Causa**: Incompatibilidade entre tipo de credencial e ambiente.

**Soluções**:
1. Se estiver em desenvolvimento, use credenciais de teste (`TEST_...`)
2. Se estiver em produção, use credenciais de produção (`APP_USR_...`)
3. Verifique se `NODE_ENV` está configurado corretamente

**Como verificar**:
```bash
# Verificar tipo de token
echo $MERCADOPAGO_ACCESS_TOKEN | cut -c1-10

# Verificar ambiente
echo $NODE_ENV
```

### Erro: "Bin not found"

**Causa**: Token do cartão inválido ou número do cartão incorreto.

**Soluções**:
1. Verifique se o número do cartão está correto
2. Recrie o token do cartão
3. Se estiver usando cartão de teste, certifique-se de usar um cartão válido do Mercado Pago

**Cartões de teste válidos**:
- Visa: `4509 9535 6623 3704` (CVV: 123)
- Mastercard: `5031 7557 3453 0604` (CVV: 123)

### Erro: "Different parameters for the bin"

**Causa**: Dados do cartão não correspondem ao BIN detectado.

**Soluções**:
1. Verifique se o número do cartão está correto
2. Verifique se a bandeira do cartão está correta
3. Tente com outro cartão

### Erro: "Token do cartão inválido"

**Causa**: Token expirado ou formato inválido.

**Soluções**:
1. Recrie o token do cartão
2. Verifique se o token não está expirado
3. Certifique-se de que o token foi gerado corretamente

### Erro: "MERCADOPAGO_ACCESS_TOKEN não configurado"

**Causa**: Variável de ambiente não está configurada.

**Soluções**:
1. Adicione `MERCADOPAGO_ACCESS_TOKEN` no arquivo `.env`
2. Reinicie o servidor após adicionar a variável
3. Verifique se o arquivo `.env` está sendo carregado corretamente

## Como Verificar Credenciais

### 1. Usando o Endpoint de Diagnóstico

Faça uma requisição GET para:
```
GET /diagnostic/mercadopago
```

Resposta esperada:
```json
{
  "status": "configurado",
  "credentials": {
    "type": "TESTE",
    "prefix": "TEST_1234567...",
    "configured": true,
    "length": 32
  },
  "environment": {
    "nodeEnv": "development",
    "isProduction": false
  },
  "compatibility": {
    "valid": true,
    "warning": false,
    "error": false
  },
  "recommendations": [],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Verificando Logs do Servidor

Ao iniciar o servidor, você deve ver logs como:

```
INFO: Credenciais do Mercado Pago detectadas: {
  tokenPrefix: "TEST_1234...",
  isTestToken: true,
  isProductionToken: false,
  nodeEnv: "development"
}
```

### 3. Verificando Variáveis de Ambiente

```bash
# No servidor
echo $MERCADOPAGO_ACCESS_TOKEN | cut -c1-15
echo $NODE_ENV
```

## Como Testar Integração

### 1. Testar com Cartão de Teste

Use os seguintes dados para testar:

**Visa Aprovado**:
- Número: `4509 9535 6623 3704`
- CVV: `123`
- Data: Qualquer data futura (ex: 12/25)
- CPF: Qualquer CPF válido (ex: 12345678909)

**Mastercard Aprovado**:
- Número: `5031 7557 3453 0604`
- CVV: `123`
- Data: Qualquer data futura
- CPF: Qualquer CPF válido

### 2. Testar Endpoint de Diagnóstico

```bash
curl http://localhost:3000/diagnostic/mercadopago
```

### 3. Verificar Logs Durante Teste

Ao processar um pagamento, verifique os logs para:
- Tipo de credencial sendo usada
- Erros detalhados (se houver)
- Status do processamento

## Diagnóstico Automático

O sistema agora inclui diagnóstico automático que:

1. **Valida credenciais antes de processar**: Evita erros desnecessários
2. **Loga erros detalhados**: Facilita identificação de problemas
3. **Fornece recomendações**: Sugere soluções específicas

### Como Usar

1. **Endpoint de Diagnóstico**: `GET /diagnostic/mercadopago`
2. **Logs Detalhados**: Verifique os logs do servidor ao processar pagamentos
3. **Validação Preventiva**: Erros são detectados antes do processamento

## Checklist de Troubleshooting

Antes de reportar um problema, verifique:

- [ ] `MERCADOPAGO_ACCESS_TOKEN` está configurado
- [ ] Token começa com `TEST_` (desenvolvimento) ou `APP_USR_` (produção)
- [ ] `NODE_ENV` está configurado corretamente
- [ ] Credenciais são compatíveis com o ambiente
- [ ] Cartão de teste é válido (se estiver testando)
- [ ] Token do cartão não está expirado
- [ ] Logs do servidor foram verificados
- [ ] Endpoint de diagnóstico foi consultado

## Suporte Adicional

Se o problema persistir:

1. Consulte os logs detalhados do servidor
2. Use o endpoint de diagnóstico para obter informações
3. Verifique a documentação oficial do Mercado Pago: https://www.mercadopago.com.br/developers/pt/docs

## Arquivos Relacionados

- `MERCADOPAGO_SETUP.md`: Guia de configuração inicial
- `backentd/src/services/PaymentService/MercadoPagoService.ts`: Serviço principal
- `backentd/src/middleware/validateMercadoPago.ts`: Middleware de validação

