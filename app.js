'use strict';

/* ------------------------------------------------------------------
   Transcreve Aula
   Áudio -> 16 kHz mono -> blocos de 10 min -> Groq whisper-large-v3-turbo
   -> transcrição -> Claude -> resumo, questões e flashcards.

   Tudo roda no navegador. As chaves ficam em localStorage e não saem daqui
   a não ser para a Groq e para a Anthropic.
------------------------------------------------------------------- */

const GROQ_URL      = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODELO   = 'whisper-large-v3-turbo';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const TAXA           = 16000;  // o Whisper trabalha em 16 kHz; mandar mais é só peso
const BLOCO_SEG      = 600;    // 10 min -> ~19 MB em WAV, abaixo do limite de 25 MB da Groq
const BUSCA_CORTE    = 5;      // procura o ponto mais silencioso nestes segundos ao redor do corte
const LIMITE_GROQ_MB = 25;

/* ------------------------------------------------------------------
   Vocabulário por matéria — entra no parâmetro `prompt` da Groq.
   Medido: em áudio de sala de aula isto recupera termos técnicos que
   se perdem sem ele. Em áudio limpo é indiferente ou levemente pior.
------------------------------------------------------------------- */
const MATERIAS = {
  'Anatomia':
    'Aula de anatomia humana: posição anatômica, plano sagital, plano frontal, plano transversal, ' +
    'proximal, distal, medial, lateral, superior, inferior, anterior, posterior, cavidade craniana, ' +
    'cavidade torácica, cavidade abdominal, cavidade pélvica, encéfalo, vísceras, sistema digestório, ' +
    'sistema urogenital, períneo, escápula, esterno, úmero, rádio, ulna, carpo, metacarpo, falange, ' +
    'fêmur, tíbia, fíbula, tarso, metatarso, decúbito dorsal, decúbito ventral, dorso, tronco.',

  'Fisiologia':
    'Aula de fisiologia humana: homeostase, potencial de ação, despolarização, repolarização, sinapse, ' +
    'neurotransmissor, débito cardíaco, pressão arterial, sístole, diástole, ventilação alveolar, ' +
    'hematose, filtração glomerular, néfron, alça de Henle, osmolaridade, hormônio antidiurético, ' +
    'aldosterona, insulina, glucagon, cortisol, feedback negativo, sistema nervoso autônomo, ' +
    'simpático, parassimpático, barorreceptor.',

  'Bioquímica':
    'Aula de bioquímica: glicólise, ciclo de Krebs, cadeia transportadora de elétrons, fosforilação ' +
    'oxidativa, ATP, NADH, FADH2, gliconeogênese, glicogênese, glicogenólise, beta-oxidação, ' +
    'cetogênese, aminoácido, peptídeo, enzima, substrato, cofator, coenzima, Km, Vmax, pH, tampão, ' +
    'lipídeo, fosfolipídeo, colesterol, ácido graxo, desnaturação.',

  'Farmacologia':
    'Aula de farmacologia: farmacocinética, farmacodinâmica, absorção, distribuição, metabolização, ' +
    'excreção, biodisponibilidade, meia-vida, primeira passagem, citocromo P450, agonista, antagonista, ' +
    'receptor, dose-resposta, janela terapêutica, efeito adverso, posologia, via endovenosa, ' +
    'via intramuscular, via subcutânea, anti-inflamatório não esteroidal, corticoide, antibiótico, ' +
    'betabloqueador, inibidor da ECA.',

  'Patologia e microbiologia':
    'Aula de patologia e microbiologia: inflamação aguda, inflamação crônica, necrose, apoptose, ' +
    'hipertrofia, hiperplasia, metaplasia, displasia, neoplasia, benigno, maligno, metástase, edema, ' +
    'isquemia, infarto, trombo, êmbolo, gram-positivo, gram-negativo, bacilo, coco, vírus, fungo, ' +
    'protozoário, antibiograma, resistência bacteriana, imunidade inata, imunidade adquirida, antígeno, ' +
    'anticorpo.',

  'Enfermagem':
    'Aula de enfermagem: sistematização da assistência, SAE, diagnóstico de enfermagem, anamnese, ' +
    'sinais vitais, pressão arterial, frequência cardíaca, frequência respiratória, saturação, ' +
    'punção venosa, cateter, sonda vesical, sonda nasogástrica, curativo, úlcera por pressão, ' +
    'assepsia, antissepsia, precaução de contato, administração de medicamentos, prescrição, ' +
    'evolução de enfermagem, escala de Glasgow, escala de Braden.',

  'Fisioterapia':
    'Aula de fisioterapia: cinesioterapia, amplitude de movimento, goniometria, força muscular, ' +
    'contração isométrica, contração isotônica, flexão, extensão, abdução, adução, rotação interna, ' +
    'rotação externa, propriocepção, marcha, cadeia cinética, eletroterapia, TENS, ultrassom ' +
    'terapêutico, crioterapia, termoterapia, mobilização articular, alongamento, reabilitação, ' +
    'lesão, tendinopatia.',

  'Psicologia':
    'Aula de psicologia: comportamento, cognição, condicionamento clássico, condicionamento operante, ' +
    'reforço positivo, reforço negativo, punição, psicanálise, inconsciente, ego, superego, id, ' +
    'transferência, terapia cognitivo-comportamental, distorção cognitiva, desenvolvimento infantil, ' +
    'Piaget, Vigotski, apego, transtorno de ansiedade, depressão, DSM, entrevista clínica, escuta ativa, ' +
    'psicodiagnóstico.',

  'Odontologia':
    'Aula de odontologia: esmalte, dentina, polpa, cemento, periodonto, gengiva, cárie, placa ' +
    'bacteriana, biofilme, tártaro, restauração, resina composta, amálgama, endodontia, canal ' +
    'radicular, extração, exodontia, oclusão, mordida, incisivo, canino, pré-molar, molar, ' +
    'radiografia periapical, anestesia local, profilaxia.',

  'Direito':
    'Aula de direito: norma jurídica, princípio, doutrina, jurisprudência, súmula, acórdão, ' +
    'ação, petição inicial, contestação, réu, autor, competência, prescrição, decadência, ' +
    'tutela provisória, recurso, apelação, agravo, coisa julgada, devido processo legal, ' +
    'contraditório, ampla defesa, Código Civil, Código de Processo Civil, Constituição Federal, ' +
    'artigo, parágrafo, inciso.',

  'Outra (sem vocabulário)': ''
};

