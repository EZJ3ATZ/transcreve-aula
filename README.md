# Transcreve Aula

Site de uma página que recebe o áudio de uma aula, transcreve e devolve resumo, questões
e flashcards. Sem servidor, sem build, sem dependência: é HTML, CSS e um arquivo JS.

**No ar:** https://ezj3atz.github.io/transcreve-aula/

## Como usar

1. Grave a aula **com o gravador do próprio celular** — o app nativo, o que já vem no
   aparelho. Ele grava com a tela desligada e o telefone no bolso.
2. Abra o site, cole sua chave da [Groq](https://console.groq.com/keys) (grátis).
3. Solte o arquivo, escolha a matéria e clique em Transcrever.
4. Para o resumo, cole também uma chave da [Anthropic](https://console.anthropic.com/).
   Sem ela o site só transcreve — e você leva o texto para onde quiser.

### Por que não gravar pelo site

O Safari no iPhone suspende a captação de áudio assim que a tela bloqueia ou o navegador
sai do foco, e PWA instalado na tela inicial usa a mesma engine, então não resolve. Um site
que grava só com a tela acesa e a aba na frente não serve para duas horas de aula. O
gravador nativo do celular não tem esse problema, e é gratuito. Por isso o site começa no
arquivo, não no microfone.

## Chaves de API

As chaves ficam no `localStorage` do seu próprio navegador. Não há servidor neste projeto —
elas vão direto do seu navegador para a Groq e para a Anthropic, e não passam por lugar
nenhum além disso. Nada de chave entra neste repositório, e cada pessoa que abre o site usa
a própria.

Custo por hora de aula, com os preços de setembro de 2026:

| etapa | serviço | custo |
|---|---|---|
| transcrição | Groq `whisper-large-v3-turbo` | US$ 0,04 — R$ 0,22 |
| resumo | Claude Haiku 4.5 | R$ 0,19 |
| resumo | Claude Sonnet 5 | R$ 0,37 |
| resumo | Claude Opus 5 | R$ 0,93 |

O plano gratuito da Groq dá 8 horas de áudio por dia, o que cobre um dia de aula inteiro
sem pagar nada.

## Referências de design

A interface segue o padrão que se repete nos apps do nicho — Coconote, Turbo AI e Knowt:
fundo claro quente em vez de branco puro, tipografia display pesada no topo, um acento
vibrante, canto muito arredondado e o resultado apresentado em abas.

Duas coisas foram feitas diferente de propósito:

- **A forma de onda é o áudio de verdade.** O arquivo é decodificado no navegador e
  desenhado a partir das amostras reais, e o progresso da transcrição pinta a onda da
  esquerda para a direita. Não é enfeite: mostra onde o áudio tem fala e onde tem silêncio.
- **O resultado é para usar, não para ler.** As questões são clicáveis com gabarito e
  justificativa na hora, e os flashcards viram no clique. O Claude devolve JSON validado
  por esquema, não markdown.

## A bancada

A escolha do motor não foi por reputação: seis motores rodaram no **mesmo trecho de 6
minutos de uma aula real de anatomia em português**, e a régua foi quantos dos 19 termos
anatômicos que a aula de fato cita cada um escreveu corretamente.

| motor | jargão certo | velocidade |
|---|---|---|
| **`large-v3-turbo`** | **18/19** | 0,74x tempo real |
| `large-v3-turbo` + vocabulário | 17/19 | 1,01x |
| `large-v3` | 16/19 | 1,25x |
| legenda automática do YouTube | 14/19 | — |
| `medium` | 13/19 | 0,80x |
| `small` | 9/19 | 0,31x |

Depois o mesmo áudio foi degradado para imitar celular na carteira — ruído de sala, fala
mais distante, banda estreita:

| condição | motor | jargão certo |
|---|---|---|
| sala, +8 dB de SNR | turbo **com** vocabulário | 14/19 |
| sala, +3 dB de SNR | turbo **com** vocabulário | 14/19 |
| sala, +8 dB de SNR | turbo sem vocabulário | 11/19 |
| sala, +8 dB de SNR | `medium` | 9/19 |

Dois resultados guiaram o código:

**O vocabulário da matéria só vale em áudio ruim.** Em áudio limpo ele atrapalha um pouco
(17 contra 18). Em áudio de sala ele leva de 11 para 14, e segura o mesmo número quando o
ruído piora. Como aula real é áudio ruim, ele entra por padrão — é o parâmetro `prompt` da
Groq, limitado a 224 tokens.

**O motor não é o gargalo — o microfone é.** O melhor motor cai de 18/19 para 11/19 só por
sair de áudio de microfone de lapela para áudio de sala. Nenhuma troca de API conserta isso.
Celular perto do professor vale mais que qualquer escolha de modelo.

Ressalva honesta: é um trecho, uma aula, um professor, com ruído sintetizado. A direção é
consistente, mas se for virar produto o teste que vale é gravar uma aula real e repetir a
medição.

## Como o áudio é preparado

O navegador decodifica o arquivo, reamostra para 16 kHz mono (o que o Whisper usa) e corta
em blocos de 5 minutos — cerca de 9,6 MB em WAV. O limite da Groq é 25 MB, mas bloco de
10 minutos (19 MB) travava o upload em rede lenta, então o corte é mais curto de propósito. Ele
não cai num ponto fixo: o código procura, numa janela de 5 segundos em volta, o trecho de
menor energia, para a emenda não partir uma palavra ao meio.

Aula muito longa em celular antigo pode faltar memória na decodificação. Se acontecer,
divida o arquivo antes.

## Limites conhecidos

- Não separa quem está falando (professor e aluno saem no mesmo texto corrido).
- Uma aula de 2 h consome a cota horária do plano gratuito da Groq; a diária aguenta 4 aulas.
- A qualidade cai junto com a qualidade da gravação, e não há aviso na tela quando isso
  acontece — quem lê o resumo não sabe se o áudio era bom.

## Arquivos

```
index.html   estrutura da página
style.css    estilo
app.js       áudio, chamadas de API e interface
```
