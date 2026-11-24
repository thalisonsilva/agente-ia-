import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DEPARTAMENTOS, buscarDepartamento, type DepartamentoId } from "./departments.js";
import type { Conversa } from "./store.js";

/** Dados que a IA coleta para abrir o protocolo. */
export const DadosProtocoloSchema = z.object({
  departamento: z.enum(["comercial", "financeiro", "suporte", "atendimento"]),
  nome_cliente: z.string().min(1),
  assunto: z.string().min(1),
  resumo: z.string().min(1),
  prioridade: z.enum(["baixa", "media", "alta"]),
});
export type DadosProtocolo = z.infer<typeof DadosProtocoloSchema>;

export interface ResultadoAgente {
  resposta: string;
  /** Preenchido quando a IA abriu um protocolo neste turno. */
  protocoloAberto: string | null;
}

/** Função que o fluxo injeta: cria o protocolo, avisa o atendente e devolve o número. */
export type AbrirProtocolo = (dados: DadosProtocolo) => Promise<string>;

/** Interface do agente, para que o fluxo possa ser testado sem chamar a API. */
export interface Agente {
  responder(conversa: Conversa, abrirProtocolo: AbrirProtocolo): Promise<ResultadoAgente>;
}

const FERRAMENTA_PROTOCOLO: Anthropic.Beta.BetaTool = {
  name: "abrir_protocolo",
  description:
    "Abre um protocolo de atendimento e encaminha o cliente para a equipe humana do departamento. " +
    "Use assim que você entender a demanda e tiver o nome do cliente e as informações essenciais " +
    "(ou quando o cliente pedir para falar com uma pessoa). Retorna o número do protocolo, que você deve informar ao cliente.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      departamento: {
        type: "string",
        enum: DEPARTAMENTOS.map((d) => d.id),
        description:
          "Departamento que vai atender. Normalmente o que o cliente escolheu; mude só se a demanda for claramente de outro.",
      },
      nome_cliente: { type: "string", description: "Nome do cliente (e da empresa, se informado)." },
      assunto: { type: "string", description: "Assunto em poucas palavras, ex.: 'Orçamento de site institucional'." },
      resumo: {
        type: "string",
        description:
          "Resumo objetivo para o atendente, com todos os detalhes coletados, para que ele não precise perguntar de novo.",
      },
      prioridade: {
        type: "string",
        enum: ["baixa", "media", "alta"],
        description: "alta = sistema parado/impede o trabalho ou cobrança vencendo hoje; media = padrão; baixa = dúvida simples.",
      },
    },
    required: ["departamento", "nome_cliente", "assunto", "resumo", "prioridade"],
  },
};

function montarPromptFixo(infoEmpresa: string): string {
  const departamentos = DEPARTAMENTOS.map((d) => `- ${d.nome} (${d.id}): ${d.orientacaoIA}`).join("\n");
  return `Você é a assistente virtual de atendimento da Eightvision, empresa de tecnologia (site: www.eightvision.com.br), e conversa com clientes pelo WhatsApp.

Seu trabalho em cada conversa:
1. O cliente já escolheu um departamento no menu. Entenda o que ele precisa, fazendo uma ou duas perguntas por vez.
2. Colete o nome do cliente e as informações essenciais para o departamento (orientações abaixo).
3. Quando tiver o suficiente, chame a ferramenta abrir_protocolo. Não espere ter tudo perfeito: se o cliente já explicou a demanda e deu o nome, abra o protocolo.
4. Depois de abrir, informe ao cliente o número do protocolo, diga que ele foi encaminhado para a equipe do departamento e que uma pessoa vai continuar o atendimento por aqui mesmo.

Se o cliente pedir para falar com um humano, peça só o nome (se ainda não tiver) e abra o protocolo.
Responda dúvidas simples sobre a empresa usando apenas as informações abaixo. Não invente preços, prazos, políticas ou serviços que não estejam aqui; nesses casos, diga que a equipe vai confirmar e abra o protocolo.

Estilo: português do Brasil, cordial e direto, mensagens curtas próprias de WhatsApp (no máximo 3 parágrafos curtos). Use *negrito* do WhatsApp com moderação e não use títulos Markdown (#) nem tabelas. No máximo um emoji por mensagem.
Segurança: nunca peça senhas, códigos de verificação ou dados completos de cartão. Se o cliente enviar algo assim, oriente-o a não compartilhar.

Departamentos e o que coletar em cada um:
${departamentos}

Informações da empresa:
${infoEmpresa}`;
}

export class AgenteClaude implements Agente {
  private readonly client: Anthropic;
  private readonly promptFixo: string;

