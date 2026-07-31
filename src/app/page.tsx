import Link from "next/link";
import { Botao, Badge, Card } from "@/components/ui";
import { Icon, Logo, type IconName } from "@/components/icons";
import { FEATURES, PERIODOS, PLANOS, PRECO_CONEXAO_EXTRA } from "@/lib/plans";
import { brl } from "@/lib/format";

const MODULOS = ["atendimento", "cobranca", "agendamento"] as const;

const PASSOS = [
  {
    numero: "1",
    titulo: "Crie sua conta e conte do seu negócio",
    descricao:
      "Nome da empresa, segmento e o tom de voz que a IA vai usar para falar com seus clientes.",
  },
  {
    numero: "2",
    titulo: "Conecte seu WhatsApp lendo um QR Code",
    descricao:
      "É o seu número mesmo, sem chip novo e sem burocracia de API. Leva menos de 2 minutos.",
  },
  {
    numero: "3",
    titulo: "A IA assume: responde, cobra e agenda",
    descricao:
      "Você acompanha tudo pelo painel e pode assumir qualquer conversa quando quiser.",
  },
];

const ETAPAS_REGUA = [
  {
    quando: "3 dias antes",
    titulo: "Lembrete amigável",
    descricao: "A IA avisa que o vencimento está chegando, sem pressão.",
  },
  {
    quando: "No vencimento",
    titulo: "Cobrança com PIX",
    descricao: "Mensagem com o valor e o PIX já na conversa, pronto pra pagar.",
  },
  {
    quando: "2 dias depois",
    titulo: "Segundo aviso",
    descricao: "Reforço educado lembrando do pagamento em aberto.",
  },
  {
    quando: "Se ainda não pagou",
    titulo: "Oferta de parcelamento",
    descricao: "A IA propõe parcelar para não perder o cliente nem o recebimento.",
  },
];

