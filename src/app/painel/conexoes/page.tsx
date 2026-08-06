import { Icon, type IconName } from "@/components/icons";
import { Pagina } from "@/components/shell";
import { Badge, Barra, Card, Vazio } from "@/components/ui";
import { brl, numero, telefone, tempoRelativo } from "@/lib/format";
import { listarConexoes, type ConexaoDTO } from "@/server/dal/conexoes";
import { catalogo } from "@/server/dal/creditos";
import { centavosParaReais } from "@/server/dominio/dinheiro";
import { AcoesConexao, BotaoConectar } from "./interacoes";

/**
 * Números de WhatsApp da organização.
 *
 * Server Component: a lista sai do banco com RLS ligado, então um cliente
 * jamais vê o número do outro nem por acidente de query. O que antes era
 * `app.conexoes` do store de demonstração agora é `listarConexoes()`.
 *
 * O preço da conexão extra vem do catálogo (tabela `parametro`), não de uma
 * constante no bundle: quando o preço mudar, muda no banco e a tela segue.
 */
export default async function ConexoesPage() {
  const [painel, precos] = await Promise.all([listarConexoes(), catalogo()]);

  const precoExtra = brl(centavosParaReais(precos.precoConexaoExtra));
  const usados = painel.conexoes.length;
  const noLimite = painel.disponiveis <= 0;
  const usoSlots = painel.totais > 0 ? (usados / painel.totais) * 100 : 100;

  return (
    <Pagina
      titulo="WhatsApp"
      descricao="Conecte um ou mais números para a IA atender, cobrar e agendar em cada frente do seu negócio."
      acao={<BotaoConectar precoExtra={precoExtra} noLimite={noLimite} />}
    >
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium text-ink-800">Números conectados</span>
          <span className="text-ink-500">
            Você está usando {usados} de {painel.totais}{" "}
            {painel.totais === 1 ? "número" : "números"}
          </span>
        </div>
        <Barra valor={usoSlots} tom={noLimite ? "aviso" : "marca"} className="mt-2.5" />
        {noLimite && (
          <p className="mt-2.5 text-[13px] text-amber-700">
            Você atingiu o limite incluso no seu plano. Cada número adicional
            custa {precoExtra}/mês.
          </p>
        )}
      </Card>

      {usados === 0 ? (
        <Card>
          <Vazio
            icone="whatsapp"
            titulo="Nenhum WhatsApp conectado"
            descricao="Conecte seu primeiro número para a IA começar a atender, cobrar e agendar pelos seus clientes."
            acao={
              <BotaoConectar
                precoExtra={precoExtra}
                noLimite={noLimite}
                variante="zap"
                rotulo="Conectar WhatsApp"
              />
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {painel.conexoes.map((c) => (
            <CardConexao key={c.id} conexao={c} />
          ))}
        </div>
      )}

      <Card className="mt-6 p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-ink-100 p-2.5 text-ink-500">
            <Icon name="shield" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-ink-800">
              Cada número é uma sessão independente
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
              Você pode separar recepção, financeiro e comercial em números
              diferentes, cada um com sua própria IA e histórico de conversas. A
              conexão é feita pela API oficial do WhatsApp (ou por uma Evolution
              API sua), sem risco de bloqueio do seu número.
            </p>
          </div>
        </div>
      </Card>
    </Pagina>
  );
}

/* --------------------------------------------------------- Card conexão */

const STATUS: Record<
  ConexaoDTO["status"],
  { texto: string; tom: "zap" | "aviso" | "perigo" | "neutro"; icone: IconName }
> = {
  conectado: { texto: "Conectado", tom: "zap", icone: "check" },
  pendente: { texto: "Verificando…", tom: "aviso", icone: "clock" },
  erro: { texto: "Com erro", tom: "perigo", icone: "alert" },
  desconectado: { texto: "Desconectado", tom: "neutro", icone: "x" },
};

const PROVEDOR: Record<ConexaoDTO["provedor"], string> = {
  meta_cloud: "API oficial",
  evolution: "Evolution API",
};

function CardConexao({ conexao }: { conexao: ConexaoDTO }) {
  const status = STATUS[conexao.status];

  /*
   * `ultimaSync` é o último tráfego real; `verificadoEm`, o último teste de
   * credencial. Mostrar o mais recente dos dois é o que responde à pergunta
   * que o cliente faz olhando o card: "isso aqui está vivo?".
   */
  const visto = [conexao.ultimaSync, conexao.verificadoEm]
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <Card className="relative p-5">
      <div className="flex items-start gap-3 pr-8">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e7f9ee] text-zap-dark">
          <Icon name="whatsapp" className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-ink-900">
              {conexao.nome}
            </span>
            {conexao.principal && <Badge tom="marca">Principal</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-ink-500">
            {telefone(conexao.numero)} · {PROVEDOR[conexao.provedor]}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge tom={status.tom} icone={status.icone}>
          {status.texto}
        </Badge>
        {conexao.qualidade && (
          <Badge tom={conexao.qualidade === "alta" ? "sucesso" : "neutro"}>
            Qualidade {conexao.qualidade}
          </Badge>
        )}
        {visto && (
          <Badge tom="neutro">Ativo há {tempoRelativo(visto.toISOString())}</Badge>
        )}
      </div>

      {conexao.ultimoErro && conexao.status !== "conectado" && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] leading-relaxed text-rose-700">
          {conexao.ultimoErro}
        </p>
      )}

      <div className="mt-4 flex items-baseline justify-between border-t border-ink-100 pt-3 text-[13px]">
        <span className="text-ink-500">Mensagens no mês</span>
        <span className="font-medium text-ink-800">
          {numero(conexao.mensagensMes)}
          {conexao.limiteDiario != null && (
            <span className="font-normal text-ink-400">
              {" "}
              · limite {numero(conexao.limiteDiario)}/dia
            </span>
          )}
        </span>
      </div>

      <AcoesConexao
        canalId={conexao.id}
        nome={conexao.nome}
        principal={conexao.principal}
      />
    </Card>
  );
}
