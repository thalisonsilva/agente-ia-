import type { Agente, DadosProtocolo } from "./agent.js";
import { DEPARTAMENTOS, buscarDepartamento, reconhecerDepartamento, type DepartamentoId } from "./departments.js";
import type { Conversa, Protocolo, Store } from "./store.js";
import type { MensagemRecebida, WhatsAppSender } from "./whatsapp.js";

export interface OpcoesFluxo {
  atendentes: Record<DepartamentoId, string | null>;
  horasExpiracao: number;
}

const PALAVRAS_MENU = new Set(["menu", "inicio", "início", "voltar", "recomecar", "recomeçar"]);
const LIMITE_HISTORICO = 40;

const TEXTO_BOAS_VINDAS = (nome: string | null) =>
  `Olá${nome ? `, ${nome}` : ""}! 👋 Bem-vindo(a) à *Eightvision*.\n\n` +
  `Sou a assistente virtual e vou direcionar o seu atendimento. Escolha o departamento:\n\n` +
  DEPARTAMENTOS.map((d) => `${d.opcao}. ${d.nome}`).join("\n");

/** Orquestra o atendimento: menu de departamentos -> triagem com IA -> protocolo -> atendente humano. */
export class FluxoAtendimento {
  private readonly processadas = new Set<string>();
  private readonly filas = new Map<string, Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly whatsapp: WhatsAppSender,
    private readonly agente: Agente,
    private readonly opcoes: OpcoesFluxo,
  ) {}

  /** Processa as mensagens de um mesmo número em ordem, uma por vez. */
  processar(msg: MensagemRecebida): Promise<void> {
    // A Meta pode reenviar o mesmo webhook; ignora mensagens repetidas.
    if (this.processadas.has(msg.id)) return Promise.resolve();
    this.processadas.add(msg.id);
    if (this.processadas.size > 5000) {
      this.processadas.delete(this.processadas.values().next().value!);
    }

    const anterior = this.filas.get(msg.de) ?? Promise.resolve();
    const atual = anterior
      .then(() => this.tratar(msg))
      .catch((erro) => console.error(`Erro ao processar mensagem de ${msg.de}:`, erro));
    this.filas.set(msg.de, atual);
    void atual.finally(() => {
      if (this.filas.get(msg.de) === atual) this.filas.delete(msg.de);
    });
    return atual;
  }

  private async tratar(msg: MensagemRecebida): Promise<void> {
    this.whatsapp.marcarComoLida(msg.id).catch(() => {});
    const departamentosDoAtendente = this.departamentosDoAtendente(msg.de);
    if (departamentosDoAtendente.length > 0) {
      await this.tratarAtendente(msg, departamentosDoAtendente);
    } else {
      await this.tratarCliente(msg);
    }
  }

  // ---------------------------------------------------------------- cliente

  private async tratarCliente(msg: MensagemRecebida): Promise<void> {
    let conversa = this.store.obterConversa(msg.de);
    if (conversa && this.expirou(conversa)) {
      this.store.removerConversa(msg.de);
      conversa = undefined;
    }

    const texto = msg.texto.trim();
    const pediuMenu = PALAVRAS_MENU.has(texto.toLowerCase());

    if (!conversa || pediuMenu) {
      if (conversa?.etapa === "humano" && conversa.protocolo) {
        await this.avisarAtendente(
          conversa.departamento!,
          `ℹ️ O cliente do protocolo *${conversa.protocolo}* voltou ao menu inicial. O protocolo continua aberto.`,
        );
      }
      conversa = {
        cliente: msg.de,
        nome: msg.nome,
        etapa: "escolhendo_departamento",
        departamento: null,
        historico: texto && !pediuMenu ? [{ papel: "cliente", texto }] : [],
        protocolo: null,
        atualizadaEm: "",
      };
      this.store.salvarConversa(conversa);
      await this.whatsapp.enviarMenuDepartamentos(msg.de, TEXTO_BOAS_VINDAS(msg.nome));
      return;
    }

    if (msg.nome) conversa.nome = msg.nome;

    switch (conversa.etapa) {
      case "escolhendo_departamento":
        return this.tratarEscolha(conversa, msg);
      case "triagem":
        return this.tratarTriagem(conversa, msg);
      case "humano":
        return this.repassarParaAtendente(conversa, msg);
    }
  }

  private async tratarEscolha(conversa: Conversa, msg: MensagemRecebida): Promise<void> {
    const escolhido = msg.opcaoId?.startsWith("dep:")
      ? buscarDepartamento(msg.opcaoId.slice(4))
      : reconhecerDepartamento(msg.texto);

    if (!escolhido) {
      if (msg.texto.trim()) this.adicionarHistorico(conversa, "cliente", msg.texto.trim());
      this.store.salvarConversa(conversa);
      await this.whatsapp.enviarMenuDepartamentos(
        msg.de,
        "Para eu direcionar seu atendimento, escolha um dos departamentos abaixo (toque em *Ver departamentos* ou digite o número):",
      );
      return;
    }

    conversa.departamento = escolhido.id;
    conversa.etapa = "triagem";
    this.adicionarHistorico(conversa, "cliente", `[Escolhi no menu o departamento: ${escolhido.nome}]`);
    await this.responderComIA(conversa);
  }

  private async tratarTriagem(conversa: Conversa, msg: MensagemRecebida): Promise<void> {
    if (!msg.texto.trim()) {
      await this.whatsapp.enviarTexto(
        msg.de,
        "No momento consigo ler apenas mensagens de texto. Pode escrever o que você precisa, por favor? 🙏",
      );
      return;
    }
    this.adicionarHistorico(conversa, "cliente", msg.texto.trim());
    await this.responderComIA(conversa);
  }

  private async responderComIA(conversa: Conversa): Promise<void> {
    try {
      const resultado = await this.agente.responder(conversa, (dados) => this.abrirProtocolo(conversa, dados));
      const resposta =
        resultado.resposta ||
        (resultado.protocoloAberto
          ? `Seu protocolo é *${resultado.protocoloAberto}*. Nossa equipe vai continuar o atendimento por aqui.`
          : "Pode me contar um pouco mais, por favor?");
      this.adicionarHistorico(conversa, "agente", resposta);
      this.store.salvarConversa(conversa);
      await this.whatsapp.enviarTexto(conversa.cliente, resposta);
    } catch (erro) {
      console.error("Erro ao consultar a IA:", erro);
      this.store.salvarConversa(conversa);
      await this.whatsapp.enviarTexto(
        conversa.cliente,
        "Desculpe, tive uma instabilidade agora. Pode enviar sua mensagem de novo em instantes?",
      );
    }
  }

  private async abrirProtocolo(conversa: Conversa, dados: DadosProtocolo): Promise<string> {
    const numero = this.store.proximoNumeroProtocolo();
    const protocolo: Protocolo = {
      numero,
      cliente: conversa.cliente,
      nomeCliente: dados.nome_cliente,
      departamento: dados.departamento,
      assunto: dados.assunto,
      resumo: dados.resumo,
      prioridade: dados.prioridade,
      status: "aberto",
      criadoEm: new Date().toISOString(),
      encerradoEm: null,
    };
    this.store.salvarProtocolo(protocolo);

    conversa.protocolo = numero;
    conversa.departamento = dados.departamento;
    conversa.etapa = "humano";
    this.store.salvarConversa(conversa);

    const departamento = buscarDepartamento(dados.departamento)!;
    const prioridade = { baixa: "🟢 baixa", media: "🟡 média", alta: "🔴 alta" }[dados.prioridade];
    await this.avisarAtendente(
      dados.departamento,
      `🆕 *Novo atendimento — ${departamento.nome}*\n` +
        `Protocolo: *${numero}*\n` +
        `Cliente: ${dados.nome_cliente}\n` +
        `WhatsApp: +${conversa.cliente} (https://wa.me/${conversa.cliente})\n` +
        `Prioridade: ${prioridade}\n` +
        `Assunto: ${dados.assunto}\n\n` +
        `${dados.resumo}\n\n` +
        `Para responder pelo número da empresa:\n/r ${numero} sua mensagem\n` +
        `Para encerrar: /fim ${numero}`,
    );
    return numero;
  }

  private async repassarParaAtendente(conversa: Conversa, msg: MensagemRecebida): Promise<void> {
    const conteudo = msg.texto.trim() || `[o cliente enviou um(a) ${msg.tipo}; veja direto no WhatsApp: https://wa.me/${conversa.cliente}]`;
    const temAtendente = Boolean(this.opcoes.atendentes[conversa.departamento!]);
    this.store.salvarConversa(conversa);
    if (!temAtendente) {
      await this.whatsapp.enviarTexto(
        msg.de,
        `Recebemos sua mensagem no protocolo *${conversa.protocolo}*. Nossa equipe vai responder assim que possível.`,
      );
      return;
    }
    await this.avisarAtendente(
      conversa.departamento!,
      `📩 *${conversa.protocolo}* — ${conversa.nome ?? "+" + conversa.cliente}:\n${conteudo}\n\n(responda com /r ${conversa.protocolo} sua mensagem)`,
    );
  }

  // -------------------------------------------------------------- atendente

  private async tratarAtendente(msg: MensagemRecebida, departamentos: DepartamentoId[]): Promise<void> {
    const texto = msg.texto.trim();
    const [comando = "", argumento = "", ...resto] = texto.split(/\s+/);
    const cmd = comando.toLowerCase();

    if (cmd === "/abertos") {
      const abertos = departamentos.flatMap((d) => this.store.listarProtocolosAbertos(d));
      await this.whatsapp.enviarTexto(
        msg.de,
        abertos.length
          ? "*Protocolos abertos:*\n" +
              abertos.map((p) => `• ${p.numero} — ${p.nomeCliente} — ${p.assunto}`).join("\n")
          : "Nenhum protocolo aberto no momento. ✅",
      );
      return;
    }

    if (cmd === "/r" || cmd === "/responder" || cmd === "/fim" || cmd === "/encerrar") {
      const protocolo = this.store.obterProtocolo(argumento);
      if (!protocolo || !departamentos.includes(protocolo.departamento)) {
        await this.whatsapp.enviarTexto(msg.de, `Protocolo "${argumento}" não encontrado no(s) seu(s) departamento(s).`);
        return;
      }
      if (protocolo.status !== "aberto") {
        await this.whatsapp.enviarTexto(msg.de, `O protocolo ${protocolo.numero} já está encerrado.`);
        return;
      }

      if (cmd === "/r" || cmd === "/responder") {
        // Preserva quebras de linha: pega tudo depois do número do protocolo.
        const inicio = texto.toUpperCase().indexOf(protocolo.numero) + protocolo.numero.length;
        const resposta = texto.slice(inicio).trim();
        if (!resposta || resto.length === 0) {
          await this.whatsapp.enviarTexto(msg.de, `Escreva a mensagem depois do protocolo. Ex.: /r ${protocolo.numero} Olá!`);
          return;
        }
        const nomeDep = buscarDepartamento(protocolo.departamento)!.nome;
        await this.whatsapp.enviarTexto(protocolo.cliente, `*Eightvision — ${nomeDep}:*\n${resposta}`);
        await this.whatsapp.enviarTexto(msg.de, `✅ Enviado para ${protocolo.nomeCliente} (${protocolo.numero}).`);
        return;
      }

      protocolo.status = "encerrado";
      protocolo.encerradoEm = new Date().toISOString();
      this.store.salvarProtocolo(protocolo);
      const conversa = this.store.obterConversa(protocolo.cliente);
      if (conversa?.protocolo === protocolo.numero) this.store.removerConversa(protocolo.cliente);
      await this.whatsapp.enviarTexto(
        protocolo.cliente,
        `Seu atendimento de protocolo *${protocolo.numero}* foi encerrado. Obrigado por falar com a Eightvision! 💙\n` +
          `Se precisar de algo mais, é só mandar uma mensagem.`,
      );
      await this.whatsapp.enviarTexto(msg.de, `✅ Protocolo ${protocolo.numero} encerrado e cliente avisado.`);
      return;
    }

    await this.whatsapp.enviarTexto(
      msg.de,
      "*Comandos do atendente:*\n" +
        "/abertos — lista os protocolos abertos\n" +
        "/r PROTOCOLO mensagem — responde o cliente pelo número da empresa\n" +
        "/fim PROTOCOLO — encerra o atendimento",
    );
  }

  // ---------------------------------------------------------------- apoio

  private departamentosDoAtendente(numero: string): DepartamentoId[] {
    return DEPARTAMENTOS.filter((d) => this.opcoes.atendentes[d.id] === numero).map((d) => d.id);
  }

  private async avisarAtendente(departamento: DepartamentoId, texto: string): Promise<void> {
    const numero = this.opcoes.atendentes[departamento];
    if (!numero) {
      console.warn(`[aviso] Nenhum atendente configurado para ${departamento}. Mensagem:\n${texto}`);
      return;
    }
    try {
      await this.whatsapp.enviarAviso(numero, texto);
    } catch (erro) {
      // Não interrompe o atendimento do cliente se o aviso falhar (ex.: janela de 24h fechada sem template).
      console.error(`Falha ao avisar o atendente de ${departamento}:`, erro);
    }
  }

  private adicionarHistorico(conversa: Conversa, papel: "cliente" | "agente", texto: string): void {
    conversa.historico.push({ papel, texto });
    if (conversa.historico.length > LIMITE_HISTORICO) {
      conversa.historico = conversa.historico.slice(-LIMITE_HISTORICO);
      // A API exige que a conversa comece com mensagem do cliente.
      while (conversa.historico[0]?.papel === "agente") conversa.historico.shift();
    }
  }

  private expirou(conversa: Conversa): boolean {
    const idadeMs = Date.now() - new Date(conversa.atualizadaEm).getTime();
    return idadeMs > this.opcoes.horasExpiracao * 3600 * 1000;
  }
}
