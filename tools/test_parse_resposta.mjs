// Teste do interpretador de respostas (roda no Node, sem navegador).
import { interpretarResposta, paraNumero } from "../assets/parse-resposta.js";

const itens = [
  { cotacao_item_id: "1", sku: "77", ean: "7891000100103", quantidade: 5, descricao: "VEUVE" },
  { cotacao_item_id: "2", sku: "543", ean: "543", quantidade: 5, descricao: "MONTE PASCHOAL" },
  { cotacao_item_id: "3", sku: "SKU-002", ean: "7899999000011", quantidade: 2, descricao: "PORCA" },
  { cotacao_item_id: "4", sku: "66", ean: "66", quantidade: 5, descricao: "MOET" },
];

let falhas = 0;

function checar(rotulo, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU ${rotulo}: obtido ${JSON.stringify(obtido)} esperado ${JSON.stringify(esperado)}`);
  } else {
    console.log(`ok ${rotulo}`);
  }
}

console.log("== paraNumero ==");
checar("56,00", paraNumero("56,00"), 56);
checar("56.00", paraNumero("56.00"), 56);
checar("1.234,56", paraNumero("1.234,56"), 1234.56);
checar("1.234", paraNumero("1.234"), 1234);
checar("R$ 7,00", paraNumero("R$ 7,00"), 7);
checar("texto", paraNumero("abc"), null);

console.log("\n== formatos de linha ==");
const casos = [
  ["77 = 56,00", [["77", 56, true]]],
  ["77: R$ 56,00", [["77", 56, true]]],
  ["SKU-002 - 12.50", [["SKU-002", 12.5, true]]],
  ["543 7,00", [["543", 7, true]]],
  ["7891000100103 = 56,00", [["77", 56, true]]],
  ["66 indisponível", [["66", 0, false]]],
  ["77 = 56,00; 543 = 7,00", [["77", 56, true], ["543", 7, true]]],
];

for (const [texto, esperado] of casos) {
  const r = interpretarResposta(texto, itens);
  const obtido = r.linhas.map((l) => [l.item.sku, l.valor, l.disponivel]);
  checar(JSON.stringify(texto), obtido, esperado);
}

console.log("\n== não encontrados ==");
const r = interpretarResposta("77 = 56,00\nitem 999 = 10,00\nbom dia", itens);
console.log("linhas:", r.linhas.map((l) => `${l.item.sku} ${l.valor}`));
console.log("não encontrados:", r.naoEncontrados);
checar("ignora desconhecidos", r.naoEncontrados.length, 2);
checar("não repete item", r.linhas.length, 1);

console.log("\n== total ==");
const t = interpretarResposta("77 = 56,00\n543 = 7,00", itens);
checar("5x77 + 5x543", Math.round(t.total * 100) / 100, 315);

console.log(`\nfalhas: ${falhas}`);
process.exit(falhas === 0 ? 0 : 1);
