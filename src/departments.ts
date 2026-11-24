export type DepartamentoId = "comercial" | "financeiro" | "suporte" | "atendimento";

export interface Departamento {
  id: DepartamentoId;
  /** Número mostrado no menu (o cliente também pode digitar esse número). */
  opcao: string;
  nome: string;
  /** Texto curto que aparece na lista do WhatsApp (máx. 72 caracteres). */
  descricao: string;
  /** Orientações para a IA sobre o que perguntar nesse departamento. */
  orientacaoIA: string;
}

export const DEPARTAMENTOS: readonly Departamento[] = [
  {
    id: "comercial",
    opcao: "1",
    nome: "Comercial",
    descricao: "Orçamentos, novos projetos e informações sobre serviços",
    orientacaoIA:
      "Entenda o que o cliente quer contratar ou orçar: tipo de projeto ou serviço, objetivo, prazo desejado, " +
      "se é empresa (nome da empresa) e, se ele quiser dizer, uma faixa de orçamento.",
  },
  {
    id: "financeiro",
    opcao: "2",
    nome: "Financeiro",
    descricao: "Boletos, notas fiscais, pagamentos e cobranças",
    orientacaoIA:
      "Entenda a demanda financeira: segunda via de boleto, nota fiscal, pagamento, cobrança ou contrato. " +
      "Peça o nome da empresa ou o CPF/CNPJ do titular e, se houver, o número da fatura ou o mês de referência. " +
      "Nunca peça senhas nem dados completos de cartão.",
  },
  {
    id: "suporte",
    opcao: "3",
    nome: "Suporte Técnico",
    descricao: "Problemas, erros e dúvidas técnicas sobre seu sistema ou site",
    orientacaoIA:
      "Entenda o problema técnico: qual sistema, site ou serviço é afetado, o que acontece (mensagem de erro, se houver), " +
      "desde quando, se impede o trabalho (urgência) e o que o cliente já tentou. " +
      "Você pode sugerir passos simples e seguros (limpar cache, tentar outro navegador), mas não prometa soluções.",
  },
  {
    id: "atendimento",
    opcao: "4",
    nome: "Atendimento Geral",
    descricao: "Outros assuntos, dúvidas gerais, sugestões e reclamações",
    orientacaoIA:
      "Entenda o assunto do cliente e colete o necessário para que uma pessoa da equipe possa dar continuidade.",
  },
];

export function buscarDepartamento(id: string): Departamento | undefined {
  return DEPARTAMENTOS.find((d) => d.id === id);
}

/** Reconhece a escolha quando o cliente digita "1", "suporte", "financeiro" etc. em vez de usar a lista. */
export function reconhecerDepartamento(texto: string): Departamento | undefined {
  const t = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return DEPARTAMENTOS.find((d) => {
    const nome = d.nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return t === d.opcao || t === d.id || t === nome || nome.split(" ").includes(t);
  });
}
