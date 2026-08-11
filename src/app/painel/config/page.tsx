import { Pagina } from "@/components/shell";
import { podeConfigurar } from "@/server/dal/contexto";
import { buscarConfig } from "@/server/dal/organizacao";
import { carregarSessaoPainel } from "@/server/dal/painel";
import { Formularios } from "./formularios";

/**
 * Ajustes da IA.
 *
 * O protótipo guardava tudo isso em `app.conta` (localStorage) e as "perguntas
 * rápidas" nem existiam fora da tela. Agora cada aba é um formulário parcial
 * contra `salvarConfigAction` → `salvarConfig`, que só escreve nas colunas do
 * mapa fixo — e apenas para admin.
 */
export default async function ConfigPage() {
  const [sessao, config] = await Promise.all([
    carregarSessaoPainel(),
    buscarConfig(),
  ]);

  return (
    <Pagina
      titulo="Ajustes da IA"
      descricao="Configure como a sua atendente virtual se comporta no WhatsApp."
    >
      <Formularios
        config={config}
        email={sessao.usuario.email}
        admin={podeConfigurar(sessao.usuario.papel)}
        verFinanceiro={sessao.verFinanceiro}
        plano={{
          nome: sessao.plano.nome,
          status: sessao.plano.status,
          expiraEm: sessao.plano.expiraEm?.toISOString() ?? null,
        }}
      />
    </Pagina>
  );
}
