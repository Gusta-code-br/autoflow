import { registrar } from "@/server/dal/organizacao";

const sufixo = Date.now();
const r = await registrar({
  email: `smoke-real-${sufixo}@exemplo.com`,
  senha: "senhaforte123",
  nome: "Smoke Real",
  telefone: "11988887777",
  nomeEmpresa: `Clinica Smoke ${sufixo}`,
});
console.log("OK", JSON.stringify(r));
process.exit(0);