/* ------------------------------------------------------------------
   Atalhos e estado
------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const estado = {
  arquivo: null,
  transcricao: '',
  resumo: '',
  ocupado: false
};

/* ------------------------------------------------------------------
   Chaves (localStorage)
------------------------------------------------------------------- */
const guardado = {
  ler(chave, padrao = '') {
    try { return localStorage.getItem(chave) ?? padrao; } catch { return padrao; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem(chave, valor); return true; } catch { return false; }
  },
  apagar(chave) {
    try { localStorage.removeItem(chave); } catch { /* janela anônima */ }
  }
};

function carregarChaves() {
  $('chave-groq').value = guardado.ler('ta_groq');
  $('chave-anthropic').value = guardado.ler('ta_anthropic');
  const modelo = guardado.ler('ta_modelo');
  if (modelo) $('modelo-analise').value = modelo;
}

function salvarChaves() {
  const ok = guardado.gravar('ta_groq', $('chave-groq').value.trim())
    && guardado.gravar('ta_anthropic', $('chave-anthropic').value.trim())
    && guardado.gravar('ta_modelo', $('modelo-analise').value);
  $('status-chaves').textContent = ok
    ? 'Salvo neste navegador.'
    : 'Não consegui salvar — o navegador está bloqueando armazenamento (janela anônima?). As chaves valem só para esta aba.';
  atualizarBotoes();
}

/* ------------------------------------------------------------------
   Áudio: decodificar, reamostrar, fatiar, encodar WAV
------------------------------------------------------------------- */

