# Checklist de Deploy - Migração para Checkout Pro

## ✅ Implementação Concluída

### Backend
- ✅ Endpoint `/companies/create-payment-preference` criado
- ✅ Webhook modificado para criar empresa após pagamento aprovado
- ✅ Código antigo removido (processPayment, createCardToken, etc.)

### Frontend
- ✅ Páginas de callback criadas (Success, Failure, Pending)
- ✅ Rotas de callback adicionadas
- ✅ Signup simplificado (removido checkout customizado)
- ✅ Componente MercadoPagoCheckout removido

## 🚀 Passos para Deploy

### 1. Backend

```bash
# No servidor de produção
cd /caminho/do/backend

# Fazer pull das mudanças
git pull origin main

# Instalar dependências (se necessário)
npm install

# Build do TypeScript
npm run build

# Reiniciar o PM2
pm2 restart compumais-backend

# Verificar logs
pm2 logs compumais-backend
```

### 2. Frontend

```bash
# No servidor de produção
cd /caminho/do/frontend

# Fazer pull das mudanças
git pull origin main

# Instalar dependências (se necessário)
npm install

# Build do React
npm run build

# Deploy da pasta build/ (depende do seu método de deploy)
# Exemplo: copiar build/ para o servidor web
```

### 3. Verificação

Após o deploy, verificar:

1. **Backend está respondendo:**
   ```bash
   curl https://api.compuchat.cloud/companies/create-payment-preference
   # Deve retornar erro de método (POST necessário) ou validação, não 404
   ```

2. **Frontend está acessível:**
   - Acessar `/signup` e tentar criar uma conta
   - Verificar se redireciona para o checkout do Mercado Pago

3. **Webhook está funcionando:**
   - Verificar logs do PM2 após um pagamento de teste
   - Empresa deve ser criada automaticamente após pagamento aprovado

## 🔍 Troubleshooting

### Erro 404 no endpoint

**Causa:** Backend não foi atualizado ou não foi reiniciado.

**Solução:**
1. Verificar se o código foi atualizado no servidor
2. Verificar se o build foi executado (`npm run build`)
3. Verificar se o PM2 foi reiniciado
4. Verificar logs do PM2 para erros de inicialização

### Erro ao criar preferência

**Causa:** Credenciais do Mercado Pago incorretas ou variáveis de ambiente não configuradas.

**Solução:**
1. Verificar `MERCADOPAGO_ACCESS_TOKEN` no `.env`
2. Verificar `FRONTEND_URL` e `BACKEND_URL` no `.env`
3. Verificar logs do backend para detalhes do erro

### Empresa não é criada após pagamento

**Causa:** Webhook não está sendo recebido ou processado corretamente.

**Solução:**
1. Verificar se `notification_url` está configurada corretamente
2. Verificar logs do webhook no backend
3. Verificar se o webhook está registrado no painel do Mercado Pago

## 📋 Variáveis de Ambiente Necessárias

```env
# Backend
MERCADOPAGO_ACCESS_TOKEN=APP_USR_... ou TEST-...
FRONTEND_URL=https://www.compuchat.cloud
BACKEND_URL=https://api.compuchat.cloud

# Frontend (se necessário)
REACT_APP_API_URL=https://api.compuchat.cloud
```

## 🔗 URLs de Callback

As seguintes URLs devem estar acessíveis:

- `https://www.compuchat.cloud/signup/success`
- `https://www.compuchat.cloud/signup/failure`
- `https://www.compuchat.cloud/signup/pending`
- `https://api.compuchat.cloud/mercadopago/webhook`

## ✅ Teste Completo

1. Acessar `/signup`
2. Preencher dados da empresa
3. Selecionar plano
4. Clicar em "Continuar para pagamento"
5. Deve redirecionar para checkout do Mercado Pago
6. Completar pagamento (usar cartão de teste)
7. Deve redirecionar para `/signup/success`
8. Verificar se empresa foi criada no banco de dados
9. Verificar se usuário pode fazer login

