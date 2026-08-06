/**
 * Cria uma sessão válida para o usuário do seed e imprime o cookie pronto para
 * `curl -b`. Serve só para smoke local: as páginas do painel exigem sessão de
 * verdade, e subir um navegador só para clicar em "Entrar" a cada revalidação
 * seria lento. A verificação de senha em si já tem teste unitário.
 *
 * Uso: npm run smoke:cookie -- [email]
 */
import { sql, fecharConexoes } from "@/server/db";
import { gerarToken } from "@/server/seguranca/cripto";

async function main(): Promise<void> {
  const email = process.argv[2] ?? "demo@autoflow.com.br";

  const [usuario] = await sql<{ id: string }[]>`
    SELECT id FROM usuario WHERE email = ${email}
  `;

  if (!usuario) {
    console.error(`Nenhum usuário com email ${email}. Rode: npm run db:semear`);
    process.exit(1);
  }

  const { token, hash } = gerarToken();
  const expira = new Date(Date.now() + 30 * 86_400_000);

  await sql`
    INSERT INTO sessao (usuario_id, token_hash, expira_em)
    VALUES (${usuario.id}, ${hash}, ${expira})
  `;

  console.log(`autoflow_sessao=${token}`);
  await fecharConexoes();
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
