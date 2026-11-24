# Agente de IA da Eightvision para WhatsApp Business

Atendimento automático no WhatsApp usando a **WhatsApp Cloud API** (Meta) e o **Claude** (Anthropic).

## Como funciona

```
Cliente manda "Oi"
   │
   ▼
Menu de departamentos (lista do WhatsApp ou número digitado)
   1. Comercial   2. Financeiro   3. Suporte Técnico   4. Atendimento Geral
   │
   ▼
A IA conversa para entender a demanda e pede o nome
   │
   ▼
Gera o protocolo (ex.: EV-20261124-0001) e envia ao cliente
   │
   ▼
Avisa o atendente do departamento no WhatsApp com o resumo
   │
   ▼
Atendente responde o cliente pelo número da empresa:
   /r EV-20261124-0001 Olá! Já estou vendo seu caso.
   /fim EV-20261124-0001        (encerra e avisa o cliente)
   /abertos                     (lista protocolos abertos)
```

Enquanto o protocolo estiver aberto, as mensagens do cliente são repassadas ao atendente. A qualquer momento o cliente pode digitar **menu** para recomeçar.

## Estrutura

| Arquivo | O que faz |
|---|---|
| `src/index.ts` | Servidor web e rotas do webhook (`GET/POST /webhook`) |
| `src/flow.ts` | Fluxo do atendimento: menu, triagem, protocolo, repasse ao atendente |
| `src/agent.ts` | Integração com o Claude e o *prompt* do agente |
| `src/departments.ts` | Departamentos e o que a IA deve perguntar em cada um |
| `src/whatsapp.ts` | Envio de mensagens e leitura dos webhooks da Cloud API |
| `src/store.ts` | Conversas e protocolos (arquivo JSON em `data/`) |
| `empresa.md` | **Dados da empresa que a IA usa nas respostas — preencha!** |
| `docs/CONFIGURAR-META.md` | Passo a passo para criar o app na Meta e pegar as credenciais |
| `docs/DEPLOY-RAILWAY.md` | Passo a passo para colocar o agente na nuvem (Railway) |
| `Dockerfile`, `railway.json` | Configuração usada pela Railway para montar e rodar o agente |

## Rodar no computador

Requisitos: **Node.js 20+**.

```bash
npm install
cp .env.example .env      # preencha as variáveis
npm run dev               # inicia em http://localhost:3000
npm test                  # roda os testes
```

Para a Meta enxergar o seu computador durante os testes, use um túnel HTTPS, por exemplo:

```bash
npx cloudflared tunnel --url http://localhost:3000
# ou: ngrok http 3000
```

Use a URL gerada + `/webhook` no painel da Meta (passo 5 do guia).

## Colocar no ar (nuvem)

O projeto já vem pronto para a **Railway** (`Dockerfile` + `railway.json`).
Siga o passo a passo em **[docs/DEPLOY-RAILWAY.md](docs/DEPLOY-RAILWAY.md)**.

Ordem recomendada:
1. `docs/CONFIGURAR-META.md`, passos 1 a 4 (credenciais da Meta)
2. `docs/DEPLOY-RAILWAY.md` (sobe o agente e gera o endereço)
3. `docs/CONFIGURAR-META.md`, passos 5 a 7 (webhook, template e produção)

Os protocolos ficam em `data/banco.json`. Na Railway, esse arquivo vai para um Volume montado em `/app/data`. Para volume maior, troque o `Store` por um banco de dados (PostgreSQL, por exemplo).

## Personalizar

- **Informações da empresa:** edite `empresa.md`.
- **Departamentos e perguntas da triagem:** edite `src/departments.ts`.
- **Tom de voz e regras da IA:** edite `montarPromptFixo` em `src/agent.ts`.
- **Modelo do Claude:** `CLAUDE_MODELO` no `.env` (padrão `claude-opus-5-5`, com esforço `low` para respostas rápidas).

## Custos

- **Meta:** respostas a clientes dentro de 24h da última mensagem deles são gratuitas; mensagens de template (como o aviso aos atendentes) são cobradas. Confira a tabela atual da Metas.
  
- **Anthropic:** cobrança por tokens. O *prompt* fixo usa cache, o que deixa as mensagens seguintes mais baratas.
