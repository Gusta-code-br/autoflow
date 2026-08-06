/**
 * Contrato entre os formulários (client) e as Server Actions (server).
 *
 * Fica em `src/lib` de propósito: um arquivo `"use server"` só pode exportar
 * funções async, então tipos e constantes compartilhados precisam morar fora
 * dele. Como aqui não há nada de servidor, o client importa sem arrastar
 * dependência nenhuma para o bundle.
 */

export interface EstadoForm {
  /** `true` só depois que a ação concluiu com sucesso. */
  ok: boolean;
  /** Erro geral, o que aparece no topo do formulário. */
  erro?: string;
  /** Mensagem de sucesso, quando a ação não redireciona. */
  mensagem?: string;
  /** Erro por campo — chave é o `name` do input. */
  campos?: Record<string, string>;
  /**
   * Valores para repovoar o formulário depois de um erro. Sem isso, quem
   * preencheu 10 campos e errou o telefone perde tudo (e forms com Server
   * Actions e JS desligado realmente perdem — o React não guarda estado).
   * Nunca inclui senha.
   */
  valores?: Record<string, string>;
}

export const ESTADO_INICIAL: EstadoForm = { ok: false };

/** Atalho para o caso comum de falha com uma frase só. */
export function falha(erro: string, valores?: Record<string, string>): EstadoForm {
  return { ok: false, erro, valores };
}

export function sucesso(mensagem?: string): EstadoForm {
  return { ok: true, mensagem };
}