async function decodificarMono16k(arquivo) {
  const bytes = await arquivo.arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('Este navegador não tem Web Audio API.');

  // O contexto a 16 kHz faz o navegador já devolver o áudio reamostrado.
  const ctx = new Ctx(1, 1, TAXA);

  const buffer = await new Promise((ok, falha) => {
    const p = ctx.decodeAudioData(bytes, ok, falha);
    if (p && typeof p.then === 'function') p.then(ok, falha);
  });

  // Mistura os canais em um só.
  const n = buffer.length;
  const canais = buffer.numberOfChannels;
  const mono = buffer.getChannelData(0).slice();
  for (let c = 1; c < canais; c++) {
    const dados = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += dados[i];
  }
  if (canais > 1) for (let i = 0; i < n; i++) mono[i] /= canais;

  return { amostras: mono, taxa: buffer.sampleRate || TAXA };
}

// Procura, numa janela ao redor do corte, o ponto de menor energia —
// assim a emenda entre blocos não cai no meio de uma palavra.
function melhorCorte(amostras, alvo, taxa) {
  const margem = Math.floor(BUSCA_CORTE * taxa);
  const ini = Math.max(0, alvo - margem);
  const fim = Math.min(amostras.length, alvo + margem);
  if (fim - ini < taxa) return alvo;

  const janela = Math.floor(0.05 * taxa); // 50 ms
  let melhorPos = alvo;
  let menorEnergia = Infinity;

  for (let p = ini; p + janela < fim; p += janela) {
    let energia = 0;
    for (let i = p; i < p + janela; i++) energia += amostras[i] * amostras[i];
    if (energia < menorEnergia) { menorEnergia = energia; melhorPos = p + (janela >> 1); }
  }
  return melhorPos;
}

function fatiar(amostras, taxa) {
  const porBloco = BLOCO_SEG * taxa;
  const blocos = [];
  let ini = 0;
  while (ini < amostras.length) {
    let fim = ini + porBloco;
    if (fim >= amostras.length) fim = amostras.length;
    else fim = melhorCorte(amostras, fim, taxa);
    blocos.push({ dados: amostras.subarray(ini, fim), inicioSeg: ini / taxa });
    ini = fim;
  }
  return blocos;
}

