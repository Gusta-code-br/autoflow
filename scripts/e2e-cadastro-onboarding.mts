// Teste E2E real via navegador (Playwright): cadastro -> onboarding -> painel.
// Objetivo: reproduzir com fidelidade o que o usuário reportou ("sessão expirou"
// ao clicar em Concluir e ir ao painel) e confirmar que está corrigido.
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const sufixo = Date.now();
const email = `e2e-${sufixo}@exemplo.com`;
const senha = "SenhaForte123!";
const nomeEmpresa = `Clinica E2E ${sufixo}`;

function log(msg: string) {
  console.log(`[e2e] ${msg}`);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const erros: string[] = [];
  page.on("pageerror", (err) => erros.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") erros.push(`console.error: ${msg.text()}`);
  });

  try {
    // 1. Cadastro
    log(`Abrindo /cadastro (email=${email})`);
    await page.goto(`${BASE}/cadastro`, { waitUntil: "networkidle" });

    await page.fill('input[name="nome"]', "Fulano E2E");
    await page.fill('input[name="nomeEmpresa"]', nomeEmpresa);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="telefone"]', "11987654321");
    await page.fill('input[name="senha"]', senha);

    log("Enviando formulário de cadastro");
    await Promise.all([
      page.waitForURL(/\/onboarding/, { timeout: 15000 }),
      page.click('button:has-text("Criar minha conta")'),
    ]);
    log(`OK: redirecionado para ${page.url()}`);

    // 2. Onboarding - passo 1: "Seu negócio" (segmento + objetivos)
    // Objetivos já vem com defaults marcados ("responder","agendar") — foi
    // aqui que o bug original ocorria (mismatch entre valor salvo e enum do banco).
    log("Onboarding passo 1: Seu negócio");
    await page.waitForSelector('select[name="segmento"]', { timeout: 10000 });
    await page.selectOption('select[name="segmento"]', { index: 1 });
    await page.click('button:has-text("Continuar")');

    // 3. Onboarding - passo 2: "Sua atendente" (nome, tom, instruções)
    log("Onboarding passo 2: Sua atendente");
    await page.waitForSelector('input[name="nomeAtendente"]', { timeout: 10000 });
    await page.click('button:has-text("Continuar")');

    // 4. Onboarding - passo 3: "Horário de atendimento e pagamento" (final)
    log("Onboarding passo 3: Horário de atendimento e pagamento");
    await page.waitForSelector('input[name="horarioInicio"]', { timeout: 10000 });
    await page.fill('input[name="whatsappPessoal"]', "11987654321");

    log('Clicando em "Concluir e ir para o painel"');
    await Promise.all([
      page.waitForURL(/\/painel/, { timeout: 15000 }).catch(() => null),
      page.click('button:has-text("Concluir")'),
    ]);

    await page.waitForTimeout(1500);
    const urlFinal = page.url();
    log(`URL final: ${urlFinal}`);

    const corpo = await page.content();
    const temSessaoExpirada = /sess[aã]o expirou|sessao_expirada/i.test(corpo);

    if (temSessaoExpirada) {
      console.error("[e2e] FALHA: página exibe mensagem de sessão expirada.");
      process.exitCode = 1;
    } else if (!/\/painel/.test(urlFinal)) {
      console.error(`[e2e] FALHA: não chegou em /painel. URL atual: ${urlFinal}`);
      const avisoTexto = await page
        .locator('[role="alert"], .text-danger-700, .text-rose-700, .text-red-700')
        .allTextContents()
        .catch(() => []);
      if (avisoTexto.length) {
        console.error("[e2e] Textos de aviso/erro visíveis na página:");
        for (const t of avisoTexto) console.error("  - " + t);
      }
      await page.screenshot({ path: "/tmp/e2e-falha.png", fullPage: true }).catch(() => {});
      log("Screenshot salvo em /tmp/e2e-falha.png");
      process.exitCode = 1;
    } else {
      log("SUCESSO: fluxo completo de cadastro + onboarding chegou ao /painel sem erro de sessão.");
    }

    if (erros.length) {
      console.error("[e2e] Erros de console/página capturados durante o teste:");
      for (const e of erros) console.error("  - " + e);
      if (!process.exitCode) process.exitCode = 1;
    }
  } catch (e) {
    console.error("[e2e] Exceção durante o teste:", e);
    await page.screenshot({ path: "/tmp/e2e-falha.png" }).catch(() => {});
    log("Screenshot salvo em /tmp/e2e-falha.png");
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
