# Passo a passo: configurar a WhatsApp Cloud API (Meta)

Você precisa de: uma conta no Facebook, o **Portfólio Empresarial** (Business Manager) da Eightvision e o número que será usado no atendimento.

> Os nomes dos menus da Meta mudam com frequência. Se algum item estiver diferente, procure pelo nome em inglês entre parênteses.

## 1. Criar o app

1. Acesse **https://developers.facebook.com** → **Meus apps** (My Apps) → **Criar app**.
2. Escolha o caso de uso **Conectar-se com clientes pelo WhatsApp** (ou o tipo **Empresa / Business**).
3. Vincule o app ao portfólio empresarial da Eightvision.
4. No painel do app, abra **WhatsApp → Configuração da API** (API Setup).

Nessa tela a Meta já fornece um **número de teste** e um **token temporário** (vale 24h). Com eles você já consegue testar o agente antes de usar o número oficial:
- copie o **Phone number ID** para `WHATSAPP_PHONE_NUMBER_ID`;
- copie o token temporário para `WHATSAPP_TOKEN`;
- em "Para" (To), adicione o seu celular como destinatário de teste.

## 2. Usar o número oficial da empresa

Hoje o seu número está no **app WhatsApp Business**. Há dois caminhos:

| Opção | Como funciona | Atenção |
|---|---|---|
| **Coexistência** (recomendado, se disponível para você) | Conecta o número à API **e continua usando o app WhatsApp Business** no celular. Feito pelo cadastro incorporado (Embedded Signup) de um provedor/parceiro ou pelo fluxo "conectar app WhatsApp Business" da Meta. | Disponibilidade e regras variam; confira na documentação atual da Meta. |
| **Migrar o número para a API** | Em **WhatsApp → Configuração da API → Adicionar número de telefone**. | O número **deixa de funcionar no app** WhatsApp Business (é preciso excluir a conta no app antes). O histórico de conversas do app não vai para a API. |

Se preferir não mexer no número atual agora, você pode comprar/usar um **número novo** só para o agente.

Depois de adicionar o número: confirme por SMS/ligação, aguarde a aprovação do **nome de exibição** e pegue o novo **Phone number ID**.

## 3. Token permanente

O token temporário expira em 24h. Para produção:

1. **business.facebook.com → Configurações do negócio** (Business Settings) → **Usuários → Usuários do sistema** (System users) → **Adicionar** (função Administrador).
2. Clique em **Atribuir ativos** (Assign assets): selecione o **app** e a **conta do WhatsApp** com controle total.
3. Clique em **Gerar novo token**, escolha o app, validade **Nunca** e marque as permissões:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
4. Coloque o token em `WHATSAPP_TOKEN`.

## 4. Chave secreta do app

**Configurações do app → Básico** (App settings → Basic) → **Chave secreta do app** (App secret) → `WHATSAPP_APP_SECRET`.

## 5. Cadastrar o webhook

O servidor precisa estar rodando num endereço **HTTPS público** (veja o README: hospedagem ou túnel para testes).

1. **WhatsApp → Configuração** (Configuration) → **Webhook → Editar**.
2. **URL de callback**: `https://SEU-ENDERECO/webhook`
3. **Token de verificação**: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`.
4. Clique em **Verificar e salvar**. (O log do servidor mostra "Webhook verificado pela Meta.")
5. Em **Campos do webhook**, clique em **Assinar** (Subscribe) no campo **messages**.

## 6. Template de aviso para atendentes (recomendado)

Pela regra da Meta, a empresa só pode mandar mensagem livre para alguém que falou com ela nas **últimas 24 horas**. Os atendentes vão receber avisos de novos protocolos, então crie um template:

1. **WhatsApp Manager → Modelos de mensagem** (Message templates) → **Criar modelo**.
2. Categoria **Utilidade** (Utility), nome `aviso_atendimento`, idioma **Português (BR)**.
3. Corpo: `Novo aviso do atendimento Eightvision: {{1}}`
4. Depois de aprovado, defina `WHATSAPP_TEMPLATE_AVISO=aviso_atendimento`.

Dica: se o atendente mandar qualquer mensagem para o número da empresa (por exemplo `/abertos`) a cada dia, a janela de 24h fica aberta e os avisos chegam como texto normal, mesmo sem template.

## 7. Colocar em produção

- Cadastre uma **forma de pagamento** no WhatsApp Manager (a Meta cobra por mensagens de template; as respostas aos clientes dentro da janela de 24h são gratuitas, conforme a política de preços atual).
- No app, preencha a **URL da política de privacidade** e mude o app para o modo **Publicado/Live**.