function paraWav(amostras, taxa) {
  const n = amostras.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const texto = (pos, s) => { for (let i = 0; i < s.length; i++) v.setUint8(pos + i, s.charCodeAt(i)); };

  texto(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  v.setUint32(16, 16, true);        // tamanho do bloco fmt
  v.setUint16(20, 1, true);         // PCM
  v.setUint16(22, 1, true);         // mono
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * 2, true);  // bytes por segundo
  v.setUint16(32, 2, true);         // alinhamento
  v.setUint16(34, 16, true);        // bits por amostra
  texto(36, 'data');
  v.setUint32(40, n * 2, true);

  let pos = 44;
  for (let i = 0; i < n; i++) {
    let a = amostras[i];
    a = a < -1 ? -1 : a > 1 ? 1 : a;
    v.setInt16(pos, a < 0 ? a * 0x8000 : a * 0x7fff, true);
    pos += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ------------------------------------------------------------------
   Groq
------------------------------------------------------------------- */

async function transcreverBloco(blob, chave, glossario, tentativa = 0) {
  const fd = new FormData();
  fd.append('file', blob, 'bloco.wav');
  fd.append('model', GROQ_MODELO);
  fd.append('language', 'pt');
  fd.append('response_format', 'text');
  fd.append('temperature', '0');
  if (glossario) fd.append('prompt', glossario);

  let r;
  try {
    r = await fetch(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${chave}` }, body: fd });
  } catch (e) {
    throw new Error('Não consegui falar com a Groq. Verifique a conexão. (' + e.message + ')');
  }

  if (r.status === 429 && tentativa < 4) {
    const espera = Number(r.headers.get('retry-after')) || (5 * (tentativa + 1));
    registrar(`Limite da Groq atingido. Esperando ${espera}s e tentando de novo.`);
    await new Promise((ok) => setTimeout(ok, espera * 1000));
    return transcreverBloco(blob, chave, glossario, tentativa + 1);
  }

  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    if (r.status === 401) throw new Error('A Groq recusou a chave (401). Confira em console.groq.com/keys.');
    if (r.status === 413) throw new Error('A Groq recusou o bloco por tamanho (413). Diminua BLOCO_SEG no app.js.');
    throw new Error(`Groq respondeu ${r.status}. ${corpo.slice(0, 300)}`);
  }

  return (await r.text()).trim();
}

/* ------------------------------------------------------------------
   Claude
------------------------------------------------------------------- */

const INSTRUCAO = `Você recebe a transcrição automática de uma aula gravada em sala. A transcrição
tem erros de reconhecimento, repetições e marcas de fala ("né", "então", "tá"). Trabalhe em
português do Brasil.

Produza, nesta ordem e com estes títulos exatos:

## Resumo
Os pontos da aula em texto corrido, organizado por assunto e não pela ordem em que foi falado.
Entre 300 e 600 palavras. Sem encher linguiça.

## Pontos que caem em prova
De 5 a 10 itens em lista. Cada um com o conceito e por que importa.

## Termos técnicos
Cada termo técnico citado na aula com uma definição de uma linha. Se a transcrição trouxer um
termo claramente corrompido pelo reconhecimento de voz mas reconhecível pelo contexto, escreva a
forma correta e marque com (grafia corrigida).

## Questões
10 questões de múltipla escolha, 4 alternativas cada, no nível de prova de faculdade. Depois de
todas, a lista de gabaritos com uma linha de justificativa por questão.

## Flashcards
20 cards no formato "pergunta | resposta", um por linha, resposta curta.

## Ficou em aberto
O que a transcrição sugere que foi dito mas não deu para entender, ou que o professor prometeu
e não cumpriu na gravação. Se não houver nada, escreva "Nada". Nunca invente conteúdo que não
está na transcrição para preencher seção nenhuma.`;

async function resumirComClaude(transcricao, chave, modelo) {
  let r;
  try {
    r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 16000,
        system: INSTRUCAO,
        messages: [{ role: 'user', content: `Transcrição da aula:\n\n${transcricao}` }]
      })
    });
  } catch (e) {
    throw new Error('Não consegui falar com a API da Anthropic. (' + e.message + ')');
  }

  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    if (r.status === 401) throw new Error('A Anthropic recusou a chave (401).');
    throw new Error(`Anthropic respondeu ${r.status}. ${corpo.slice(0, 300)}`);
  }

  const dados = await r.json();
  if (dados.stop_reason === 'refusal') throw new Error('O modelo recusou a requisição.');
  return (dados.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/* ------------------------------------------------------------------
   Interface
------------------------------------------------------------------- */

function registrar(msg, falha = false) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (falha) li.className = 'falha';
  $('log').appendChild(li);
  $('log').scrollTop = $('log').scrollHeight;
}

function progresso(fracao, texto) {
  $('barra-preenche').style.width = Math.round(fracao * 100) + '%';
  if (texto !== undefined) $('texto-progresso').textContent = texto;
}

function erro(msg) {
  $('texto-progresso').textContent = msg;
  $('texto-progresso').className = 'status erro';
  registrar(msg, true);
}

function duracaoLegivel(seg) {
  const m = Math.floor(seg / 60), s = Math.round(seg % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}min${String(s).padStart(2, '0')}`;
}

function atualizarBotoes() {
  $('btn-transcrever').disabled = !estado.arquivo || !$('chave-groq').value.trim() || estado.ocupado;
  $('btn-resumir').disabled = !estado.transcricao || !$('chave-anthropic').value.trim() || estado.ocupado;
}

function escolherArquivo(arquivo) {
  if (!arquivo) return;
  estado.arquivo = arquivo;
  const mb = arquivo.size / 1048576;
  $('info-arquivo').innerHTML =
    `<span><b>${arquivo.name}</b></span><span>${mb.toFixed(1)} MB</span>` +
    (mb > 300 ? '<span style="color:var(--alerta)">arquivo grande — pode faltar memória no navegador</span>' : '');
  $('info-arquivo').classList.remove('oculto');
  atualizarBotoes();
}

// Markdown mínimo — só o que a instrução acima pede.
function paraHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const linhas = esc(md).split('\n');
  let html = '', lista = null;

  const fecharLista = () => { if (lista) { html += `</${lista}>`; lista = null; } };

  for (const linha of linhas) {
    const t = linha.trim();
    if (!t) { fecharLista(); continue; }

    const h2 = t.match(/^##\s+(.*)/);
    const h3 = t.match(/^###\s+(.*)/);
    const li = t.match(/^[-*]\s+(.*)/);
    const ol = t.match(/^(\d+)[.)]\s+(.*)/);

    const inline = (s) => s
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

    if (h2)      { fecharLista(); html += `<h2>${inline(h2[1])}</h2>`; }
    else if (h3) { fecharLista(); html += `<h3>${inline(h3[1])}</h3>`; }
    else if (li) { if (lista !== 'ul') { fecharLista(); html += '<ul>'; lista = 'ul'; } html += `<li>${inline(li[1])}</li>`; }
    else if (ol) { if (lista !== 'ol') { fecharLista(); html += '<ol>'; lista = 'ol'; } html += `<li>${inline(ol[2])}</li>`; }
    else if (/^---+$/.test(t)) { fecharLista(); html += '<hr>'; }
    else         { fecharLista(); html += `<p>${inline(t)}</p>`; }
  }
  fecharLista();
  return html;
}

function baixar(nome, texto, tipo = 'text/plain') {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------
   Fluxo principal
------------------------------------------------------------------- */

async function transcrever() {
  const chave = $('chave-groq').value.trim();
  if (!chave || !estado.arquivo) return;

  estado.ocupado = true;
  atualizarBotoes();
  $('painel-progresso').classList.remove('oculto');
  $('texto-progresso').className = 'status';
  $('log').innerHTML = '';
  progresso(0, 'Lendo o arquivo…');

  try {
    const t0 = performance.now();
    const { amostras, taxa } = await decodificarMono16k(estado.arquivo);
    const dur = amostras.length / taxa;
    registrar(`Áudio: ${duracaoLegivel(dur)} a ${taxa} Hz, mono.`);

    const blocos = fatiar(amostras, taxa);
    registrar(`Dividido em ${blocos.length} bloco(s) de até ${BLOCO_SEG / 60} min.`);
    progresso(0.05, `Transcrevendo 0 de ${blocos.length}…`);

    const glossario = $('glossario').value.trim();
    const partes = [];

    for (let i = 0; i < blocos.length; i++) {
      const wav = paraWav(blocos[i].dados, taxa);
      const mb = wav.size / 1048576;
      if (mb > LIMITE_GROQ_MB) {
        throw new Error(`O bloco ${i + 1} ficou com ${mb.toFixed(1)} MB, acima do limite de ${LIMITE_GROQ_MB} MB da Groq.`);
      }
      const texto = await transcreverBloco(wav, chave, glossario);
      partes.push(texto);
      registrar(`Bloco ${i + 1}/${blocos.length} — ${mb.toFixed(1)} MB, ${texto.split(/\s+/).length} palavras.`);
      progresso(0.05 + 0.95 * ((i + 1) / blocos.length), `Transcrevendo ${i + 1} de ${blocos.length}…`);
    }

    estado.transcricao = partes.join('\n\n');
    const seg = (performance.now() - t0) / 1000;
    progresso(1, `Pronto: ${estado.transcricao.split(/\s+/).length} palavras em ${duracaoLegivel(seg)}.`);

    $('conteudo-transcricao').textContent = estado.transcricao;
    $('painel-resultado').classList.remove('oculto');
    trocarAba('saida-transcricao');
    $('painel-resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    erro(e.message);
  } finally {
    estado.ocupado = false;
    atualizarBotoes();
  }
}

async function resumir() {
  const chave = $('chave-anthropic').value.trim();
  if (!chave || !estado.transcricao) return;

  estado.ocupado = true;
  atualizarBotoes();
  $('conteudo-resumo').innerHTML = '<p class="status">Lendo a aula e escrevendo…</p>';
  trocarAba('saida-resumo');

  try {
    estado.resumo = await resumirComClaude(estado.transcricao, chave, $('modelo-analise').value);
    $('conteudo-resumo').innerHTML = paraHtml(estado.resumo);
    $('btn-baixar-resumo').classList.remove('oculto');
  } catch (e) {
    $('conteudo-resumo').innerHTML = `<p class="status erro">${e.message}</p>`;
  } finally {
    estado.ocupado = false;
    atualizarBotoes();
  }
}

function trocarAba(alvo) {
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.alvo === alvo));
  document.querySelectorAll('.painel-aba').forEach((p) => p.classList.toggle('oculto', p.id !== alvo));
}

/* ------------------------------------------------------------------
   Ligações
------------------------------------------------------------------- */

function iniciar() {
  // matérias
  const sel = $('materia');
  Object.keys(MATERIAS).forEach((nome) => {
    const o = document.createElement('option');
    o.value = nome; o.textContent = nome;
    sel.appendChild(o);
  });
  const salva = guardado.ler('ta_materia', 'Anatomia');
  sel.value = MATERIAS[salva] !== undefined ? salva : 'Anatomia';
  $('glossario').value = MATERIAS[sel.value];

  sel.addEventListener('change', () => {
    $('glossario').value = MATERIAS[sel.value];
    guardado.gravar('ta_materia', sel.value);
  });

  carregarChaves();
  if (!$('chave-groq').value) $('painel-config').classList.remove('oculto');

  $('btn-config').addEventListener('click', () => $('painel-config').classList.toggle('oculto'));
  $('btn-salvar-chaves').addEventListener('click', salvarChaves);
  $('btn-limpar-chaves').addEventListener('click', () => {
    ['ta_groq', 'ta_anthropic'].forEach(guardado.apagar);
    $('chave-groq').value = ''; $('chave-anthropic').value = '';
    $('status-chaves').textContent = 'Chaves apagadas deste navegador.';
    atualizarBotoes();
  });
  ['chave-groq', 'chave-anthropic'].forEach((id) => $(id).addEventListener('input', atualizarBotoes));

  $('btn-escolher').addEventListener('click', () => $('arquivo').click());
  $('arquivo').addEventListener('change', (e) => escolherArquivo(e.target.files[0]));

  const area = $('area-solta');
  ['dragenter', 'dragover'].forEach((ev) => area.addEventListener(ev, (e) => {
    e.preventDefault(); area.classList.add('ativa');
  }));
  ['dragleave', 'drop'].forEach((ev) => area.addEventListener(ev, (e) => {
    e.preventDefault(); area.classList.remove('ativa');
  }));
  area.addEventListener('drop', (e) => escolherArquivo(e.dataTransfer.files[0]));

  $('btn-transcrever').addEventListener('click', transcrever);
  $('btn-resumir').addEventListener('click', resumir);

  document.querySelectorAll('.aba').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.alvo)));

  $('btn-baixar-transcricao').addEventListener('click', () =>
    baixar(`transcricao-${$('materia').value.toLowerCase().replace(/\W+/g, '-')}.txt`, estado.transcricao));
  $('btn-baixar-resumo').addEventListener('click', () =>
    baixar(`resumo-${$('materia').value.toLowerCase().replace(/\W+/g, '-')}.md`, estado.resumo, 'text/markdown'));
  $('btn-copiar').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(estado.transcricao);
      $('btn-copiar').textContent = 'Copiado';
      setTimeout(() => { $('btn-copiar').textContent = 'Copiar'; }, 1500);
    } catch {
      $('btn-copiar').textContent = 'O navegador bloqueou a cópia';
    }
  });

  atualizarBotoes();
}

document.addEventListener('DOMContentLoaded', iniciar);
