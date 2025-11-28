# 🐛 Debug: IA para Campanhas - Erro 500

## Erro Relatado
```
failed to load resource: the server responded with a status of 500 (Internal Server Error)
Falha ao gerar mensagem.
```

## 🔍 Como Investigar

### 1. Verificar Logs do Backend

Execute o backend e tente gerar uma mensagem. Os logs agora mostrarão:

```bash
# Logs de sucesso:
🎨 Gerando mensagem inicial de campanha...
📝 Objetivo: [seu objetivo]
🔗 URL da API: [URL completa]
✅ Mensagem inicial gerada (XXX caracteres)

# Logs de erro:
❌ Erro ao gerar mensagem inicial: {
  status: XXX,
  data: {...},
  message: "...",
  url: "...",
  stack: "..."
}
```

### 2. Causas Comuns do Erro 500

#### A. API Key do Gemini não configurada
**Sintoma**: `GEMINI_KEY_MISSING`
**Solução**: 
1. Vá em Configurações → Integrações
2. Adicione sua API Key do Gemini
3. Salve e tente novamente

#### B. Modelo Gemini inválido
**Sintoma**: Status 404 ou erro sobre modelo não encontrado
**Problema**: O modelo configurado pode não existir
**Solução**:

Edite `backentd/src/config/gemini.ts`:

```typescript
// De:
export const GEMINI_MODEL = "models/gemini-2.5-flash";

// Para (modelo estável):
export const GEMINI_MODEL = "models/gemini-1.5-flash";
```

#### C. Limite de API excedido
**Sintoma**: Status 429
**Solução**: Aguarde alguns minutos antes de tentar novamente

#### D. API Key inválida
**Sintoma**: Status 403
**Solução**: Verifique se a API Key está correta no Google Cloud Console

### 3. Verificar Configuração do Gemini

```sql
-- No banco de dados, verifique se a key existe:
SELECT * FROM Settings WHERE key = 'geminiApiKey';
```

### 4. Testar API Key Manualmente

```bash
# Teste direto na API do Gemini:
curl -X POST "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=SUA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{
      "parts": [{"text": "Hello"}]
    }]
  }'
```

### 5. Verificar URL Construída

A URL deve ser:
```
https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent
```

Se estiver diferente, há um problema na configuração.

## 🔧 Correções Rápidas

### Correção 1: Trocar Modelo
Se `gemini-2.5-flash` não estiver disponível:

```typescript
// backentd/src/config/gemini.ts
export const GEMINI_MODEL = "models/gemini-1.5-flash"; // Modelo estável
```

### Correção 2: Verificar Imports

```typescript
// CampaignMessageGeneratorService.ts deve ter:
import { GEMINI_MODEL, GEMINI_BASE_URL, validateGeminiApiKey, interpretGeminiError } from "../../config/gemini";
import Setting from "../../models/Setting";
```

### Correção 3: Adicionar Timeout Maior

Se a geração está demorando muito:

```typescript
// Em CampaignMessageGeneratorService.ts, na chamada axios:
{
  timeout: 90000 // Aumentar para 90 segundos
}
```

## 📊 Comandos Úteis

```bash
# Ver logs em tempo real:
tail -f /var/log/your-app/backend.log

# Reiniciar backend:
pm2 restart backend

# Ver logs do PM2:
pm2 logs backend --lines 100
```

## 🆘 Se Nada Funcionar

1. Verifique se outras funcionalidades de IA funcionam (Dashboard, Chat)
2. Se funcionam, o problema é específico do Campaign AI
3. Se não funcionam, o problema é a configuração geral do Gemini
4. Verifique o saldo/quota da API no Google Cloud Console

## 📝 Checklist

- [ ] API Key do Gemini configurada
- [ ] Modelo Gemini correto (gemini-1.5-flash)
- [ ] Backend reiniciado após mudanças
- [ ] Logs verificados
- [ ] Outras funcionalidades de IA funcionando
- [ ] Quota da API disponível

