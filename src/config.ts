import "dotenv/config";
import { DEPARTAMENTOS, type DepartamentoId } from "./departments.js";

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${nome} (veja o arquivo .env.example)`);
  }
  return valor;
}

function opcional(nome: string, padrao: string): string {
  return process.env[nome] || padrao;
}

/** Remove tudo que não for dígito: "+55 (11) 99999-0000" -> "5511999990000". */
export function normalizarNumero(numero: string): string {
  return numero.replace(/\D/g, "");
}

export interface Config {
  porta: number;
  whatsapp: {
    token: string;
    phoneNumberId: string;
    verifyToken: string;
    appSecret: string | null;
    graphVersion: string;
    /** Template aprovado na Meta para avisar atendentes fora da janela de 24h (opcional). */
    templateAviso: string | null;
    templateIdioma: string;
  };
  claude: {
    modelo: string;
    esforco: "low" | "medium" | "high" | "xhigh" | "max";
  };
  /** Número de WhatsApp do atendente responsável por cada departamento. */
  atendentes: Record<DepartamentoId, string | null>;
  /** Horas sem mensagens até a conversa voltar ao menu inicial. */
  horasExpiracao: number;
  arquivoDados: string;
}

export function carregarConfig(): Config {
  const atendentes = {} as Record<DepartamentoId, string | null>;
  for (const d of DEPARTAMENTOS) {
    const valor = process.env[`ATENDENTE_${d.id.toUpperCase()}`];
    atendentes[d.id] = valor ? normalizarNumero(valor) : null;
  }

  const esforco = opcional("CLAUDE_ESFORCO", "low");
  if (!["low", "medium", "high", "xhigh", "max"].includes(esforco)) {
    throw new Error(`CLAUDE_ESFORCO inválido: ${esforco}`);
  }

  return {
    porta: Number(opcional("PORT", "3000")),
    whatsapp: {
      token: obrigatoria("WHATSAPP_TOKEN"),
      phoneNumberId: obrigatoria("WHATSAPP_PHONE_NUMBER_ID"),
      verifyToken: obrigatoria("WHATSAPP_VERIFY_TOKEN"),
      appSecret: process.env.WHATSAPP_APP_SECRET || null,
      graphVersion: opcional("WHATSAPP_GRAPH_VERSION", "v23.0"),
      templateAviso: process.env.WHATSAPP_TEMPLATE_AVISO || null,
      templateIdioma: opcional("WHATSAPP_TEMPLATE_IDIOMA", "pt_BR"),
    },
    claude: {
      modelo: opcional("CLAUDE_MODELO", "claude-opus-5-5"),
      esforco: esforco as Config["claude"]["esforco"],
    },
    atendentes,
    horasExpiracao: Number(opcional("HORAS_EXPIRACAO_CONVERSA", "24")),
    arquivoDados: opcional("ARQUIVO_DADOS", "./data/banco.json"),
  };
}