  constructor(
    private readonly modelo: string,
    private readonly esforco: "low" | "medium" | "high" | "xhigh" | "max",
    arquivoEmpresa = "./empresa.md",
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
    const info = fs.existsSync(arquivoEmpresa)
      ? fs.readFileSync(arquivoEmpresa, "utf8")
      : "(Informações da empresa ainda não cadastradas. Preencha o arquivo empresa.md.)";
    this.promptFixo = montarPromptFixo(info);
  }

  async responder(conversa: Conversa, abrirProtocolo: AbrirProtocolo): Promise<ResultadoAgente> {
    const departamento = buscarDepartamento(conversa.departamento ?? "atendimento")!;
    const contexto =
      `Departamento escolhido pelo cliente: ${departamento.nome} (${departamento.id}).\n` +
      `Nome no perfil do WhatsApp: ${conversa.nome ?? "não informado"} (confirme o nome antes de abrir o protocolo, se não tiver certeza).\n` +
      `Telefone do cliente: ${conversa.cliente}.`;

    const mensagens: Anthropic.Beta.BetaMessageParam[] = conversa.historico.map((m) => ({
      role: m.papel === "cliente" ? "user" : "assistant",
      content: m.texto,
    }));

    let protocoloAberto: string | null = null;

    for (let iteracao = 0; iteracao < 5; iteracao++) {
      const resposta = await this.client.beta.messages.create({
        model: this.modelo,
        max_tokens: 16000,
        // Se o modelo recusar por política de segurança, a API refaz a resposta com outro modelo.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: this.esforco },
        system: [
          // Parte fixa em cache (mais barato e mais rápido a partir da 2ª mensagem).
          { type: "text", text: this.promptFixo, cache_control: { type: "ephemeral" } },
          { type: "text", text: contexto },
        ],
        tools: [FERRAMENTA_PROTOCOLO],
        messages: mensagens,
      });

      if (resposta.stop_reason === "refusal") {
        return {
          resposta: "Desculpe, não consigo ajudar com isso por aqui. Se quiser, digite *menu* para recomeçar.",
          protocoloAberto,
        };
      }

      const chamadas = resposta.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );

      if (resposta.stop_reason !== "tool_use" || chamadas.length === 0) {
        const texto = resposta.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return { resposta: texto, protocoloAberto };
      }

      mensagens.push({ role: "assistant", content: resposta.content });

      const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const chamada of chamadas) {
        resultados.push(await this.executarFerramenta(chamada, protocoloAberto, abrirProtocolo, (n) => (protocoloAberto = n)));
      }
      mensagens.push({ role: "user", content: resultados });
    }

    return {
      resposta: protocoloAberto
        ? `Seu protocolo é *${protocoloAberto}*. Nossa equipe vai continuar o atendimento por aqui.`
        : "Desculpe, tive um problema para concluir. Pode repetir, por favor?",
      protocoloAberto,
    };
  }

  private async executarFerramenta(
    chamada: Anthropic.Beta.BetaToolUseBlock,
    protocoloAberto: string | null,
    abrirProtocolo: AbrirProtocolo,
    definirProtocolo: (numero: string) => void,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    if (chamada.name !== "abrir_protocolo") {
      return { type: "tool_result", tool_use_id: chamada.id, is_error: true, content: `Ferramenta desconhecida: ${chamada.name}` };
    }
    if (protocoloAberto) {
      return {
        type: "tool_result",
        tool_use_id: chamada.id,
        content: `O protocolo ${protocoloAberto} já foi aberto nesta conversa. Não abra outro.`,
      };
    }
    const dados = DadosProtocoloSchema.safeParse(chamada.input);
    if (!dados.success) {
      return {
        type: "tool_result",
        tool_use_id: chamada.id,
        is_error: true,
        content: `Dados inválidos: ${dados.error.message}`,
      };
    }
    try {
      const numero = await abrirProtocolo(dados.data);
      definirProtocolo(numero);
      return {
        type: "tool_result",
        tool_use_id: chamada.id,
        content: `Protocolo aberto: ${numero}. A equipe de ${buscarDepartamento(dados.data.departamento)!.nome} foi avisada.`,
      };
    } catch (erro) {
      console.error("Falha ao abrir protocolo:", erro);
      return {
        type: "tool_result",
        tool_use_id: chamada.id,
        is_error: true,
        content: "Não foi possível abrir o protocolo agora. Peça desculpas e diga que a equipe vai entrar em contato.",
      };
    }
  }
}

export function departamentoValido(id: string): id is DepartamentoId {
  return DEPARTAMENTOS.some((d) => d.id === id);
}
