import crypto from "node:crypto";
import { DEPARTAMENTOS } from "./departments.js";

/** Operações de envio usadas pelo fluxo. Uma interface para facilitar testes. */
export interface WhatsAppSender {
  enviarTexto(para: string, texto: string): Promise<void>;
  enviarMenuDepartamentos(para: string, textoCorpo: string): Promise<void>;
  /** Aviso para atendente: usa template (se configurado) ou texto comum. */
  enviarAviso(para: string, texto: string): Promise<void>;
  marcarComoLida(messageId: string): Promise<void>;
}

export interface MensagemRecebida {
  id: string;
  de: string;
  nome: string | null;
  /** Texto digitado, ou o título da opção escolhida numa lista/botão. */
  texto: string;
  /** ID da opção escolhida em mensagem interativa (lista ou botão), se houver. */
  opcaoId: string | null;
  tipo: string;
}

interface ConfigWhatsApp {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
  templateAviso: string | null;
  templateIdioma: string;
}

export class WhatsAppCloudApi implements WhatsAppSender {
  constructor(private readonly cfg: ConfigWhatsApp) {}

  private async enviar(corpo: Record<string, unknown>): Promise<void> {
    const url = `https://graph.facebook.com/${this.cfg.graphVersion}/${this.cfg.phoneNumberId}/messages`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...corpo }),
    });
    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`Erro da API do WhatsApp (${resp.status}): ${detalhe}`);
    }
  }

  async enviarTexto(para: string, texto: string): Promise<void> {
    // O WhatsApp aceita até 4096 caracteres por mensagem de texto.
    for (let i = 0; i < texto.length; i += 4000) {
      await this.enviar({
        recipient_type: "individual",
        to: para,
        type: "text",
        text: { preview_url: false, body: texto.slice(i, i + 4000) },
      });
    }
  }

  async enviarMenuDepartamentos(para: string, textoCorpo: string): Promise<void> {
    await this.enviar({
      recipient_type: "individual",
      to: para,
      type: "interactive",
      interactive: {
        type: "list",
        header: { type: "text", text: "Eightvision" },
        body: { text: textoCorpo },
        footer: { text: "Ou digite o número da opção" },
        action: {
          button: "Ver departamentos",
          sections: [
            {
              title: "Departamentos",
              rows: DEPARTAMENTOS.map((d) => ({
                id: `dep:${d.id}`,
                title: `${d.opcao}. ${d.nome}`.slice(0, 24),
                description: d.descricao.slice(0, 72),
              })),
            },
          ],
        },
      },
    });
  }

  async enviarAviso(para: string, texto: string): Promise<void> {
    if (!this.cfg.templateAviso) {
      await this.enviarTexto(para, texto);
      return;
    }
    // Template com uma variável no corpo ({{1}}). Parâmetros de template não aceitam
    // quebras de linha nem muitos espaços seguidos, então o texto é achatado.
    const parametro = texto.replace(/\s*\n\s*/g, " | ").replace(/ {4,}/g, " ").slice(0, 1000);
    await this.enviar({
      to: para,
      type: "template",
      template: {
        name: this.cfg.templateAviso,
        language: { code: this.cfg.templateIdioma },
        components: [{ type: "body", parameters: [{ type: "text", text: parametro }] }],
      },
    });
  }

  async marcarComoLida(messageId: string): Promise<void> {
    await this.enviar({ status: "read", message_id: messageId });
  }
}

/** Confere a assinatura X-Hub-Signature-256 que a Meta envia em cada webhook. */
export function assinaturaValida(corpoBruto: Buffer, cabecalho: string | undefined, appSecret: string): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = crypto.createHmac("sha256", appSecret).update(corpoBruto).digest("hex");
  const recebido = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  const esperadoBuf = Buffer.from(esperado, "hex");
  if (recebido.length !== esperadoBuf.length) return false;
  return crypto.timingSafeEqual(recebido, esperadoBuf);
}

/** Extrai as mensagens recebidas de um payload de webhook da WhatsApp Cloud API. */
export function extrairMensagens(payload: any): MensagemRecebida[] {
  const resultado: MensagemRecebida[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value?.messages) continue; // eventos de status (entregue, lida...) não têm "messages"
      const nomes = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c?.wa_id && c?.profile?.name) nomes.set(c.wa_id, c.profile.name);
      }
      for (const m of value.messages) {
        let texto = "";
        let opcaoId: string | null = null;
        switch (m.type) {
          case "text":
            texto = m.text?.body ?? "";
            break;
          case "interactive":
            if (m.interactive?.type === "list_reply") {
              opcaoId = m.interactive.list_reply.id;
              texto = m.interactive.list_reply.title;
            } else if (m.interactive?.type === "button_reply") {
              opcaoId = m.interactive.button_reply.id;
              texto = m.interactive.button_reply.title;
            }
            break;
          case "button": // resposta a botão de template
            texto = m.button?.text ?? "";
            opcaoId = m.button?.payload ?? null;
            break;
          case "image":
          case "video":
          case "document":
            texto = m[m.type]?.caption ?? "";
            break;
        }
        resultado.push({
          id: m.id,
          de: m.from,
          nome: nomes.get(m.from) ?? null,
          texto,
          opcaoId,
          tipo: m.type,
        });
      }
    }
  }
  return resultado;
}
