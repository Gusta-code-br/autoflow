"use client";

import { useState } from "react";
import { Pagina } from "@/components/shell";
import { Badge, Barra, Botao, Campo, Card, Input, Modal, Vazio, cx } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useApp } from "@/lib/store";
import { PRECO_CONEXAO_EXTRA } from "@/lib/plans";
import { brl, numero, telefone, tempoRelativo } from "@/lib/format";
import type { Conexao } from "@/lib/types";

export default function ConexoesPage() {
  const app = useApp();
  const [modalAberto, setModalAberto] = useState(false);
  const [aRemover, setARemover] = useState<Conexao | null>(null);

  const usoSlots = app.conexoesTotais > 0 ? (app.conexoes.length / app.conexoesTotais) * 100 : 0;
  const noLimite = app.conexoes.length >= app.conexoesTotais;

  return (
    <Pagina
      titulo="WhatsApp"
      descricao="Conecte um ou mais números para a IA atender, cobrar e agendar em cada frente do seu negócio."
      acao={
        <Botao icone="plus" onClick={() => setModalAberto(true)}>
          Conectar novo número
        </Botao>
      }
    >
      <Card className="mb-6 p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink-800">Números conectados</span>
          <span className="text-ink-500">
            Você está usando {app.conexoes.length} de {app.conexoesTotais} números
          </span>
        </div>
        <Barra valor={usoSlots} tom={noLimite ? "aviso" : "marca"} className="mt-2.5" />
        {noLimite && (
          <p className="mt-2.5 text-[13px] text-amber-700">
            Você atingiu o limite incluso no seu plano. Cada número adicional custa{" "}
            {brl(PRECO_CONEXAO_EXTRA)}/mês.
          </p>
        )}
      </Card>

      {app.conexoes.length === 0 ? (
        <Card>
          <Vazio
            icone="whatsapp"
            titulo="Nenhum WhatsApp conectado"
            descricao="Conecte seu primeiro número para a IA começar a atender, cobrar e agendar pelos seus clientes."
            acao={
              <Botao icone="plus" onClick={() => setModalAberto(true)}>
                Conectar WhatsApp
              </Botao>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {app.conexoes.map((c) => (
            <CardConexao key={c.id} conexao={c} aoRemover={() => setARemover(c)} />
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
              Você pode separar recepção, financeiro e comercial em números diferentes, cada
              um com sua própria IA e histórico de conversas. Na versão final, a conexão é
              feita via API oficial do WhatsApp (ou Evolution API), sem risco de bloqueio do
              seu número.
            </p>
          </div>
        </div>
      </Card>

      <ModalConectar aberto={modalAberto} aoFechar={() => setModalAberto(false)} />
      <ModalConfirmarRemocao conexao={aRemover} aoFechar={() => setARemover(null)} />
    </Pagina>
  );
}

/* --------------------------------------------------------- Card conexão */

function CardConexao({
  conexao,
  aoRemover,
}: {
  conexao: Conexao;
  aoRemover: () => void;
}) {
  const [menuAberto, setMenuAberto] = useState(false);

  const tomStatus =
    conexao.status === "conectado" ? "zap" : conexao.status === "conectando" ? "aviso" : "perigo";
  const textoStatus =
    conexao.status === "conectado"
      ? "Conectado"
      : conexao.status === "conectando"
        ? "Conectando…"
        : "Desconectado";

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e7f9ee] text-zap-dark">
            <Icon name="whatsapp" className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-ink-900">{conexao.nome}</p>
              {conexao.principal && <Badge tom="marca">Principal</Badge>}
            </div>
            <p className="text-[13px] text-ink-500">{telefone(conexao.numero)}</p>
          </div>
        </div>

        <div className="relative">
          <button
            onClick={() => setMenuAberto((v) => !v)}
            aria-label="Mais opções"
            className="rounded-lg px-2 py-1 text-lg leading-none text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            …
          </button>
          {menuAberto && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)} />
              <div className="absolute right-0 top-8 z-20 w-40 rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg">
                <button
                  onClick={() => {
                    setMenuAberto(false);
                    aoRemover();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-rose-600 hover:bg-rose-50"
                >
                  <Icon name="trash" className="size-3.5" />
                  Desconectar
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Badge tom={tomStatus}>{textoStatus}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-ink-100 pt-4 text-[13px]">
        <div>
          <p className="text-ink-400">Mensagens no mês</p>
          <p className="mt-0.5 font-medium text-ink-800">{numero(conexao.mensagensMes)}</p>
        </div>
        <div>
          <p className="text-ink-400">Última sincronização</p>
          <p className="mt-0.5 font-medium text-ink-800">{tempoRelativo(conexao.ultimaSync)}</p>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------- Modal remover */

function ModalConfirmarRemocao({
  conexao,
  aoFechar,
}: {
  conexao: Conexao | null;
  aoFechar: () => void;
}) {
  const app = useApp();

  return (
    <Modal
      aberto={!!conexao}
      aoFechar={aoFechar}
      titulo="Desconectar número"
      subtitulo="Essa ação pode ser desfeita conectando o número novamente"
      rodape={
        <>
          <Botao variante="fantasma" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="perigo"
            icone="trash"
            onClick={() => {
              if (!conexao) return;
              app.removerConexao(conexao.id);
              app.notificar(`${conexao.nome} foi desconectado.`, "info");
              aoFechar();
            }}
          >
            Desconectar
          </Botao>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-600">
        Tem certeza que quer desconectar{" "}
        <strong className="font-medium text-ink-900">{conexao?.nome}</strong>
        {conexao ? ` (${telefone(conexao.numero)})` : ""}? A IA para de atender por esse número
        imediatamente.
      </p>
    </Modal>
  );
}

/* -------------------------------------------------------- Modal conectar */

type Etapa = "form" | "confirmarUpsell" | "qr";

function ModalConectar({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const app = useApp();
  const [etapa, setEtapa] = useState<Etapa>("form");
  const [nome, setNome] = useState("");
  const [numeroInput, setNumeroInput] = useState("");
  const [conectando, setConectando] = useState(false);

  const precisaPagar = app.conexoes.length >= app.conexoesTotais;
  const digitos = numeroInput.replace(/\D/g, "");
  const formValido = nome.trim().length > 1 && digitos.length >= 10;

  function resetar() {
    setEtapa("form");
    setNome("");
    setNumeroInput("");
    setConectando(false);
  }

  function fechar() {
    resetar();
    aoFechar();
  }

  function avancarDoForm() {
    if (!formValido) return;
    setEtapa(precisaPagar ? "confirmarUpsell" : "qr");
  }

  function simularLeitura() {
    setConectando(true);
    const numeroFinal = digitos.startsWith("55") ? digitos : `55${digitos}`;
    setTimeout(() => {
      app.adicionarConexao(nome.trim(), numeroFinal);
      app.notificar(`${nome.trim()} conectado com sucesso!`);
      fechar();
    }, 1500);
  }

  const titulos: Record<Etapa, string> = {
    form: "Conectar novo número",
    confirmarUpsell: "Número adicional",
    qr: "Escaneie o QR Code",
  };

  return (
    <Modal aberto={aberto} aoFechar={fechar} titulo={titulos[etapa]}>
      {etapa === "form" && (
        <div className="space-y-4">
          <Campo label="Apelido do número" obrigatorio dica="Ex: Recepção, Financeiro, Comercial">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Financeiro"
            />
          </Campo>
          <Campo label="Número de WhatsApp" obrigatorio dica="Com DDD, ex: 11 99999-8888">
            <Input
              value={numeroInput}
              onChange={(e) => setNumeroInput(e.target.value)}
              placeholder="11 99999-8888"
              inputMode="tel"
            />
          </Campo>
          <div className="flex justify-end gap-2 pt-2">
            <Botao variante="fantasma" onClick={fechar}>
              Cancelar
            </Botao>
            <Botao disabled={!formValido} iconeDireita="arrowRight" onClick={avancarDoForm}>
              Continuar
            </Botao>
          </div>
        </div>
      )}

      {etapa === "confirmarUpsell" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-amber-100 p-2 text-amber-700">
                <Icon name="alert" className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-amber-900">
                  Isso passa do limite do seu plano
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
                  Seu plano já inclui todos os números disponíveis. Conectar{" "}
                  <strong>{nome.trim()}</strong> como número adicional custa{" "}
                  <strong>{brl(PRECO_CONEXAO_EXTRA)}/mês</strong>, cobrado junto com sua
                  assinatura.
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Botao variante="fantasma" onClick={() => setEtapa("form")}>
              Voltar
            </Botao>
            <Botao onClick={() => setEtapa("qr")}>
              Adicionar por {brl(PRECO_CONEXAO_EXTRA)}/mês
            </Botao>
          </div>
        </div>
      )}

      {etapa === "qr" && (
        <div className="flex flex-col items-center">
          <QRCodeFalso semente={`${nome.trim()}|${digitos}`} />
          <ol className="mt-5 space-y-1.5 self-stretch text-[13px] text-ink-600">
            <li>1. Abra o WhatsApp no celular do número {telefone(digitos || numeroInput)}</li>
            <li>2. Toque em Aparelhos conectados</li>
            <li>3. Toque em Conectar aparelho e aponte a câmera para o QR Code</li>
          </ol>
          <Botao
            variante="zap"
            icone="qr"
            className="mt-5 w-full"
            disabled={conectando}
            onClick={simularLeitura}
          >
            {conectando ? "Conectando…" : "Simular leitura do QR"}
          </Botao>
          {!conectando && (
            <button
              onClick={() => setEtapa(precisaPagar ? "confirmarUpsell" : "form")}
              className="mt-3 text-[13px] text-ink-500 hover:text-ink-700"
            >
              Voltar
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------- QR falso */

/** Gera um padrão determinístico (sem Math.random) a partir de uma semente. */
function gerarPadraoQR(semente: string, tamanho = 11): boolean[][] {
  let h = 0;
  for (let i = 0; i < semente.length; i++) {
    h = (h * 31 + semente.charCodeAt(i)) >>> 0;
  }
  let estado = h || 2654435761;

  function proximo(): number {
    estado ^= estado << 13;
    estado >>>= 0;
    estado ^= estado >>> 17;
    estado ^= estado << 5;
    estado >>>= 0;
    return estado / 4294967295;
  }

  const grade: boolean[][] = Array.from({ length: tamanho }, () =>
    Array.from({ length: tamanho }, () => proximo() > 0.53),
  );

  const aplicarFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        grade[r0 + r][c0 + c] = r === 1 && c === 1 ? false : true;
      }
    }
  };
  aplicarFinder(0, 0);
  aplicarFinder(0, tamanho - 3);
  aplicarFinder(tamanho - 3, 0);

  return grade;
}

function QRCodeFalso({ semente }: { semente: string }) {
  const grade = gerarPadraoQR(semente);
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-3 shadow-sm">
      <div
        className="grid gap-[2px]"
        style={{
          gridTemplateColumns: `repeat(${grade.length}, 1fr)`,
          width: 192,
          height: 192,
        }}
      >
        {grade.flatMap((linha, r) =>
          linha.map((ativo, c) => (
            <div
              key={`${r}-${c}`}
              className={cx("rounded-[1px]", ativo ? "bg-ink-900" : "bg-white")}
            />
          )),
        )}
      </div>
    </div>
  );
}
