import { registrar } from "@/server/dal/organizacao";
import { comOrg } from "@/server/db";

const sufixo = Date.now();
const r = await registrar({
  email: `smoke-onb-${sufixo}@exemplo.com`,
  senha: "senhaforte123",
  nome: "Smoke Onboarding",
  telefone: "11988887777",
  nomeEmpresa: `Clinica Smoke Onb ${sufixo}`,
});

// Mesmos valores que o formulário de onboarding envia por padrão
// (checkboxes de OBJETIVOS em src/app/onboarding/form.tsx), que não são
// membros do enum `feature` e antes quebravam este UPDATE.
const objetivos = ["responder", "agendar", "cobrar", "qualificar", "orcamento", "pos-venda"];

await comOrg(r.orgId, async (tx) => {
  await tx`
    UPDATE organizacao SET
      objetivos = ${objetivos},
      onboarding_completo = true
    WHERE id = ${r.orgId}
  `;
});

const [linha] = await comOrg(r.orgId, (tx) => tx`SELECT objetivos, onboarding_completo FROM organizacao WHERE id = ${r.orgId}`);
console.log("OK", JSON.stringify(linha));
process.exit(0);
