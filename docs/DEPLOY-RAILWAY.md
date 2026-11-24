# Colocar o agente na nuvem (Railway)

Depois disso o agente roda 24 horas na nuvem, sem depender do seu computador. Leva uns 15 minutos.
Custo: plano **Hobby** da Railway, cerca de **US$ 5/mês** (confira o valor atual em railway.com/pricing).

> Os nomes dos botões da Railway podem mudar um pouco. O caminho geral é sempre:
> conectar o GitHub → escolher o repositório → colar as variáveis → criar o disco → gerar o endereço.

## Antes de começar, tenha em mãos

- A **chave da Anthropic** (console.anthropic.com → API Keys).
- Da Meta: **token**, **Phone number ID** e **App secret**. Para o primeiro teste, servem o número de teste e o token temporário (passo 1 do `CONFIGURAR-META.md`).
- O **WhatsApp de cada atendente** (comercial, financeiro, suporte, atendimento geral).

## 1. Criar a conta e o projeto

1. Acesse **https://railway.com** → **Login** → **Login with GitHub** (use a mesma conta do repositório `agente-ia-`).
2. Assine o plano **Hobby** (Account → Plans), para o serviço não ser desligado.
3. Clique em **New Project** → **Deploy from GitHub repo**.
4. Se pedir, clique em **Configure GitHub App** e libere o acesso ao repositório **thalisonsilva/agente-ia-**.
5. Escolha o repositório **agente-ia-**.

## 2. Escolher a branch

O código está na branch `claude/whatsapp-business-ai-agent-mwvjlh`.

1. Clique no serviço criado → **Settings** → **Source**.
2. Em **Branch** (branch conectada), escolha **claude/whatsapp-business-ai-agent-mwvjlh**.

A Railway lê o `railway.json` e o `Dockerfile` do projeto e monta tudo sozinha.

> A primeira tentativa vai **falhar** porque as variáveis ainda não foram preenchidas. Isso é normal.

## 3. Colar as variáveis

1. No serviço, abra a aba **Variables** → **Raw Editor**.
2. Cole o bloco abaixo, preencha os valores e clique em **Update Variables**:

```env
ANTHROPIC_API_KEY=
CLAUDE_MODELO=claude-opus-5-5
CLAUDE_ESFORCO=low

WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_VERIFY_TOKEN=invente-uma-senha-longa-aqui
WHATSAPP_APP_SECRET=
WHATSAPP_GRAPH_VERSION=v23.0
WHATSAPP_TEMPLATE_AVISO=
WHATSAPP_TEMPLATE_IDIOMA=pt_BR

ATENDENTE_COMERCIAL=55DDDNUMERO
ATENDENTE_FINANCEIRO=55DDDNUMERO
ATENDENTE_SUPORTE=55DDDNUMERO
ATENDENTE_ATENDIMENTO=55DDDNUMERO

HORAS_EXPIRACAO_CONVERSA=24
ARQUIVO_DADOS=/app/data/banco.json
```

Números dos atendentes: só dígitos, com 55 e o DDD. Exemplo: `5511999990000`.

## 4. Criar o disco (para não perder os protocolos)

1. No projeto, clique com o botão direito no serviço (ou em **+ Create**) → **Volume**.
2. Ligue o volume ao serviço do agente.
3. Em **Mount path**, coloque: `/app/data`

Sem o volume, os protocolos e as conversas são apagados a cada atualização do código.

## 5. Gerar o endereço público

1. No serviço, abra **Settings** → **Networking** → **Generate Domain**.
2. Se pedir uma porta, use a que a Railway sugerir (o agente lê a porta automaticamente pela variável `PORT`). Se não sugerir nenhuma, use `3000`.
3. Você vai receber um endereço parecido com `https://agente-ia-production-xxxx.up.railway.app`.

Abra esse endereço no navegador. Deve aparecer: **Agente de atendimento Eightvision no ar ✅**

## 6. Ligar à Meta

No painel da Meta (passo 5 do `CONFIGURAR-META.md`):

- **URL de callback:** `https://SEU-ENDERECO.up.railway.app/webhook`
- **Token de verificação:** o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
- Assine o campo **messages**.

Pronto: mande "Oi" para o número do WhatsApp e o menu deve chegar.

## Manutenção

- **Ver o que está acontecendo:** aba **Deployments** → **View Logs**.
- **Mudar textos, departamentos ou dados da empresa:** edite os arquivos no GitHub (`empresa.md`, `src/departments.ts`). A Railway publica a nova versão sozinha a cada alteração na branch.
- **Trocar o token da Meta:** aba **Variables**. O serviço reinicia sozinho.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Deploy falha com "Variável de ambiente obrigatória ausente" | Falta preencher alguma variável do passo 3 |
| Meta diz que não conseguiu verificar o webhook | URL sem `/webhook` no final, ou `WHATSAPP_VERIFY_TOKEN` diferente nos dois lados |
| Cliente manda mensagem e nada acontece | Campo **messages** não assinado na Meta, ou token da Meta expirado (o temporário dura 24h) |
| Atendente não recebe o aviso do protocolo | Janela de 24h fechada: crie o template `aviso_atendimento` (passo 6 do `CONFIGURAR-META.md`) |
| Logs mostram "Webhook com assinatura inválida" | `WHATSAPP_APP_SECRET` errado |
