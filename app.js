'use strict';

/* ------------------------------------------------------------------
   Transcreve Aula

   Arquivo -> 16 kHz mono -> blocos de 5 min -> Groq whisper-large-v3-turbo
   -> transcrição -> Claude (saída estruturada) -> resumo, pontos de prova,
   termos, questões clicáveis e flashcards viráveis.

   Roda inteiro no navegador. As chaves ficam em localStorage e só saem
   daqui para a Groq e para a Anthropic.
------------------------------------------------------------------- */

const GROQ_URL      = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODELO   = 'whisper-large-v3-turbo';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const TAXA           = 16000;  // o Whisper trabalha em 16 kHz; mandar mais é só peso
const BLOCO_SEG      = 300;    // 5 min -> ~9,6 MB. 10 min (19 MB) estourava o upload
const BUSCA_CORTE    = 5;      // procura o ponto mais silencioso nestes segundos ao redor do corte
const LIMITE_GROQ_MB = 25;
const TIMEOUT_MS     = 180000;

/* ------------------------------------------------------------------
   Vocabulário por matéria — vai no parâmetro `prompt` da Groq.
   Medido: em áudio de sala recupera termos que se perdem sem ele;
   em áudio limpo é indiferente.
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

  'Patologia':
    'Aula de patologia e microbiologia: inflamação aguda, inflamação crônica, necrose, apoptose, ' +
    'hipertrofia, hiperplasia, metaplasia, displasia, neoplasia, benigno, maligno, metástase, edema, ' +
    'isquemia, infarto, trombo, êmbolo, gram-positivo, gram-negativo, bacilo, coco, vírus, fungo, ' +
    'protozoário, antibiograma, resistência bacteriana, imunidade inata, imunidade adquirida, ' +
    'antígeno, anticorpo.',

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
    'Piaget, Vigotski, apego, transtorno de ansiedade, depressão, DSM, entrevista clínica, ' +
    'escuta ativa, psicodiagnóstico.',

  'Odontologia':
    'Aula de odontologia: esmalte, dentina, polpa, cemento, periodonto, gengiva, cárie, placa ' +
    'bacteriana, biofilme, tártaro, restauração, resina composta, amálgama, endodontia, canal ' +
    'radicular, extração, exodontia, oclusão, mordida, incisivo, canino, pré-molar, molar, ' +
    'radiografia periapical, anestesia local, profilaxia.',

  'Direito':
    'Aula de direito: norma jurídica, princípio, doutrina, jurisprudência, súmula, acórdão, ação, ' +
    'petição inicial, contestação, réu, autor, competência, prescrição, decadência, tutela ' +
    'provisória, recurso, apelação, agravo, coisa julgada, devido processo legal, contraditório, ' +
    'ampla defesa, Código Civil, Código de Processo Civil, Constituição Federal, artigo, ' +
    'parágrafo, inciso.',

  'Outra': ''
};

/* ------------------------------------------------------------------
   Estado
------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const estado = {
  arquivo: null,
  materia: 'Anatomia',
  envelope: null,     // amostras reduzidas para desenhar a forma de onda
  duracao: 0,
  blocos: 0,
  blocosProntos: 0,
  transcricao: '',
  estudo: null,       // objeto estruturado devolvido pelo Claude
  ocupado: false,
  cancelar: false
};

/* ------------------------------------------------------------------
   localStorage
------------------------------------------------------------------- */
const guardado = {
  ler(c, p = '') { try { return localStorage.getItem(c) ?? p; } catch { return p; } },
  gravar(c, v) { try { localStorage.setItem(c, v); return true; } catch { return false; } },
  apagar(c) { try { localStorage.removeItem(c); } catch { /* janela anônima */ } }
};

/* ------------------------------------------------------------------
   Áudio
------------------------------------------------------------------- */

async function decodificarMono16k(arquivo) {
  const bytes = await arquivo.arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('Este navegador não tem Web Audio API.');

  const ctx = new Ctx(1, 1, TAXA);   // o contexto a 16 kHz já devolve reamostrado
  const buffer = await new Promise((ok, falha) => {
    const p = ctx.decodeAudioData(bytes, ok, falha);
    if (p && typeof p.then === 'function') p.then(ok, falha);
  });

  const n = buffer.length;
  const canais = buffer.numberOfChannels;
  const mono = buffer.getChannelData(0).slice();
  for (let c = 1; c < canais; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i];
  }
  if (canais > 1) for (let i = 0; i < n; i++) mono[i] /= canais;

  return { amostras: mono, taxa: buffer.sampleRate || TAXA };
}

