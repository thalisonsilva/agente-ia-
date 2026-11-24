import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import type { Agente } from "../src/agent.js";
import { reconhecerDepartamento } from "../src/departments.js";
import { FluxoAtendimento } from "../src/flow.js";
import { Store } from "../src/store.js";
import { assinaturaValida, extrairMensagens, type MensagemRecebida, type WhatsAppSender } from "../src/whatsapp.js";

const CLIENTE = "5511988887777";
const ATENDENTE_SUPORTE = "5511911112222";

class WhatsAppFalso implements WhatsAppSender {
  enviadas: { para: string; tipo: string; texto: string }[] = [];
  async enviarTexto(para: string, texto: string) {
    this.enviadas.push({ para, tipo: "texto", texto });
  }
  async enviarMenuDepartamentos(para: string, texto: string) {
    this.enviadas.push({ para, tipo: "menu", texto });
  }
  async enviarAviso(para: string, texto: string) {
    this.enviadas.push({ para, tipo: "aviso", texto });
  }
  async marcarComoLida() {}
  ultimaPara(para: string) {
    return this.enviadas.filter((e) => e.para === para).at(-1);
  }
}

/** IA falsa: pergunta o nome na 1ª vez e abre o protocolo quando o cliente responde. */
const agenteFalso: Agente = {
  async responder(conversa, abrirProtocolo) {
    const ultima = conversa.historico.at(-1)!.texto;
    if (ultima.startsWith("[Escolhi")) return { resposta: "Qual é o seu nome e o problema?", protocoloAberto: null };
    const numero = await abrirProtocolo({
      departamento: conversa.departamento!,
      nome_cliente: "Maria",
      assunto: "Site fora do ar",
      resumo: ultima,
      prioridade: "alta",
    });
    return { resposta: `Protocolo ${numero} aberto!`, protocoloAberto: numero };
  },
};

let contador = 0;
function msg(de: string, texto: string, opcaoId: string | null = null): MensagemRecebida {
  return { id: `wamid.${++contador}`, de, nome: "Maria", texto, opcaoId, tipo: opcaoId ? "interactive" : "text" };
}

function criarFluxo() {
  const store = new Store(null);
  const wa = new WhatsAppFalso();
  const fluxo = new FluxoAtendimento(store, wa, agenteFalso, {
    atendentes: { comercial: null, financeiro: null, suporte: ATENDENTE_SUPORTE, atendimento: null },
    horasExpiracao: 24,
  });
  return { store, wa, fluxo };
}

test("fluxo completo: menu -> departamento -> protocolo -> atendente responde -> encerra", async () => {
  const { store, wa, fluxo } = criarFluxo();

  await fluxo.processar(msg(CLIENTE, "Oi"));
  assert.equal(wa.ultimaPara(CLIENTE)?.tipo, "menu");

  await fluxo.processar(msg(CLIENTE, "3. Suporte Técnico", "dep:suporte"));
  assert.equal(wa.ultimaPara(CLIENTE)?.texto, "Qual é o seu nome e o problema?");
  assert.equal(store.obterConversa(CLIENTE)?.etapa, "triagem");

  await fluxo.processar(msg(CLIENTE, "Maria, meu site caiu"));
  const conversa = store.obterConversa(CLIENTE)!;
  assert.equal(conversa.etapa, "humano");
  assert.match(conversa.protocolo!, /^EV-\d{8}-0001$/);
  assert.match(wa.ultimaPara(CLIENTE)!.texto, /Protocolo EV-/);
  const aviso = wa.ultimaPara(ATENDENTE_SUPORTE)!;
  assert.equal(aviso.tipo, "aviso");
  assert.match(aviso.texto, /Novo atendimento — Suporte Técnico/);
  assert.match(aviso.texto, /meu site caiu/);

  // Mensagem do cliente agora vai para o atendente
  await fluxo.processar(msg(CLIENTE, "Alguma novidade?"));
  assert.match(wa.ultimaPara(ATENDENTE_SUPORTE)!.texto, /Alguma novidade\?/);

  // Atendente responde pelo número da empresa
  const p = conversa.protocolo!;
  await fluxo.processar(msg(ATENDENTE_SUPORTE, `/r ${p} Olá Maria, já estamos verificando.`));
  assert.match(wa.ultimaPara(CLIENTE)!.texto, /Suporte Técnico:\*\nOlá Maria, já estamos verificando\./);

  // Atendente encerra
  await fluxo.processar(msg(ATENDENTE_SUPORTE, `/fim ${p}`));
  assert.equal(store.obterProtocolo(p)?.status, "encerrado");
  assert.equal(store.obterConversa(CLIENTE), undefined);
  assert.match(wa.ultimaPara(CLIENTE)!.texto, /foi encerrado/);
});

test("texto que não é departamento reenvia o menu; número digitado funciona", async () => {
  const { store, wa, fluxo } = criarFluxo();
  await fluxo.processar(msg(CLIENTE, "Olá"));
  await fluxo.processar(msg(CLIENTE, "quero falar sobre um projeto"));
  assert.equal(wa.ultimaPara(CLIENTE)?.tipo, "menu");
  await fluxo.processar(msg(CLIENTE, "1"));
  assert.equal(store.obterConversa(CLIENTE)?.departamento, "comercial");
});

test("mensagem repetida (reenvio da Meta) é ignorada", async () => {
  const { wa, fluxo } = criarFluxo();
  const m = msg(CLIENTE, "Oi");
  await fluxo.processar(m);
  await fluxo.processar(m);
  assert.equal(wa.enviadas.length, 1);
});

test("atendente não pode mexer em protocolo de outro departamento", async () => {
  const { wa, fluxo } = criarFluxo();
  await fluxo.processar(msg(ATENDENTE_SUPORTE, "/fim EV-20260101-0001"));
  assert.match(wa.ultimaPara(ATENDENTE_SUPORTE)!.texto, /não encontrado/);
});

test("reconhecerDepartamento", () => {
  assert.equal(reconhecerDepartamento("2")?.id, "financeiro");
  assert.equal(reconhecerDepartamento("Técnico")?.id, "suporte");
  assert.equal(reconhecerDepartamento("geral")?.id, "atendimento");
  assert.equal(reconhecerDepartamento("banana"), undefined);
});

test("extrairMensagens e assinatura do webhook", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: CLIENTE, profile: { name: "Maria" } }],
              messages: [
                {
                  id: "wamid.X",
                  from: CLIENTE,
                  type: "interactive",
                  interactive: { type: "list_reply", list_reply: { id: "dep:suporte", title: "3. Suporte" } },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const [m] = extrairMensagens(payload);
  assert.deepEqual(m, { id: "wamid.X", de: CLIENTE, nome: "Maria", texto: "3. Suporte", opcaoId: "dep:suporte", tipo: "interactive" });

  const corpo = Buffer.from(JSON.stringify(payload));
  const assinatura = "sha256=" + crypto.createHmac("sha256", "segredo").update(corpo).digest("hex");
  assert.equal(assinaturaValida(corpo, assinatura, "segredo"), true);
  assert.equal(assinaturaValida(corpo, assinatura, "outro"), false);
  assert.equal(assinaturaValida(corpo, "sha256=zz", "segredo"), false);
  assert.equal(assinaturaValida(corpo, undefined, "segredo"), false);
});
