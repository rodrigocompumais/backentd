# Testes de Rate Limiting

Este diretório contém os testes unitários e de integração para o sistema de rate limiting.

## Estrutura de Testes

### `rateLimit.test.ts`
Testes unitários para a configuração de rate limiting:
- Validação de configurações padrão
- Verificação de middlewares
- Testes de função helper `createCustomRateLimit`

### `rateLimit.integration.test.ts`
Testes de integração que validam o comportamento real do rate limiting:
- Rate limit geral
- Rate limit de autenticação
- Rate limit de importação
- Rate limit de webhooks
- Validação de headers
- Separação por IP

### `rateLimit.routes.test.ts` (em `routes/__tests__/`)
Testes de integração das rotas com rate limiting aplicado:
- Rotas de autenticação (login, signup)
- Rotas de importação (contatos, arquivos)
- Rotas de webhook (Gupshup, Mercado Pago)

## Como Executar os Testes

### Executar todos os testes
```bash
npm test
```

### Executar apenas testes de rate limiting
```bash
npm test -- rateLimit
```

### Executar testes com cobertura
```bash
npm test -- --coverage
```

### Executar testes em modo watch
```bash
npm test -- --watch
```

## Configuração de Testes

Os testes usam:
- **Jest** como framework de testes
- **Supertest** para testes de integração HTTP
- **ts-jest** para suporte TypeScript

## Notas Importantes

1. Os testes de integração fazem requisições reais e podem exceder os limites configurados
2. Os testes validam que o rate limiting está funcionando corretamente
3. Alguns testes podem falhar se executados muito rapidamente devido ao rate limiting real
4. Os mocks são usados apenas para controllers, não para o rate limiting em si

## Variáveis de Ambiente para Testes

Os testes usam valores padrão, mas podem ser configurados via variáveis de ambiente:

```env
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_AUTH_WINDOW_MS=900000
RATE_LIMIT_AUTH_MAX_REQUESTS=5
RATE_LIMIT_IMPORT_WINDOW_MS=3600000
RATE_LIMIT_IMPORT_MAX_REQUESTS=10
RATE_LIMIT_WEBHOOK_WINDOW_MS=60000
RATE_LIMIT_WEBHOOK_MAX_REQUESTS=100
```