// Reduz o áudio a ~600 picos, o suficiente para desenhar a forma de onda.
function envelopar(amostras, colunas = 600) {
  const passo = Math.floor(amostras.length / colunas) || 1;
  const picos = new Float32Array(colunas);
  let teto = 0;
  for (let c = 0; c < colunas; c++) {
    let pico = 0;
    const ini = c * passo;
    const fim = Math.min(ini + passo, amostras.length);
    for (let i = ini; i < fim; i += 7) {          // amostragem esparsa: sobra fidelidade
      const v = amostras[i] < 0 ? -amostras[i] : amostras[i];
      if (v > pico) pico = v;
    }
    picos[c] = pico;
    if (pico > teto) teto = pico;
  }
  if (teto > 0) for (let c = 0; c < colunas; c++) picos[c] /= teto;
  return picos;
}

function desenharOnda(canvas, picos, fracaoFeita = 0) {
  if (!canvas || !picos) return;
  const css = getComputedStyle(document.body);
  const feito = css.getPropertyValue('--roxo').trim() || '#6b4cf6';
  const cru = css.getPropertyValue('--linha-forte').trim() || '#d6d1c8';

  const dpr = window.devicePixelRatio || 1;
  const larg = canvas.clientWidth || 900;
  const alt = canvas.clientHeight || 96;
  canvas.width = Math.round(larg * dpr);
  canvas.height = Math.round(alt * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, larg, alt);

  const n = picos.length;
  const passo = larg / n;
  const barra = Math.max(1.2, passo * 0.62);
  const meio = alt / 2;
  const corte = fracaoFeita * n;

  for (let i = 0; i < n; i++) {
    const h = Math.max(2, picos[i] * (alt * 0.86));
    ctx.fillStyle = i <= corte ? feito : cru;
    ctx.globalAlpha = i <= corte ? 1 : 0.5;
    const x = i * passo + (passo - barra) / 2;
    ctx.beginPath();
    ctx.roundRect(x, meio - h / 2, barra, h, barra / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// O corte entre blocos cai no trecho mais silencioso da janela, para não partir palavra.
function melhorCorte(amostras, alvo, taxa) {
  const margem = Math.floor(BUSCA_CORTE * taxa);
  const ini = Math.max(0, alvo - margem);
  const fim = Math.min(amostras.length, alvo + margem);
  if (fim - ini < taxa) return alvo;

  const janela = Math.floor(0.05 * taxa);
  let melhor = alvo, menor = Infinity;
  for (let p = ini; p + janela < fim; p += janela) {
    let e = 0;
    for (let i = p; i < p + janela; i++) e += amostras[i] * amostras[i];
    if (e < menor) { menor = e; melhor = p + (janela >> 1); }
  }
  return melhor;
}

function fatiar(amostras, taxa) {
  const porBloco = BLOCO_SEG * taxa;
  const blocos = [];
  let ini = 0;
  while (ini < amostras.length) {
    let fim = ini + porBloco;
    if (fim >= amostras.length) fim = amostras.length;
    else fim = melhorCorte(amostras, fim, taxa);
    blocos.push(amostras.subarray(ini, fim));
    ini = fim;
  }
  return blocos;
}

function paraWav(amostras, taxa) {
  const n = amostras.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };

  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, 'data'); v.setUint32(40, n * 2, true);

  let p = 44;
  for (let i = 0; i < n; i++) {
    let a = amostras[i];
    a = a < -1 ? -1 : a > 1 ? 1 : a;
    v.setInt16(p, a < 0 ? a * 0x8000 : a * 0x7fff, true);
    p += 2;
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
    r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}` },
      body: fd,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    const expirou = e.name === 'TimeoutError' || e.name === 'AbortError';
    if (expirou && tentativa < 2) return transcreverBloco(blob, chave, glossario, tentativa + 1);
    if (expirou) throw new Error('O envio do áudio estourou o tempo três vezes. Costuma ser internet lenta.');
    throw new Error('Não consegui falar com a Groq. Verifique a conexão.');
  }

  if (r.status === 429 && tentativa < 4) {
    const espera = Number(r.headers.get('retry-after')) || (5 * (tentativa + 1));
    await new Promise((ok) => setTimeout(ok, espera * 1000));
    return transcreverBloco(blob, chave, glossario, tentativa + 1);
  }

  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    if (r.status === 401) throw new Error('A Groq recusou a chave. Confira em console.groq.com/keys.');
    if (r.status === 413) throw new Error('A Groq recusou o bloco por tamanho.');
    throw new Error(`Groq respondeu ${r.status}. ${corpo.slice(0, 200)}`);
  }
  return (await r.text()).trim();
}

/* ------------------------------------------------------------------
   Claude — saída estruturada
------------------------------------------------------------------- */

const ESQUEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string' },
    assunto_em_uma_linha: { type: 'string' },
    resumo: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tema: { type: 'string' }, texto: { type: 'string' } },
        required: ['tema', 'texto'],
        additionalProperties: false
      }
    },
    pontos_prova: { type: 'array', items: { type: 'string' } },
    termos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          termo: { type: 'string' },
          definicao: { type: 'string' },
          grafia_corrigida: { type: 'boolean' }
        },
        required: ['termo', 'definicao', 'grafia_corrigida'],
        additionalProperties: false
      }
    },
    questoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pergunta: { type: 'string' },
          alternativas: { type: 'array', items: { type: 'string' } },
          correta: { type: 'integer' },
          porque: { type: 'string' }
        },
        required: ['pergunta', 'alternativas', 'correta', 'porque'],
        additionalProperties: false
      }
    },
    flashcards: {
      type: 'array',
      items: {
        type: 'object',
        properties: { frente: { type: 'string' }, verso: { type: 'string' } },
        required: ['frente', 'verso'],
        additionalProperties: false
      }
    },
    em_aberto: { type: 'array', items: { type: 'string' } }
  },
  required: ['titulo', 'assunto_em_uma_linha', 'resumo', 'pontos_prova', 'termos',
             'questoes', 'flashcards', 'em_aberto'],
  additionalProperties: false
};

const INSTRUCAO = `Você recebe a transcrição automática de uma aula gravada em sala, em português
do Brasil. A transcrição tem erros de reconhecimento, repetições e marcas de fala ("né", "então").

Regras:
- 4 a 7 blocos de resumo, organizados por assunto e não pela ordem em que foi falado. Cada
  texto entre 60 e 120 palavras.
- 5 a 10 pontos que caem em prova, cada um dizendo o conceito e por que importa.
- Todo termo técnico citado, com definição de uma linha. Se o reconhecimento corrompeu um termo
  mas o contexto deixa claro qual é, escreva a forma correta e marque grafia_corrigida como true.
- 10 questões de múltipla escolha com 4 alternativas, nível de prova de faculdade. O campo
  "correta" é o índice da alternativa certa, de 0 a 3. Varie a posição da resposta certa.
- 20 flashcards, frente curta e verso curto.
- Em em_aberto, o que a transcrição sugere que foi dito mas não deu para entender. Lista vazia
  se não houver.

Nunca invente conteúdo que não está na transcrição para preencher seção nenhuma. Se a aula for
curta demais para 10 questões ou 20 flashcards, faça menos.`;

async function gerarEstudo(transcricao, chave, modelo) {
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
        messages: [{ role: 'user', content: `Transcrição da aula:\n\n${transcricao}` }],
        output_config: { format: { type: 'json_schema', schema: ESQUEMA } }
      })
    });
  } catch {
    throw new Error('Não consegui falar com a API da Anthropic.');
  }

  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    if (r.status === 401) throw new Error('A Anthropic recusou a chave.');
    if (r.status === 429) throw new Error('Limite da Anthropic atingido. Tente daqui a pouco.');
    throw new Error(`Anthropic respondeu ${r.status}. ${corpo.slice(0, 200)}`);
  }

  const dados = await r.json();
  if (dados.stop_reason === 'refusal') throw new Error('O modelo recusou a requisição.');

  const texto = (dados.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(texto);
  } catch {
    const a = texto.indexOf('{'), b = texto.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(texto.slice(a, b + 1));
    throw new Error('A resposta do modelo não veio no formato esperado.');
  }
}

/* ------------------------------------------------------------------
   Etapas da tela de processamento
------------------------------------------------------------------- */

const etapas = {
  lista: [],
  montar(nomes) {
    this.lista = nomes;
    $('etapas').innerHTML = nomes
      .map((n, i) => `<li data-i="${i}"><span class="bolha"></span><span>${n}</span></li>`)
      .join('');
  },
  estado(i, classe, texto) {
    const li = $('etapas').querySelector(`[data-i="${i}"]`);
    if (!li) return;
    li.className = classe;
    if (texto) li.lastElementChild.textContent = texto;
  }
};

function mostrarTela(qual) {
  ['tela-entrada', 'tela-processando', 'tela-resultado']
    .forEach((t) => $(t).classList.toggle('oculto', t !== qual));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------------------------------------------
   Fluxo: transcrever
------------------------------------------------------------------- */

async function transcrever() {
  const chave = $('chave-groq').value.trim();
  if (!chave) { abrirGaveta(); return; }
  if (!estado.arquivo || estado.ocupado) return;

  estado.ocupado = true;
  estado.cancelar = false;
  mostrarTela('tela-processando');
  etapas.montar(['Preparando o áudio', 'Transcrevendo', 'Juntando o texto']);
  etapas.estado(0, 'fazendo');
  $('titulo-processo').textContent = 'Preparando o áudio…';
  $('detalhe-processo').textContent = 'Convertendo para o formato que o motor entende.';

  try {
    const t0 = performance.now();
    const { amostras, taxa } = await decodificarMono16k(estado.arquivo);
    estado.duracao = amostras.length / taxa;
    estado.envelope = envelopar(amostras);
    desenharOnda($('onda-progresso'), estado.envelope, 0);

    const blocos = fatiar(amostras, taxa);
    estado.blocos = blocos.length;
    etapas.estado(0, 'feito', `Áudio pronto — ${duracaoLegivel(estado.duracao)}, ${blocos.length} parte(s)`);
    etapas.estado(1, 'fazendo');

    const glossario = $('glossario').value.trim();
    const partes = [];

    for (let i = 0; i < blocos.length; i++) {
      if (estado.cancelar) throw new Error('cancelado');

      const wav = paraWav(blocos[i], taxa);
      const mb = wav.size / 1048576;
      if (mb > LIMITE_GROQ_MB) throw new Error(`Um bloco ficou com ${mb.toFixed(1)} MB, acima do limite da Groq.`);

      $('titulo-processo').textContent = `Transcrevendo parte ${i + 1} de ${blocos.length}`;
      $('detalhe-processo').textContent = `Enviando ${mb.toFixed(1)} MB para o motor. Pode deixar a aba aberta.`;
      etapas.estado(1, 'fazendo', `Transcrevendo — parte ${i + 1} de ${blocos.length}`);

      partes.push(await transcreverBloco(wav, chave, glossario));
      estado.blocosProntos = i + 1;
      desenharOnda($('onda-progresso'), estado.envelope, (i + 1) / blocos.length);
    }

    etapas.estado(1, 'feito', `Transcrito — ${blocos.length} parte(s)`);
    etapas.estado(2, 'fazendo');

    estado.transcricao = partes.join('\n\n');
    const palavras = estado.transcricao.split(/\s+/).filter(Boolean).length;
    const seg = (performance.now() - t0) / 1000;
    etapas.estado(2, 'feito', `Pronto — ${palavras} palavras em ${duracaoLegivel(seg)}`);

    montarResultado(palavras);
    mostrarTela('tela-resultado');

    // se a chave da Anthropic já está salva, emenda direto no resumo
    if ($('chave-anthropic').value.trim()) resumir();
  } catch (e) {
    if (e.message === 'cancelado') {
      mostrarTela('tela-entrada');
    } else {
      const emAndamento = $('etapas').querySelector('.fazendo');
      if (emAndamento) { emAndamento.className = 'falhou'; emAndamento.lastElementChild.textContent = e.message; }
      $('titulo-processo').textContent = 'Não deu certo';
      $('detalhe-processo').textContent = e.message;
      $('detalhe-processo').className = 'hero-sub erro-texto';
    }
  } finally {
    estado.ocupado = false;
  }
}

/* ------------------------------------------------------------------
   Fluxo: resumir
------------------------------------------------------------------- */

async function resumir() {
  const chave = $('chave-anthropic').value.trim();
  if (!chave) { abrirGaveta(); return; }
  if (!estado.transcricao || estado.ocupado) return;

  estado.ocupado = true;
  $('chamada-resumo').innerHTML =
    '<div><strong>Lendo a aula…</strong><p>Escrevendo resumo, questões e flashcards. ' +
    'Costuma levar de 20 a 60 segundos.</p></div>';

  try {
    estado.estudo = await gerarEstudo(estado.transcricao, chave, $('modelo-analise').value);
    $('chamada-resumo').classList.add('oculto');
    pintarEstudo(estado.estudo);
  } catch (e) {
    $('chamada-resumo').innerHTML =
      `<div><strong class="erro-texto">Não deu certo</strong><p>${e.message}</p></div>` +
      '<button id="btn-resumir" class="pill pill-forte" type="button">Tentar de novo</button>';
    $('btn-resumir').addEventListener('click', resumir);
  } finally {
    estado.ocupado = false;
  }
}

/* ------------------------------------------------------------------
   Montagem do resultado
------------------------------------------------------------------- */

function montarResultado(palavras) {
  $('resultado-materia').textContent = estado.materia;
  $('resultado-titulo').textContent = estado.arquivo.name.replace(/\.[^.]+$/, '');
  $('resultado-meta').textContent =
    `${duracaoLegivel(estado.duracao)} de aula · ${palavras} palavras transcritas`;
  $('corpo-transcricao').textContent = estado.transcricao;
  $('chamada-resumo').classList.toggle('oculto', false);
  trocarAba('ab-resumo');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pintarEstudo(d) {
  $('resultado-titulo').textContent = d.titulo || $('resultado-titulo').textContent;
  $('chamada-resumo').classList.add('oculto');   // o convite só existe enquanto não há resumo

  // resumo
  $('corpo-resumo').innerHTML =
    (d.assunto_em_uma_linha ? `<p class="chapeu">${esc(d.assunto_em_uma_linha)}</p>` : '') +
    (d.resumo || []).map((b) =>
      `<div class="bloco"><h3>${esc(b.tema)}</h3><p>${esc(b.texto)}</p></div>`).join('') +
    ((d.termos || []).length
      ? `<div class="bloco"><h3>Termos técnicos</h3>${d.termos.map((t) =>
          `<div class="termo"><b>${esc(t.termo)}${t.grafia_corrigida ? '<span class="selo">grafia corrigida</span>' : ''}</b>` +
          `<span>${esc(t.definicao)}</span></div>`).join('')}</div>`
      : '') +
    ((d.em_aberto || []).length
      ? `<div class="bloco"><h3>Ficou em aberto</h3><p>${d.em_aberto.map(esc).join('<br>')}</p></div>`
      : '');

  // cai na prova
  $('corpo-prova').innerHTML = (d.pontos_prova || []).length
    ? `<ol class="lista-prova">${d.pontos_prova.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`
    : '<div class="bloco"><p>A aula não rendeu pontos de prova.</p></div>';

  // questões
  const qs = d.questoes || [];
  $('corpo-questoes').innerHTML =
    `<div class="placar" id="placar">Responda para ver o gabarito <span id="placar-conta"></span></div>` +
    qs.map((q, i) =>
      `<div class="questao" data-q="${i}">
         <p class="questao-pergunta">${i + 1}. ${esc(q.pergunta)}</p>
         ${(q.alternativas || []).map((a, j) =>
           `<button class="alt" data-q="${i}" data-a="${j}" type="button">
              <span class="letra">${'ABCD'[j] || j + 1}</span>${esc(a)}
            </button>`).join('')}
         <p class="porque oculto" data-porque="${i}">${esc(q.porque)}</p>
       </div>`).join('');

  const respondidas = new Set();
  let acertos = 0;
  $('corpo-questoes').querySelectorAll('.alt').forEach((b) => {
    b.addEventListener('click', () => {
      const iq = Number(b.dataset.q), ia = Number(b.dataset.a);
      if (respondidas.has(iq)) return;
      respondidas.add(iq);

      const certa = qs[iq].correta;
      const caixa = $('corpo-questoes').querySelector(`.questao[data-q="${iq}"]`);
      caixa.querySelectorAll('.alt').forEach((alt) => {
        const ja = Number(alt.dataset.a);
        alt.disabled = true;
        if (ja === certa) alt.classList.add('certa');
        else if (ja === ia) alt.classList.add('errada');
      });
      caixa.querySelector(`[data-porque="${iq}"]`).classList.remove('oculto');
      if (ia === certa) acertos++;
      $('placar').firstChild.textContent = `${acertos} de ${respondidas.size} `;
      $('placar-conta').textContent = `· ${qs.length - respondidas.size} restantes`;
    });
  });

  // flashcards
  $('corpo-cards').innerHTML =
    `<div class="cards">${(d.flashcards || []).map((c) =>
      `<div class="card">
         <div class="card-giro">
           <div class="card-face card-frente"><span class="card-canto">Frente</span>${esc(c.frente)}</div>
           <div class="card-face card-verso"><span class="card-canto">Verso</span>${esc(c.verso)}</div>
         </div>
       </div>`).join('')}</div>`;
  $('corpo-cards').querySelectorAll('.card').forEach((c) =>
    c.addEventListener('click', () => c.classList.toggle('virado')));
}

/* ------------------------------------------------------------------
   Utilidades de tela
------------------------------------------------------------------- */

function duracaoLegivel(seg) {
  const m = Math.floor(seg / 60), s = Math.round(seg % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  return m ? `${m}min${String(s).padStart(2, '0')}` : `${s}s`;
}

function trocarAba(alvo) {
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.alvo === alvo));
  ['ab-resumo', 'ab-prova', 'ab-questoes', 'ab-cards', 'ab-transcricao']
    .forEach((id) => $(id).classList.toggle('oculto', id !== alvo));
}

function escolherArquivo(arquivo) {
  if (!arquivo) return;
  estado.arquivo = arquivo;
  estado.envelope = null;

  $('nome-arquivo').textContent = arquivo.name;
  $('meta-arquivo').textContent = `${(arquivo.size / 1048576).toFixed(1)} MB`;
  $('area-solta').classList.add('oculto');
  $('cartao-arquivo').classList.remove('oculto');
  $('btn-transcrever').disabled = false;
  $('aviso-entrada').textContent = $('chave-groq').value.trim()
    ? '' : 'Falta a chave da Groq — clique em Transcrever e eu abro onde colar.';

  // desenha a forma de onda de verdade, a partir do áudio dele
  decodificarMono16k(arquivo).then(({ amostras, taxa }) => {
    estado.duracao = amostras.length / taxa;
    estado.envelope = envelopar(amostras);
    desenharOnda($('onda'), estado.envelope, 1);
    $('meta-arquivo').textContent =
      `${duracaoLegivel(estado.duracao)} · ${(arquivo.size / 1048576).toFixed(1)} MB`;
  }).catch(() => {
    $('meta-arquivo').textContent =
      `${(arquivo.size / 1048576).toFixed(1)} MB · não consegui ler o áudio deste arquivo`;
    $('btn-transcrever').disabled = true;
  });
}

function limparArquivo() {
  estado.arquivo = null;
  estado.envelope = null;
  $('arquivo').value = '';
  $('cartao-arquivo').classList.add('oculto');
  $('area-solta').classList.remove('oculto');
  $('btn-transcrever').disabled = true;
}

function baixar() {
  const d = estado.estudo;
  let md = `# ${(d && d.titulo) || estado.arquivo.name}\n\n_${estado.materia} · ${duracaoLegivel(estado.duracao)}_\n\n`;
  if (d) {
    if (d.assunto_em_uma_linha) md += `${d.assunto_em_uma_linha}\n\n`;
    md += '## Resumo\n\n' + (d.resumo || []).map((b) => `### ${b.tema}\n\n${b.texto}\n`).join('\n');
    md += '\n## Cai na prova\n\n' + (d.pontos_prova || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
    md += '\n\n## Termos\n\n' + (d.termos || []).map((t) => `- **${t.termo}** — ${t.definicao}`).join('\n');
    md += '\n\n## Questões\n\n' + (d.questoes || []).map((q, i) =>
      `${i + 1}. ${q.pergunta}\n` + (q.alternativas || []).map((a, j) => `   ${'abcd'[j]}) ${a}`).join('\n') +
      `\n   Resposta: ${'abcd'[q.correta]} — ${q.porque}\n`).join('\n');
    md += '\n## Flashcards\n\n' + (d.flashcards || []).map((c) => `- ${c.frente} | ${c.verso}`).join('\n');
    if ((d.em_aberto || []).length) md += '\n\n## Ficou em aberto\n\n' + d.em_aberto.map((x) => `- ${x}`).join('\n');
  }
  md += '\n\n---\n\n## Transcrição\n\n' + estado.transcricao + '\n';

  const nome = `${estado.materia.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.md`;
  const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function abrirGaveta() {
  $('gaveta').classList.remove('oculto');
  $('fundo-gaveta').classList.remove('oculto');
}
function fecharGaveta() {
  $('gaveta').classList.add('oculto');
  $('fundo-gaveta').classList.add('oculto');
}

/* ------------------------------------------------------------------
   Início
------------------------------------------------------------------- */

function iniciar() {
  // chips de matéria
  const chips = $('chips-materia');
  estado.materia = MATERIAS[guardado.ler('ta_materia')] !== undefined
    ? guardado.ler('ta_materia') : 'Anatomia';

  Object.keys(MATERIAS).forEach((nome) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (nome === estado.materia ? ' ativo' : '');
    b.textContent = nome;
    b.addEventListener('click', () => {
      estado.materia = nome;
      guardado.gravar('ta_materia', nome);
      chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('ativo', c === b));
      $('glossario').value = MATERIAS[nome];
    });
    chips.appendChild(b);
  });
  $('glossario').value = MATERIAS[estado.materia];

  // chaves
  $('chave-groq').value = guardado.ler('ta_groq');
  $('chave-anthropic').value = guardado.ler('ta_anthropic');
  const modelo = guardado.ler('ta_modelo');
  if (modelo) $('modelo-analise').value = modelo;

  $('btn-config').addEventListener('click', abrirGaveta);
  $('btn-fechar-gaveta').addEventListener('click', fecharGaveta);
  $('fundo-gaveta').addEventListener('click', fecharGaveta);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharGaveta(); });

  $('btn-salvar-chaves').addEventListener('click', () => {
    const ok = guardado.gravar('ta_groq', $('chave-groq').value.trim())
      && guardado.gravar('ta_anthropic', $('chave-anthropic').value.trim())
      && guardado.gravar('ta_modelo', $('modelo-analise').value);
    $('status-chaves').textContent = ok
      ? 'Salvo neste navegador.'
      : 'O navegador bloqueou o armazenamento. As chaves valem só nesta aba.';
    if ($('chave-groq').value.trim()) $('aviso-entrada').textContent = '';
    setTimeout(fecharGaveta, 600);
  });

  $('btn-limpar-chaves').addEventListener('click', () => {
    ['ta_groq', 'ta_anthropic'].forEach(guardado.apagar);
    $('chave-groq').value = '';
    $('chave-anthropic').value = '';
    $('status-chaves').textContent = 'Chaves apagadas deste navegador.';
  });

  // arquivo
  $('btn-escolher').addEventListener('click', () => $('arquivo').click());
  $('arquivo').addEventListener('change', (e) => escolherArquivo(e.target.files[0]));
  $('btn-trocar').addEventListener('click', limparArquivo);

  const area = $('area-solta');
  ['dragenter', 'dragover'].forEach((ev) =>
    area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.add('ativa'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.remove('ativa'); }));
  area.addEventListener('drop', (e) => escolherArquivo(e.dataTransfer.files[0]));

  // fluxo
  $('btn-transcrever').addEventListener('click', transcrever);
  $('btn-resumir').addEventListener('click', resumir);
  $('btn-cancelar').addEventListener('click', () => { estado.cancelar = true; });
  $('btn-nova').addEventListener('click', () => {
    estado.transcricao = ''; estado.estudo = null;
    limparArquivo();
    mostrarTela('tela-entrada');
  });
  $('btn-baixar').addEventListener('click', baixar);

  document.querySelectorAll('.aba').forEach((b) =>
    b.addEventListener('click', () => trocarAba(b.dataset.alvo)));

  $('btn-copiar').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(estado.transcricao);
      $('btn-copiar').textContent = 'Copiado';
      setTimeout(() => { $('btn-copiar').textContent = 'Copiar tudo'; }, 1500);
    } catch {
      $('btn-copiar').textContent = 'O navegador bloqueou a cópia';
    }
  });

  // a forma de onda precisa ser redesenhada quando a largura muda
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!estado.envelope) return;
      desenharOnda($('onda'), estado.envelope, 1);
      desenharOnda($('onda-progresso'), estado.envelope,
        estado.blocos ? estado.blocosProntos / estado.blocos : 0);
    }, 150);
  });
}

document.addEventListener('DOMContentLoaded', iniciar);
