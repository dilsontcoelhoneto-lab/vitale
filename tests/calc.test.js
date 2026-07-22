// =====================================================
// VITALE — testes dos cálculos clínicos
// Rodar:  node tests/calc.test.js
// Sem dependências. Sai com código 1 se algum teste falhar.
// Cobre os casos que a auditoria v5.6 revelou como bugs.
// =====================================================
const C = require('../assets/js/vitale-calc.js');

let passou = 0, falhou = 0;
function ok(nome, cond) {
  if (cond) { passou++; console.log('  ✓ ' + nome); }
  else { falhou++; console.log('  ✗ ' + nome); }
}
function perto(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 0.01 : tol); }

// datas relativas para os testes de velocidade
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

console.log('\nIMC e faixas');
ok('IMC 109,9kg / 1,84m ≈ 32,47', perto(C.calcIMC(109.9, 1.84), 32.47, 0.02));
ok('IMC rejeita altura 0', C.calcIMC(80, 0) === null);
ok('faixa 32,5 = Obesidade I', C.faixaIMC(32.5).grau === 'Obesidade I');
ok('faixa 24,9 = Peso Normal', C.faixaIMC(24.9).grau === 'Peso Normal');
ok('faixa 30 = Obesidade I (limite)', C.faixaIMC(30).grau === 'Obesidade I');
ok('faixa 29,9 = Sobrepeso', C.faixaIMC(29.9).grau === 'Sobrepeso');

console.log('\nAltura válida (bug v5.5)');
ok('1,84 é válida', C.alturaValida(1.84) === 1.84);
ok('null quando ausente (não usa 1,70)', C.alturaValida(undefined) === null);
ok('rejeita 0,5', C.alturaValida(0.5) === null);
ok('rejeita 3,0', C.alturaValida(3.0) === null);

console.log('\nPeso-alvo por IMC (metas em cascata)');
ok('IMC 35 @ 1,84m = 118,5 kg (não 101,1)', C.pesoAlvoIMC(35, 1.84) === 118.5);
ok('IMC 30 @ 1,84m = 101,6 kg', C.pesoAlvoIMC(30, 1.84) === 101.6);

console.log('\nVelocidade (bug v5.6 — janela recente, não histórico)');
// Caso Dilson: perdeu muito no início, estável agora
const estagnado = [
  { data: diasAtras(300), peso: 130 },
  { data: diasAtras(120), peso: 110 },
  { data: diasAtras(20), peso: 110.2 },
  { data: diasAtras(3), peso: 110.0 }
];
const vEst = C.velocidade(estagnado);
ok('estagnado: base recente', vEst.base === 'recente');
ok('estagnado: ritmo ~0 (não 0,4+)', Math.abs(vEst.kgDia * 7) < 0.15);
// Perdendo de verdade agora
const perdendo = [
  { data: diasAtras(28), peso: 92 },
  { data: diasAtras(14), peso: 90.5 },
  { data: diasAtras(1), peso: 89 }
];
const vPerd = C.velocidade(perdendo);
ok('perdendo: kg/dia positivo', vPerd.kgDia > 0);
ok('perdendo: confiável (>=7 dias)', vPerd.confiavel === true);
ok('1 ponto só = sem dados', C.velocidade([{ data: diasAtras(1), peso: 80 }]).base === 'sem_dados');

console.log('\nTMB (bug v5.6 — sexo e idade reais)');
// Homem 46, 110kg, 184cm
ok('homem 46a: +5 na fórmula', C.tmbMifflin(110, 184, 46, 'masculino') === Math.round(10*110 + 6.25*184 - 5*46 + 5));
// Mulher mesma antropometria: -161 (diferença de 166 vs +5)
const th = C.tmbMifflin(110, 184, 46, 'masculino');
const tm = C.tmbMifflin(110, 184, 46, 'feminino');
ok('mulher difere do homem em 166 kcal', th - tm === 166);
ok('sem sexo/idade → null (não estima)', C.tmbMifflin(110, 184, null, 'm') === null);
ok('idade calculada de nascimento', C.idadeDe('1980-01-01') >= 44);

console.log('\nStatus de marcador');
ok('glicose 83, meta ≤90 → ótimo', C.statusMarcador(83, 70, 99, { max: 90 }) === 'otimo');
ok('HbA1c 5,6 na ref mas > meta 5,4 → atencao', C.statusMarcador(5.6, null, 5.7, { max: 5.4 }) === 'atencao');
ok('HDL 34 < ref 40 → fora', C.statusMarcador(34, 40, null, { min: 50 }) === 'fora');
ok('sem meta otim → ok dentro da ref', C.statusMarcador(1.0, null, 1.3, null) === 'ok');

console.log('\nRCQ e caloria de exercício');
ok('RCQ 96/102 ≈ 0,94', perto(C.rcq(96, 102), 0.941, 0.01));
ok('caminhada MET 3,5 × 80kg × 40min ≈ 187', C.calExercicio(3.5, 80, 40) === 187);

console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${passou} passaram, ${falhou} falharam`);
console.log('='.repeat(40) + '\n');
process.exit(falhou > 0 ? 1 : 0);
