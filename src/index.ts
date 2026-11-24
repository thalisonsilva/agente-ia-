import express from "express";
import { AgenteClaude } from "./agent.js";
import { carregarConfig } from "./config.js";
import { FluxoAtendimento } from "./flow.js";
import { Store } from "./store.js";
import { WhatsAppCloudApi, assinaturaValida, extrairMensagens } from "./whatsapp.js";

const config = carregarConfig();
const store = new Store(config.arquivoDados);
const whatsapp = new WhatsAppCloudApi(config.whatsapp);
const agente = new AgenteClaude(config.claude.modelo, config.claude.esforco);
const fluxo = new FluxoAtendimento(store, whatsapp, agente, {
  atendentes: config.atendentes,
  horasExpiracao: config.horasExpiracao,
});

const app = express();

// Guarda o corpo bruto para conferir a assinatura da Meta.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { corpoBruto?: Buffer }).corpoBruto = buf;
    },
  }),
);

app.get("/", (_req, res) => {
  res.send("Agente de atendimento Eightvision no ar ✅");
});

// Verificação do webhook (feita uma vez, quando você cadastra a URL no painel da Meta).
app.get("/webhook", (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const desafio = req.query["hub.challenge"];
  if (modo === "subscribe" && token === config.whatsapp.verifyToken) {
    console.log("Webhook verificado pela Meta.");
    res.status(200).send(String(desafio));
  } else {
    res.sendStatus(403);
  }
});

// Recebimento de mensagens.
app.post("/webhook", (req, res) => {
  if (config.whatsapp.appSecret) {
    const corpoBruto = (req as express.Request & { corpoBruto?: Buffer }).corpoBruto ?? Buffer.alloc(0);
    if (!assinaturaValida(corpoBruto, req.get("x-hub-signature-256"), config.whatsapp.appSecret)) {
      console.warn("Webhook com assinatura inválida recusado.");
      res.sendStatus(401);
      return;
    }
  }

  // Responde 200 na hora; a Meta reenvia o evento se demorar.
  res.sendStatus(200);

  for (const mensagem of extrairMensagens(req.body)) {
    void fluxo.processar(mensagem);
  }
});

app.listen(config.porta, () => {
  console.log(`Servidor rodando na porta ${config.porta}. Webhook: /webhook`);
  if (!config.whatsapp.appSecret) {
    console.warn("WHATSAPP_APP_SECRET não definido: a assinatura dos webhooks não está sendo conferida.");
  }
  const semAtendente = Object.entries(config.atendentes).filter(([, n]) => !n).map(([d]) => d);
  if (semAtendente.length) console.warn(`Departamentos sem atendente configurado: ${semAtendente.join(", ")}`);
});