const FAQ = [
  {
    pergunta: "Preciso de chip ou API oficial do WhatsApp?",
    resposta:
      "Não. Você conecta o WhatsApp que já usa lendo um QR Code, do jeito mais simples possível — sem chip novo, sem homologação e sem burocracia.",
  },
  {
    pergunta: "O número continua sendo meu?",
    resposta:
      "Sim, 100%. É o seu número, a sua conta do WhatsApp. O AutoFlow só conecta a IA a ela para atender, cobrar e agendar por você.",
  },
  {
    pergunta: "E se a IA não souber responder alguma coisa?",
    resposta:
      "Ela avisa o cliente que vai verificar e te notifica na hora. Você também pode assumir a conversa a qualquer momento, direto do painel.",
  },
  {
    pergunta: "Consigo assumir a conversa quando eu quiser?",
    resposta:
      "Sempre. Com um clique você tira a IA da conversa e responde pessoalmente. Quando quiser, devolve para a IA continuar.",
  },
  {
    pergunta: "Como funcionam os créditos de mensagens de IA?",
    resposta:
      "Cada plano já inclui uma cota mensal de mensagens de IA. Se acabar antes do fim do mês, você recarrega com pacotes de créditos avulsos, sem trocar de plano.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-ink-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Logo className="size-8" />
            <span className="text-[15px] font-semibold text-ink-900">
              AutoFlow
            </span>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-medium text-ink-600 md:flex">
            <a href="#como-funciona" className="hover:text-ink-900">
              Como funciona
            </a>
            <a href="#planos" className="hover:text-ink-900">
              Planos
            </a>
            <a href="#perguntas" className="hover:text-ink-900">
              Perguntas
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/entrar">
              <Botao variante="fantasma" tamanho="sm">
                Entrar
              </Botao>
            </Link>
            <Link href="/cadastro">
              <Botao variante="primario" tamanho="sm" iconeDireita="arrowRight">
                Começar agora
              </Botao>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 pt-16">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-10">
            <div>
              <Badge tom="marca" icone="spark">
                IA no seu WhatsApp
              </Badge>
              <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-ink-950 sm:text-5xl">
                Sua IA atende, cobra e agenda no WhatsApp — 24 horas por dia
              </h1>
              <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-ink-600">
                Conecte o WhatsApp da sua empresa em minutos e deixe a IA
                assumir com o nome e o tom da sua atendente: responde
                dúvidas, cobra quem está em atraso e marca horários na sua
                agenda, sem você precisar estar na tela.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/cadastro">
                  <Botao variante="primario" tamanho="lg" iconeDireita="arrowRight">
                    Criar minha conta
                  </Botao>
                </Link>
                <Link href="/entrar">
                  <Botao variante="secundario" tamanho="lg" icone="play">
                    Ver demonstração
                  </Botao>
                </Link>
              </div>
              <p className="mt-6 text-[13px] text-ink-400">
                Usado por clínicas, salões, escritórios e lojas em todo o
                Brasil.
              </p>
            </div>

            {/* Mock de conversa de WhatsApp */}
            <div className="relative mx-auto w-full max-w-sm">
              <div className="overflow-hidden rounded-3xl border border-ink-200 bg-white shadow-xl">
                <div className="flex items-center gap-3 bg-zap-dark px-4 py-3.5">
                  <span className="flex size-9 items-center justify-center rounded-full bg-white/20 text-white">
                    <Icon name="whatsapp" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      Sofia · Clínica Vitalis
                    </p>
                    <p className="text-[11px] text-white/80">
                      IA de atendimento · online
                    </p>
                  </div>
                </div>
                <div className="chat-bg flex flex-col gap-2.5 px-3 py-4">
                  <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-[13.5px] text-ink-800 shadow-sm">
                    Oi! Queria marcar uma avaliação essa semana
                    <span className="mt-1 block text-right text-[10px] text-ink-400">
                      14:02
                    </span>
                  </div>
                  <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-[#d9fdd3] px-3.5 py-2 text-[13.5px] text-ink-800 shadow-sm">
                    Oi, Marina! Consigo sim 😊 Tenho quinta às 15h ou sexta
                    às 10h. Qual fica melhor pra você?
                    <span className="mt-1 block text-right text-[10px] text-ink-500">
                      14:02
                    </span>
                  </div>
                  <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3.5 py-2 text-[13.5px] text-ink-800 shadow-sm">
                    Quinta às 15h pra mim!
                    <span className="mt-1 block text-right text-[10px] text-ink-400">
                      14:03
                    </span>
                  </div>
                  <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-[#d9fdd3] px-3.5 py-2 text-[13.5px] text-ink-800 shadow-sm">
                    Perfeito, agendado para quinta às 15h! Vou te lembrar
                    um dia antes. Posso ajudar em mais alguma coisa?
                    <span className="mt-1 block text-right text-[10px] text-ink-500">
                      14:03
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3 módulos */}
        <section className="border-t border-ink-200/70 bg-white py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-ink-950">
                Um número de WhatsApp, três funções que trabalham por você
              </h2>
              <p className="mt-3 text-[15px] text-ink-500">
                Escolha o que a IA vai fazer pela sua empresa — atender,
                cobrar, agendar, ou tudo junto.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-3">
              {MODULOS.map((chave) => {
                const feat = FEATURES[chave];
                return (
                  <Card key={chave} className="p-6">
                    <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                      <Icon name={feat.icone as IconName} className="size-5" />
                    </span>
                    <h3 className="mt-4 text-[15px] font-semibold text-ink-900">
                      {feat.nome}
                    </h3>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-500">
                      {feat.descricao}
                    </p>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-ink-950">
                Como funciona
              </h2>
              <p className="mt-3 text-[15px] text-ink-500">
                Três passos, sem precisar de nada técnico.
              </p>
            </div>
            <div className="mt-12 grid gap-8 sm:grid-cols-3">
              {PASSOS.map((passo) => (
                <div key={passo.numero} className="text-center sm:text-left">
                  <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">
                    {passo.numero}
                  </span>
                  <h3 className="mt-4 text-[15px] font-semibold text-ink-900">
                    {passo.titulo}
                  </h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-500">
                    {passo.descricao}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Régua de cobrança */}
        <section className="border-t border-ink-200/70 bg-white py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <Badge tom="sucesso" icone="cash">
                  Régua de cobrança
                </Badge>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink-950">
                  A cobrança acontece sozinha, do jeito que você quiser
                </h2>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
                  Monte a linha do tempo de mensagens antes, no dia e depois
                  do vencimento. Você define quantas etapas, o texto de
                  cada uma e o que fazer se o cliente não responder — a IA
                  cuida da régua inteira sem parar o dia a dia da equipe.
                </p>
              </div>
              <div className="relative">
                <div className="absolute left-4 top-2 bottom-2 hidden w-px bg-ink-200 sm:block" />
                <div className="space-y-4">
                  {ETAPAS_REGUA.map((etapa) => (
                    <div key={etapa.titulo} className="relative flex gap-4 sm:pl-10">
                      <span className="absolute left-0 top-0.5 hidden size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 sm:flex">
                        <Icon name="check" className="size-4" />
                      </span>
                      <Card className="flex-1 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13px] font-semibold text-ink-900">
                            {etapa.titulo}
                          </p>
                          <Badge tom="neutro">{etapa.quando}</Badge>
                        </div>
                        <p className="mt-1 text-[13px] text-ink-500">
                          {etapa.descricao}
                        </p>
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-ink-950">
                Planos para todo tamanho de negócio
              </h2>
              <p className="mt-3 text-[15px] text-ink-500">
                Cada plano já inclui uma cota mensal de mensagens de IA,
                com recarga por pacote de créditos quando acabar.
              </p>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {PLANOS.map((plano) => (
                <Card
                  key={plano.id}
                  className={
                    plano.destaque
                      ? "relative flex flex-col p-6 ring-2 ring-brand-600"
                      : "relative flex flex-col p-6"
                  }
                >
                  {plano.destaque && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge tom="marca">Mais popular</Badge>
                    </span>
                  )}
                  <h3 className="text-[15px] font-semibold text-ink-900">
                    {plano.nome}
                  </h3>
                  <p className="mt-1 text-[13px] text-ink-500">
                    {plano.chamada}
                  </p>
                  <div className="mt-5 flex items-baseline gap-1">
                    <span className="text-3xl font-semibold tracking-tight text-ink-950">
                      {brl(plano.precoMensal)}
                    </span>
                    <span className="text-sm text-ink-400">/mês</span>
                  </div>
                  <ul className="mt-5 flex-1 space-y-2.5">
                    {plano.beneficios.map((b) => (
                      <li
                        key={b}
                        className="flex items-start gap-2 text-[13.5px] text-ink-600"
                      >
                        <Icon
                          name="check"
                          className="mt-0.5 size-4 shrink-0 text-emerald-600"
                        />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <Link href="/cadastro" className="mt-6 block">
                    <Botao
                      variante={plano.destaque ? "primario" : "secundario"}
                      tamanho="md"
                      className="w-full"
                      iconeDireita="arrowRight"
                    >
                      Assinar {plano.nome}
                    </Botao>
                  </Link>
                </Card>
              ))}
            </div>

            <div className="mt-8 flex flex-col items-center gap-1.5 text-center text-[13px] text-ink-500">
              <p>
                Pague mês a mês, ou economize:{" "}
                {PERIODOS.filter((p) => p.desconto > 0)
                  .map((p) => `${p.nome} (${p.selo})`)
                  .join(" · ")}
                .
              </p>
              <p>
                WhatsApp adicional por {brl(PRECO_CONEXAO_EXTRA)}/mês — conecte
                quantos números precisar.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="perguntas" className="border-t border-ink-200/70 bg-white py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="text-center text-3xl font-semibold tracking-tight text-ink-950">
              Perguntas frequentes
            </h2>
            <div className="mt-10 space-y-3">
              {FAQ.map((item) => (
                <details
                  key={item.pergunta}
                  className="group rounded-2xl border border-ink-200 bg-ink-50/40 px-5 py-4 open:bg-white"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink-900 marker:content-none">
                    {item.pergunta}
                    <Icon
                      name="chevronDown"
                      className="size-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-ink-600">
                    {item.resposta}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="py-20">
          <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
            <div className="rounded-3xl bg-brand-700 px-6 py-14 shadow-lg shadow-brand-700/25 sm:px-14">
              <h2 className="text-3xl font-semibold tracking-tight text-white">
                Pronto para colocar a IA pra trabalhar no seu WhatsApp?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-[15px] text-brand-100">
                Crie sua conta agora e conecte seu WhatsApp em poucos
                minutos. Sem cartão de crédito para começar.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/cadastro">
                  <Botao variante="secundario" tamanho="lg" iconeDireita="arrowRight">
                    Criar minha conta
                  </Botao>
                </Link>
                <Link href="/entrar">
                  <Botao
                    variante="fantasma"
                    tamanho="lg"
                    className="text-white hover:bg-white/10 hover:text-white"
                  >
                    Ver demonstração
                  </Botao>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Rodapé */}
      <footer className="border-t border-ink-200/70 bg-white py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-[13px] text-ink-400 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Logo className="size-6" />
            <span className="font-medium text-ink-600">AutoFlow</span>
          </div>
          <p>Protótipo — dados fictícios, nenhuma integração real.</p>
        </div>
      </footer>
    </div>
  );
}
