import fs from "node:fs";
import path from "node:path";
import type { DepartamentoId } from "./departments.js";

export type Etapa =
  /** Menu enviado, aguardando o cliente escolher o departamento. */
  | "escolhendo_departamento"
  /** A IA está conversando para entender a demanda. */
  | "triagem"
  /** Protocolo gerado; mensagens do cliente vão para o atendente humano. */
  | "humano";

export interface MensagemHistorico {
  papel: "cliente" | "agente";
  texto: string;
}

export interface Conversa {
  cliente: string; // wa_id (número do cliente)
  nome: string | null;
  etapa: Etapa;
  departamento: DepartamentoId | null;
  historico: MensagemHistorico[];
  protocolo: string | null;
  atualizadaEm: string;
}

export interface Protocolo {
  numero: string;
  cliente: string;
  nomeCliente: string;
  departamento: DepartamentoId;
  assunto: string;
  resumo: string;
  prioridade: "baixa" | "media" | "alta";
  status: "aberto" | "encerrado";
  criadoEm: string;
  encerradoEm: string | null;
}

interface Dados {
  conversas: Record<string, Conversa>;
  protocolos: Record<string, Protocolo>;
  /** Contador de protocolos por dia: { "20261124": 3 } */
  contadores: Record<string, number>;
}

/**
 * Armazenamento simples em arquivo JSON. Suficiente para começar com um único servidor.
 * Para volume maior ou vários servidores, troque por um banco (PostgreSQL, Redis etc.)
 * mantendo os mesmos métodos.
 */
export class Store {
  private dados: Dados;

  constructor(private readonly arquivo: string | null) {
    this.dados = { conversas: {}, protocolos: {}, contadores: {} };
    if (arquivo && fs.existsSync(arquivo)) {
      this.dados = { ...this.dados, ...JSON.parse(fs.readFileSync(arquivo, "utf8")) };
    }
  }

  private salvar(): void {
    if (!this.arquivo) return;
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = `${this.arquivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.dados, null, 2));
    fs.renameSync(tmp, this.arquivo);
  }

  obterConversa(cliente: string): Conversa | undefined {
    return this.dados.conversas[cliente];
  }

  salvarConversa(conversa: Conversa): void {
    conversa.atualizadaEm = new Date().toISOString();
    this.dados.conversas[conversa.cliente] = conversa;
    this.salvar();
  }

  removerConversa(cliente: string): void {
    delete this.dados.conversas[cliente];
    this.salvar();
  }

  /** Gera um protocolo no formato EV-AAAAMMDD-0001 (sequencial por dia). */
  proximoNumeroProtocolo(agora = new Date()): string {
    const dia = agora.toISOString().slice(0, 10).replace(/-/g, "");
    const seq = (this.dados.contadores[dia] ?? 0) + 1;
    this.dados.contadores[dia] = seq;
    this.salvar();
    return `EV-${dia}-${String(seq).padStart(4, "0")}`;
  }

  salvarProtocolo(protocolo: Protocolo): void {
    this.dados.protocolos[protocolo.numero] = protocolo;
    this.salvar();
  }

  obterProtocolo(numero: string): Protocolo | undefined {
    return this.dados.protocolos[numero.toUpperCase()];
  }

  listarProtocolosAbertos(departamento?: DepartamentoId): Protocolo[] {
    return Object.values(this.dados.protocolos).filter(
      (p) => p.status === "aberto" && (!departamento || p.departamento === departamento),
    );
  }
}
