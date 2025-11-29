# 🧪 Teste de Modelos Gemini Disponíveis

## Modelos para Testar

Execute este script para descobrir qual modelo funciona:

```bash
# Teste 1: gemini-2.0-flash-exp (experimental mas rápido)
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=AIzaSyA15MsO4az9K5RAGMQXRL1fezkWEMhjlzQ" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Olá"}]}]}'

# Teste 2: gemini-1.5-flash (estável)
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AIzaSyA15MsO4az9K5RAGMQXRL1fezkWEMhjlzQ" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Olá"}]}]}'

# Teste 3: gemini-1.5-pro (mais poderoso)
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=AIzaSyA15MsO4az9K5RAGMQXRL1fezkWEMhjlzQ" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Olá"}]}]}'

# Teste 4: gemini-pro (legado)
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyA15MsO4az9K5RAGMQXRL1fezkWEMhjlzQ" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Olá"}]}]}'
```

## ✅ Respostas Esperadas

### Sucesso (Status 200):
```json
{
  "candidates": [{
    "content": {
      "parts": [{"text": "Olá! Como posso ajudar você hoje?"}]
    }
  }]
}
```

### Erro 404:
```json
{
  "error": {
    "code": 404,
    "message": "models/XXX is not found...",
    "status": "NOT_FOUND"
  }
}
```

## 📝 Configurar Modelo que Funcionar

Depois de descobrir qual modelo funciona, edite:

**backentd/src/config/gemini.ts**:
```typescript
export const GEMINI_MODEL = "MODELO_QUE_FUNCIONOU";
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
```

## 🔄 Modelos Recomendados (em ordem de preferência)

1. **gemini-2.0-flash-exp** - Mais recente e rápido
2. **gemini-1.5-flash** - Estável e confiável  
3. **gemini-1.5-pro** - Mais poderoso mas mais caro
4. **gemini-pro** - Versão legada

Teste cada um até encontrar o que funciona com sua API Key!

