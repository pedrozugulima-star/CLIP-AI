import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import ffmpegStatic from "ffmpeg-static";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");
const geradosDir = path.join(__dirname, "generated");
const distDir = path.join(__dirname, "dist");

const FFMPEG_BIN = ffmpegStatic || "ffmpeg";

for (const pasta of [uploadsDir, geradosDir]) {
    if (!fs.existsSync(pasta)) {
        fs.mkdirSync(pasta, {
            recursive: true
        });
    }
}

app.use(cors());

app.use(
    express.json({
        limit: "20mb"
    })
);

app.use(
    "/generated",
    express.static(geradosDir)
);


// ======================================================
// UPLOAD
// ======================================================

const storage = multer.diskStorage({

    destination(
        req,
        file,
        cb
    ) {

        cb(
            null,
            uploadsDir
        );

    },

    filename(
        req,
        file,
        cb
    ) {

        const extensao =
            path.extname(
                file.originalname
            ) || ".mp4";

        const nome =
            `video-${Date.now()}-${Math.round(
                Math.random() * 1e9
            )}${extensao}`;

        cb(
            null,
            nome
        );

    }

});


const upload = multer({

    storage,

    limits: {

        fileSize:
            1024 *
            1024 *
            1024

    }

});


// ======================================================
// PROGRESSO
// ======================================================

const trabalhos =
    new Map();


function criarTrabalho(
    jobId
) {

    if (!jobId) {
        return;
    }

    trabalhos.set(
        jobId,
        {

            porcentagem:
                0,

            etapa:
                "Aguardando processamento...",

            concluido:
                false,

            erro:
                null

        }
    );

}


function atualizarTrabalho(
    jobId,
    porcentagem,
    etapa
) {

    if (!jobId) {
        return;
    }

    const atual =
        trabalhos.get(
            jobId
        ) || {

            porcentagem:
                0,

            etapa:
                "Aguardando processamento...",

            concluido:
                false,

            erro:
                null

        };

    trabalhos.set(
        jobId,
        {

            ...atual,

            porcentagem,

            etapa,

            concluido:
                porcentagem >= 100,

            erro:
                null

        }
    );

}


function marcarErro(
    jobId,
    mensagem
) {

    if (!jobId) {
        return;
    }

    const atual =
        trabalhos.get(
            jobId
        ) || {

            porcentagem:
                0,

            etapa:
                "Erro no processamento.",

            concluido:
                false,

            erro:
                null

        };

    trabalhos.set(
        jobId,
        {

            ...atual,

            etapa:
                "Erro no processamento.",

            concluido:
                true,

            erro:
                mensagem

        }
    );

}


function limparTrabalhoDepois(
    jobId
) {

    if (!jobId) {
        return;
    }

    setTimeout(
        () => {

            trabalhos.delete(
                jobId
            );

        },

        10 *
        60 *
        1000
    );

}


app.get(
    "/progresso/:jobId",
    (
        req,
        res
    ) => {

        const trabalho =
            trabalhos.get(
                req.params.jobId
            );

        if (!trabalho) {

            return res.json({

                porcentagem:
                    0,

                etapa:
                    "Aguardando processamento...",

                concluido:
                    false,

                erro:
                    null

            });

        }

        return res.json(
            trabalho
        );

    }
);


// ======================================================
// YOUTUBE
// ======================================================

function obterIdYouTube(
    url
) {

    try {

        const parsed =
            new URL(
                url
            );

        if (
            parsed.hostname.includes(
                "youtube.com"
            )
        ) {

            return parsed
                .searchParams
                .get("v");

        }

        if (
            parsed.hostname.includes(
                "youtu.be"
            )
        ) {

            return parsed
                .pathname
                .replace(
                    "/",
                    ""
                )
                .split("?")[0];

        }

        return null;

    } catch {

        return null;

    }

}


// ======================================================
// LINK DE VÍDEO
// ======================================================

app.post(
    "/video-link",
    async (
        req,
        res
    ) => {

        const {
            url
        } = req.body;

        if (!url) {

            return res
                .status(400)
                .json({

                    sucesso:
                        false,

                    erro:
                        "Nenhum link informado."

                });

        }

        const videoId =
            obterIdYouTube(
                url
            );

        if (videoId) {

            return res
                .status(422)
                .json({

                    sucesso:
                        false,

                    tipo:
                        "youtube",

                    videoId,

                    mensagem:

                        `YouTube detectado com sucesso! ID do vídeo: ${videoId}. ` +

                        "O Clip AI reconheceu o vídeo corretamente."

                });

        }

        try {

            const resposta =
                await fetch(
                    url
                );

            if (!resposta.ok) {

                return res
                    .status(400)
                    .json({

                        sucesso:
                            false,

                        erro:
                            "Não foi possível carregar esse vídeo."

                    });

            }

            const contentType =
                resposta.headers.get(
                    "content-type"
                ) ||
                "video/mp4";

            if (
                !contentType.includes(
                    "video"
                ) &&
                !url
                    .toLowerCase()
                    .includes(
                        ".mp4"
                    )
            ) {

                return res
                    .status(400)
                    .json({

                        sucesso:
                            false,

                        erro:
                            "Esse endereço não parece ser um link direto de vídeo."

                    });

            }

            const arrayBuffer =
                await resposta
                    .arrayBuffer();

            const buffer =
                Buffer.from(
                    arrayBuffer
                );

            res.setHeader(
                "Content-Type",
                contentType
            );

            res.setHeader(
                "Content-Length",
                buffer.length
            );

            return res.send(
                buffer
            );

        } catch (
            erro
        ) {

            console.error(
                "Erro ao carregar link:",
                erro
            );

            return res
                .status(500)
                .json({

                    sucesso:
                        false,

                    erro:
                        "O servidor não conseguiu acessar esse link."

                });

        }

    }
);


// ======================================================
// WHISPER
// ======================================================

function executarWhisper(
    caminhoVideo
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            const scriptPython =
                path.join(
                    __dirname,
                    "whisper_local.py"
                );

            const pythonCommand =
                process.platform ===
                "win32"

                    ? "python"

                    : "python3";

            console.log(
                "Executando Whisper com:",
                pythonCommand
            );

            const processo =
                spawn(

                    pythonCommand,

                    [
                        scriptPython,
                        caminhoVideo
                    ],

                    {

                        env: {

                            ...process.env,

                            PYTHONIOENCODING:
                                "utf-8"

                        }

                    }

                );

            let saida =
                "";

            let erroSaida =
                "";

            processo.stdout.on(
                "data",
                data => {

                    saida +=
                        data.toString(
                            "utf8"
                        );

                }
            );

            processo.stderr.on(
                "data",
                data => {

                    const texto =
                        data.toString(
                            "utf8"
                        );

                    erroSaida +=
                        texto;

                    console.log(
                        "[Whisper]",
                        texto.trim()
                    );

                }
            );

            processo.on(
                "error",
                erro => {

                    reject(

                        new Error(

                            `Não foi possível iniciar o Python: ${erro.message}`

                        )

                    );

                }
            );

            processo.on(
                "close",
                codigo => {

                    if (
                        codigo !==
                        0
                    ) {

                        return reject(

                            new Error(

                                erroSaida ||

                                `Whisper terminou com código ${codigo}`

                            )

                        );

                    }

                    try {

                        const texto =
                            saida.trim();

                        let resultado;

                        try {

                            resultado =
                                JSON.parse(
                                    texto
                                );

                        } catch {

                            const inicio =
                                texto.lastIndexOf(
                                    "\n{"
                                );

                            if (
                                inicio >=
                                0
                            ) {

                                resultado =
                                    JSON.parse(

                                        texto.slice(
                                            inicio + 1
                                        )

                                    );

                            } else {

                                resultado =
                                    JSON.parse(
                                        texto
                                    );

                            }

                        }

                        resolve(
                            resultado
                        );

                    } catch (
                        erro
                    ) {

                        console.error(
                            "Saída recebida do Python:"
                        );

                        console.error(
                            saida
                        );

                        reject(

                            new Error(

                                "O Python respondeu, mas o resultado não pôde ser interpretado."

                            )

                        );

                    }

                }
            );

        }
    );

}


// ======================================================
// ESCOLHA DE CORTES
// ======================================================

const palavrasFortes = [

    "importante",
    "atenção",
    "segredo",
    "erro",
    "nunca",
    "sempre",
    "melhor",
    "pior",
    "verdade",
    "mentira",
    "problema",
    "solução",
    "resultado",
    "mudança",
    "mudar",
    "aprendi",
    "descobri",
    "motivo",
    "porque",
    "como",
    "agora",
    "cuidado",
    "precisa",
    "essencial",
    "fundamental",
    "incrível",
    "surpreendente",
    "ninguém",
    "todo mundo",
    "você",
    "vocês",
    "pergunta",
    "resposta"

];


function calcularScore(
    texto,
    duracao
) {

    const frase =
        String(
            texto ||
            ""
        ).toLowerCase();

    let score =
        50;

    for (
        const palavra
        of palavrasFortes
    ) {

        if (
            frase.includes(
                palavra
            )
        ) {

            score +=
                4;

        }

    }

    if (
        frase.includes("?")
    ) {

        score +=
            5;

    }

    if (
        frase.includes("!")
    ) {

        score +=
            4;

    }

    const quantidadePalavras =
        frase
            .split(/\s+/)
            .filter(Boolean)
            .length;

    if (
        quantidadePalavras >=
        25
    ) {

        score +=
            5;

    }

    if (
        quantidadePalavras >=
        50
    ) {

        score +=
            4;

    }

    if (
        duracao >= 20 &&
        duracao <= 45
    ) {

        score +=
            7;

    }

    if (
        duracao > 45 &&
        duracao <= 60
    ) {

        score +=
            4;

    }

    return Math.min(
        Math.round(
            score
        ),
        99
    );

}


function criarTitulo(
    texto,
    indice
) {

    const palavras =
        String(
            texto ||
            ""
        )
            .replace(
                /\s+/g,
                " "
            )
            .trim()
            .split(" ")
            .filter(Boolean);

    if (
        palavras.length ===
        0
    ) {

        return (
            `Melhor momento ${indice + 1}`
        );

    }

    const titulo =
        palavras
            .slice(
                0,
                8
            )
            .join(" ");

    return (
        titulo.length >
        60

            ? `${titulo.slice(0, 57)}...`

            : titulo
    );

}


function obterConfiguracao(
    duracao
) {

    if (
        duracao <=
        90
    ) {

        return {

            quantidade:
                3,

            minimo:
                12,

            maximo:
                30

        };

    }

    if (
        duracao <=
        300
    ) {

        return {

            quantidade:
                5,

            minimo:
                15,

            maximo:
                40

        };

    }

    if (
        duracao <=
        900
    ) {

        return {

            quantidade:
                8,

            minimo:
                18,

            maximo:
                50

        };

    }

    if (
        duracao <=
        1800
    ) {

        return {

            quantidade:
                12,

            minimo:
                20,

            maximo:
                55

        };

    }

    if (
        duracao <=
        3600
    ) {

        return {

            quantidade:
                15,

            minimo:
                20,

            maximo:
                60

        };

    }

    return {

        quantidade:
            20,

        minimo:
            20,

        maximo:
            60

    };

}


function criarCandidatos(
    segmentos,
    minimo,
    maximo
) {

    const candidatos =
        [];

    for (
        let i = 0;
        i < segmentos.length;
        i++
    ) {

        const inicio =
            Number(

                segmentos[i].inicio ??

                segmentos[i].start ??

                0

            );

        let fim =
            inicio;

        let texto =
            "";

        for (
            let j = i;
            j < segmentos.length;
            j++
        ) {

            const segmento =
                segmentos[j];

            fim =
                Number(

                    segmento.fim ??

                    segmento.end ??

                    fim

                );

            texto +=

                ` ${segmento.texto ??

                    segmento.text ??

                    ""}`;

            const duracao =
                fim -
                inicio;

            if (
                duracao >=
                minimo
            ) {

                candidatos.push({

                    inicio:
                        Math.max(
                            0,
                            inicio
                        ),

                    fim,

                    duracao,

                    texto:
                        texto.trim(),

                    score:
                        calcularScore(
                            texto,
                            duracao
                        )

                });

            }

            if (
                duracao >=
                maximo
            ) {

                break;

            }

        }

    }

    return candidatos;

}


function calcularSobreposicao(
    a,
    b
) {

    const inicio =
        Math.max(
            a.inicio,
            b.inicio
        );

    const fim =
        Math.min(
            a.fim,
            b.fim
        );

    return Math.max(
        0,
        fim - inicio
    );

}


function escolherMelhoresCortes(
    segmentos,
    duracaoVideo
) {

    const configuracao =
        obterConfiguracao(
            duracaoVideo
        );

    console.log(
        "Duração do vídeo:",
        duracaoVideo
    );

    console.log(
        "Meta de clipes:",
        configuracao.quantidade
    );

    const candidatos =
        criarCandidatos(

            segmentos,

            configuracao.minimo,

            configuracao.maximo

        );

    console.log(
        "Candidatos encontrados:",
        candidatos.length
    );

    candidatos.sort(
        (
            a,
            b
        ) =>
            b.score -
            a.score
    );

    const escolhidos =
        [];

    for (
        const candidato
        of candidatos
    ) {

        const temSobreposicao =
            escolhidos.some(

                escolhido =>

                    calcularSobreposicao(

                        candidato,

                        escolhido

                    ) > 3

            );

        if (
            !temSobreposicao
        ) {

            escolhidos.push(
                candidato
            );

        }

        if (
            escolhidos.length >=
            configuracao.quantidade
        ) {

            break;

        }

    }

    if (
        escolhidos.length <
        configuracao.quantidade
    ) {

        for (
            const candidato
            of candidatos
        ) {

            const jaExiste =
                escolhidos.some(

                    escolhido =>

                        Math.abs(

                            escolhido.inicio -

                            candidato.inicio

                        ) < 8

                );

            if (
                !jaExiste
            ) {

                escolhidos.push(
                    candidato
                );

            }

            if (
                escolhidos.length >=
                configuracao.quantidade
            ) {

                break;

            }

        }

    }

    if (
        escolhidos.length ===
        0 &&
        segmentos.length >
        0
    ) {

        const primeiro =
            segmentos[0];

        const ultimo =
            segmentos[
                segmentos.length -
                1
            ];

        const inicio =
            Number(

                primeiro.inicio ??

                primeiro.start ??

                0

            );

        const fimOriginal =
            Number(

                ultimo.fim ??

                ultimo.end ??

                duracaoVideo

            );

        const fim =
            Math.min(

                fimOriginal,

                inicio +
                configuracao.maximo

            );

        escolhidos.push({

            inicio,

            fim,

            duracao:
                fim -
                inicio,

            texto:

                segmentos
                    .map(
                        segmento =>

                            segmento.texto ??

                            segmento.text ??

                            ""
                    )
                    .join(" ")
                    .trim(),

            score:
                70

        });

    }

    escolhidos.sort(
        (
            a,
            b
        ) =>
            a.inicio -
            b.inicio
    );

    return escolhidos.map(

        (
            corte,
            indice
        ) => ({

            inicio:
                Number(
                    corte.inicio.toFixed(
                        2
                    )
                ),

            fim:
                Number(
                    corte.fim.toFixed(
                        2
                    )
                ),

            titulo:
                criarTitulo(
                    corte.texto,
                    indice
                ),

            score:
                corte.score,

            texto:
                corte.texto

        })

    );

}


// ======================================================
// ANALISAR VÍDEO
// ======================================================

app.post(
    "/analisar-video",
    upload.single(
        "video"
    ),
    async (
        req,
        res
    ) => {

        const jobId =
            req.body?.jobId ||
            null;

        criarTrabalho(
            jobId
        );

        if (
            !req.file
        ) {

            marcarErro(
                jobId,
                "Nenhum vídeo foi enviado."
            );

            limparTrabalhoDepois(
                jobId
            );

            return res
                .status(400)
                .json({

                    sucesso:
                        false,

                    erro:
                        "Nenhum vídeo foi enviado."

                });

        }

        const caminhoVideo =
            req.file.path;

        let timerProgresso =
            null;

        console.log(
            "\n==========================="
        );

        console.log(
            "NOVO VÍDEO RECEBIDO"
        );

        console.log(
            "==========================="
        );

        console.log(
            "Arquivo:",
            req.file.originalname
        );

        atualizarTrabalho(

            jobId,

            10,

            "Vídeo recebido. Preparando análise..."

        );

        try {

            atualizarTrabalho(

                jobId,

                20,

                "Transcrevendo e entendendo o vídeo..."

            );

            let progressoEstimado =
                20;

            timerProgresso =
                setInterval(

                    () => {

                        progressoEstimado =
                            Math.min(

                                progressoEstimado +
                                3,

                                70

                            );

                        atualizarTrabalho(

                            jobId,

                            progressoEstimado,

                            "Transcrevendo e entendendo o vídeo..."

                        );

                    },

                    5000

                );

            const transcricao =
                await executarWhisper(
                    caminhoVideo
                );

            if (
                timerProgresso
            ) {

                clearInterval(
                    timerProgresso
                );

                timerProgresso =
                    null;

            }

            if (
                !transcricao ||
                transcricao.sucesso ===
                false
            ) {

                throw new Error(

                    transcricao?.erro ||

                    "Erro na transcrição."

                );

            }

            const segmentos =
                transcricao.segmentos ||
                [];

            const duracao =
                Number(

                    transcricao.duracao ||

                    segmentos[
                        segmentos.length -
                        1
                    ]?.fim ||

                    segmentos[
                        segmentos.length -
                        1
                    ]?.end ||

                    0

                );

            atualizarTrabalho(

                jobId,

                75,

                "Transcrição concluída."

            );

            atualizarTrabalho(

                jobId,

                82,

                "Analisando os melhores momentos..."

            );

            const cortes =
                escolherMelhoresCortes(

                    segmentos,

                    duracao

                );

            atualizarTrabalho(

                jobId,

                92,

                `${cortes.length} cortes encontrados. Preparando resultado...`

            );

            const resposta = {

                sucesso:
                    true,

                idioma:
                    transcricao.idioma,

                duracao,

                texto:
                    transcricao.texto,

                segmentos,

                cortes

            };

            atualizarTrabalho(

                jobId,

                100,

                "Análise concluída."

            );

            limparTrabalhoDepois(
                jobId
            );

            return res.json(
                resposta
            );

        } catch (
            erro
        ) {

            if (
                timerProgresso
            ) {

                clearInterval(
                    timerProgresso
                );

            }

            console.error(
                "ERRO NA ANÁLISE:",
                erro
            );

            marcarErro(

                jobId,

                erro.message ||

                "Erro ao analisar o vídeo."

            );

            limparTrabalhoDepois(
                jobId
            );

            return res
                .status(500)
                .json({

                    sucesso:
                        false,

                    erro:

                        erro.message ||

                        "Erro ao analisar o vídeo."

                });

        } finally {

            try {

                if (
                    fs.existsSync(
                        caminhoVideo
                    )
                ) {

                    fs.unlinkSync(
                        caminhoVideo
                    );

                }

            } catch (
                erro
            ) {

                console.error(

                    "Não foi possível apagar o arquivo temporário:",

                    erro.message

                );

            }

        }

    }
);


// ======================================================
// FFMPEG STATIC
// ======================================================

function executarFFmpeg(
    argumentos,
    cwd
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            console.log(
                "Executando FFmpeg com:",
                FFMPEG_BIN
            );

            const processo =
                spawn(

                    FFMPEG_BIN,

                    argumentos,

                    {

                        cwd,

                        windowsHide:
                            true

                    }

                );

            let erroSaida =
                "";

            processo.stderr.on(
                "data",
                data => {

                    const texto =
                        data.toString(
                            "utf8"
                        );

                    erroSaida +=
                        texto;

                    console.log(
                        "[FFmpeg]",
                        texto.trim()
                    );

                }
            );

            processo.on(
                "error",
                erro => {

                    reject(

                        new Error(

                            `Não foi possível iniciar o FFmpeg: ${erro.message}`

                        )

                    );

                }
            );

            processo.on(
                "close",
                codigo => {

                    if (
                        codigo ===
                        0
                    ) {

                        resolve();

                        return;

                    }

                    reject(

                        new Error(

                            `FFmpeg terminou com código ${codigo}.\n${erroSaida.slice(-3000)}`

                        )

                    );

                }
            );

        }
    );

}


// ======================================================
// TEXTO DA LEGENDA
// ======================================================

function limparTextoLegenda(
    texto
) {

    return String(
        texto ||
        ""
    )
        .replace(
            /\s+/g,
            " "
        )
        .trim();

}


// ======================================================
// TEMPO ASS
// ======================================================

function tempoASS(
    segundos
) {

    const total =
        Math.max(
            0,
            Number(
                segundos
            ) || 0
        );

    const horas =
        Math.floor(
            total /
            3600
        );

    const minutos =
        Math.floor(

            (
                total %
                3600
            ) /
            60

        );

    const segundosInteiros =
        Math.floor(
            total %
            60
        );

    const centesimos =
        Math.floor(

            (
                total %
                1
            ) *
            100

        );

    return (
        `${horas}:` +
        `${String(minutos).padStart(2, "0")}:` +
        `${String(segundosInteiros).padStart(2, "0")}.` +
        `${String(centesimos).padStart(2, "0")}`
    );

}


// ======================================================
// BLOCO DE LEGENDA
//
// ESTILO:
// PRIMEIRA LINHA = BRANCA
// SEGUNDA LINHA = AMARELA
//
// EXEMPLO:
//
// VOCÊ PRECISA
// ENTENDER ISSO
//
// ======================================================

function criarTextoLegendaEstilizada(
    palavras
) {

    const limpas =
        palavras
            .map(
                palavra =>
                    limparTextoLegenda(
                        palavra
                    )
            )
            .filter(
                Boolean
            );

    if (
        limpas.length ===
        0
    ) {

        return "";

    }

    const metade =
        Math.ceil(
            limpas.length /
            2
        );

    const primeiraLinha =
        limpas
            .slice(
                0,
                metade
            )
            .join(" ")
            .toUpperCase();

    const segundaLinha =
        limpas
            .slice(
                metade
            )
            .join(" ")
            .toUpperCase();

    if (
        !segundaLinha
    ) {

        return (
            `{\\c&HFFFFFF&}${primeiraLinha}`
        );

    }

    return (

        `{\\c&HFFFFFF&}${primeiraLinha}` +

        `\\N` +

        `{\\c&H00D4FF&}${segundaLinha}`

    );

}


// ======================================================
// CRIAR LEGENDA ASS
// ======================================================

function criarASSDoCorte(
    corte,
    segmentos
) {

    const inicioCorte =
        Number(

            corte.start ??

            corte.inicio ??

            0

        );

    const fimCorte =
        Number(

            corte.end ??

            corte.fim ??

            0

        );

    const palavrasDoCorte =
        [];

    for (
        const segmento
        of segmentos
    ) {

        const inicioSegmento =
            Number(

                segmento.inicio ??

                segmento.start ??

                0

            );

        const fimSegmento =
            Number(

                segmento.fim ??

                segmento.end ??

                inicioSegmento

            );

        if (
            fimSegmento <=
            inicioCorte ||
            inicioSegmento >=
            fimCorte
        ) {

            continue;

        }

        const palavras =
            Array.isArray(
                segmento.palavras
            )

                ? segmento.palavras

                : Array.isArray(
                    segmento.words
                )

                    ? segmento.words

                    : [];

        for (
            const item
            of palavras
        ) {

            const texto =
                limparTextoLegenda(

                    item.palavra ??

                    item.word ??

                    ""

                );

            const inicio =
                Number(

                    item.inicio ??

                    item.start

                );

            const fim =
                Number(

                    item.fim ??

                    item.end

                );

            if (
                !texto ||
                !Number.isFinite(
                    inicio
                ) ||
                !Number.isFinite(
                    fim
                )
            ) {

                continue;

            }

            if (
                fim <=
                inicioCorte ||
                inicio >=
                fimCorte
            ) {

                continue;

            }

            palavrasDoCorte.push({

                texto,

                inicio:
                    Math.max(
                        inicio,
                        inicioCorte
                    ),

                fim:
                    Math.min(
                        fim,
                        fimCorte
                    )

            });

        }

    }


    const eventos =
        [];


    // ==================================================
    // 4 PALAVRAS POR BLOCO
    //
    // Ex:
    // VOCÊ PRECISA
    // ENTENDER ISSO
    // ==================================================

    for (
        let i = 0;
        i < palavrasDoCorte.length;
        i += 4
    ) {

        const grupo =
            palavrasDoCorte.slice(
                i,
                i + 4
            );

        if (
            grupo.length ===
            0
        ) {

            continue;

        }

        const inicio =
            Math.max(

                0,

                grupo[0].inicio -
                inicioCorte

            );

        const fim =
            Math.max(

                inicio +
                0.12,

                grupo[
                    grupo.length -
                    1
                ].fim -
                inicioCorte

            );

        const texto =
            criarTextoLegendaEstilizada(

                grupo.map(
                    item =>
                        item.texto
                )

            );

        eventos.push(

            `Dialogue: 0,` +

            `${tempoASS(inicio)},` +

            `${tempoASS(fim)},` +

            `Legenda,,0,0,0,,` +

            `${texto}`

        );

    }


    // ==================================================
    // FALLBACK
    // Caso o Whisper não tenha timestamps por palavra
    // ==================================================

    if (
        eventos.length ===
        0
    ) {

        for (
            const segmento
            of segmentos
        ) {

            const inicioOriginal =
                Number(

                    segmento.inicio ??

                    segmento.start ??

                    0

                );

            const fimOriginal =
                Number(

                    segmento.fim ??

                    segmento.end ??

                    inicioOriginal

                );

            if (
                fimOriginal <=
                inicioCorte ||
                inicioOriginal >=
                fimCorte
            ) {

                continue;

            }

            const textoCompleto =
                limparTextoLegenda(

                    segmento.texto ??

                    segmento.text ??

                    ""

                );

            if (
                !textoCompleto
            ) {

                continue;

            }

            const palavras =
                textoCompleto
                    .split(/\s+/)
                    .filter(Boolean);

            const grupos =
                [];

            for (
                let i = 0;
                i < palavras.length;
                i += 4
            ) {

                grupos.push(
                    palavras.slice(
                        i,
                        i + 4
                    )
                );

            }

            const inicioVisivel =
                Math.max(

                    inicioOriginal,

                    inicioCorte

                );

            const fimVisivel =
                Math.min(

                    fimOriginal,

                    fimCorte

                );

            const duracao =
                Math.max(

                    0.2,

                    fimVisivel -
                    inicioVisivel

                );

            const duracaoGrupo =
                duracao /
                Math.max(
                    1,
                    grupos.length
                );

            for (
                let i = 0;
                i < grupos.length;
                i++
            ) {

                const inicio =
                    (
                        inicioVisivel -
                        inicioCorte
                    ) +
                    (
                        i *
                        duracaoGrupo
                    );

                const fim =
                    inicio +
                    duracaoGrupo;

                const texto =
                    criarTextoLegendaEstilizada(
                        grupos[i]
                    );

                eventos.push(

                    `Dialogue: 0,` +

                    `${tempoASS(inicio)},` +

                    `${tempoASS(fim)},` +

                    `Legenda,,0,0,0,,` +

                    `${texto}`

                );

            }

        }

    }


    // ==================================================
    // ESTILO VISUAL DA LEGENDA
    //
    // Arial
    // Negrito
    // Contorno preto forte
    // Sombra
    // Centralizada
    // Região inferior/central do vídeo
    // ==================================================

    return (

`[Script Info]
ScriptType: v4.00+
PlayResX: 540
PlayResY: 960
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Legenda,Arial,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,28,28,205,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${eventos.join("\n")}
`

    );

}


// ======================================================
// NORMALIZAR JSON
// ======================================================

function normalizarArrayJSON(
    valor,
    nome
) {

    if (
        Array.isArray(
            valor
        )
    ) {

        return valor;

    }

    try {

        const resultado =
            JSON.parse(
                valor ||
                "[]"
            );

        if (
            !Array.isArray(
                resultado
            )
        ) {

            throw new Error();

        }

        return resultado;

    } catch {

        throw new Error(
            `${nome} inválido.`
        );

    }

}


// ======================================================
// LIMPEZA
// ======================================================

function apagarPastaDepois(
    caminho,
    minutos = 60
) {

    setTimeout(
        () => {

            try {

                fs.rmSync(
                    caminho,
                    {

                        recursive:
                            true,

                        force:
                            true

                    }
                );

            } catch (
                erro
            ) {

                console.error(

                    "Não foi possível limpar os clipes temporários:",

                    erro.message

                );

            }

        },

        minutos *
        60 *
        1000
    );

}


// ======================================================
// GERAR CLIPES
//
// NOVO:
// ZOOM MAIS ABERTO
// LEGENDA BRANCA + AMARELA
// ======================================================

app.post(
    "/gerar-clipes",
    upload.single(
        "video"
    ),
    async (
        req,
        res
    ) => {

        const jobId =

            req.body?.jobId ||

            `render-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2)}`;

        criarTrabalho(
            jobId
        );

        if (
            !req.file
        ) {

            marcarErro(

                jobId,

                "Nenhum vídeo foi enviado para geração."

            );

            limparTrabalhoDepois(
                jobId
            );

            return res
                .status(400)
                .json({

                    sucesso:
                        false,

                    erro:
                        "Nenhum vídeo foi enviado para geração."

                });

        }


        let pastaTrabalho =
            null;


        try {

            const cortes =
                normalizarArrayJSON(

                    req.body?.cortes,

                    "Lista de cortes"

                );

            const segmentos =
                normalizarArrayJSON(

                    req.body?.segmentos,

                    "Segmentos de legenda"

                );

            if (
                cortes.length ===
                0
            ) {

                throw new Error(

                    "Nenhum corte foi enviado para geração."

                );

            }

            atualizarTrabalho(

                jobId,

                5,

                "Preparando o vídeo para gerar os clipes..."

            );


            const pastaNome =
                String(
                    jobId
                )
                    .replace(

                        /[^a-zA-Z0-9_-]/g,

                        "-"

                    )
                    .slice(
                        0,
                        120
                    );


            pastaTrabalho =
                path.join(

                    geradosDir,

                    pastaNome

                );


            fs.mkdirSync(

                pastaTrabalho,

                {

                    recursive:
                        true

                }

            );


            const extensao =

                path.extname(
                    req.file.originalname
                ) ||

                ".mp4";


            const nomeEntrada =
                `entrada${extensao}`;


            const caminhoEntrada =
                path.join(

                    pastaTrabalho,

                    nomeEntrada

                );


            fs.copyFileSync(

                req.file.path,

                caminhoEntrada

            );


            const resultado =
                [];


            for (
                let i = 0;
                i < cortes.length;
                i++
            ) {

                const corte =
                    cortes[i];


                const inicio =
                    Number(

                        corte.start ??

                        corte.inicio

                    );


                const fim =
                    Number(

                        corte.end ??

                        corte.fim

                    );


                if (
                    !Number.isFinite(
                        inicio
                    ) ||
                    !Number.isFinite(
                        fim
                    ) ||
                    fim <=
                    inicio
                ) {

                    throw new Error(

                        `O corte ${i + 1} possui tempo inválido.`

                    );

                }


                const duracao =
                    fim -
                    inicio;


                const nomeLegenda =
                    `legenda-${i + 1}.ass`;


                const nomeSaida =
                    `clip-${i + 1}.mp4`;


                const caminhoLegenda =
                    path.join(

                        pastaTrabalho,

                        nomeLegenda

                    );


                const ass =
                    criarASSDoCorte(

                        corte,

                        segmentos

                    );


                fs.writeFileSync(

                    caminhoLegenda,

                    ass,

                    "utf8"

                );


                atualizarTrabalho(

                    jobId,

                    10 +
                    Math.round(

                        (
                            i /
                            cortes.length
                        ) *
                        85

                    ),

                    `Gerando clipe ${i + 1} de ${cortes.length}...`

                );


                // ==================================================
                // ENQUADRAMENTO
                //
                // Antes:
                // crop direto 540 x 960
                //
                // Agora:
                // crop equivalente a aproximadamente 632 x 960
                //
                // Resultado:
                // continua com zoom
                // mas mostra um pouco mais das laterais
                //
                // O vídeo ocupa 540 x 820
                // e o fundo completa o 9:16.
                // ==================================================

                const filtroVideo =

                    "[0:v]split=2[bgsrc][mainsrc];" +

                    "[bgsrc]" +

                    "scale=540:960:force_original_aspect_ratio=increase," +

                    "crop=540:960," +

                    "gblur=sigma=24:steps=2," +

                    "setsar=1[bg];" +


                    "[mainsrc]" +

                    "scale=632:960:force_original_aspect_ratio=increase," +

                    "crop=632:960," +

                    "scale=540:820," +

                    "setsar=1[main];" +


                    "[bg][main]" +

                    "overlay=(W-w)/2:(H-h)/2[video];" +


                    "[video]" +

                    `ass=${nomeLegenda}` +

                    "[vout]";


                await executarFFmpeg(

                    [

                        "-y",

                        "-ss",

                        String(
                            inicio
                        ),

                        "-i",

                        nomeEntrada,

                        "-t",

                        String(
                            duracao
                        ),

                        "-filter_complex",

                        filtroVideo,

                        "-map",

                        "[vout]",

                        "-map",

                        "0:a?",

                        "-c:v",

                        "libx264",

                        "-preset",

                        "veryfast",

                        "-crf",

                        "25",

                        "-c:a",

                        "aac",

                        "-b:a",

                        "96k",

                        "-movflags",

                        "+faststart",

                        nomeSaida

                    ],

                    pastaTrabalho

                );


                resultado.push({

                    ...corte,

                    start:
                        inicio,

                    end:
                        fim,

                    arquivo:
                        nomeSaida,

                    url:

                        `/generated/${encodeURIComponent(
                            pastaNome
                        )}/${encodeURIComponent(
                            nomeSaida
                        )}`

                });


                atualizarTrabalho(

                    jobId,

                    10 +
                    Math.round(

                        (
                            (
                                i +
                                1
                            ) /
                            cortes.length
                        ) *
                        85

                    ),

                    `Clipe ${i + 1} de ${cortes.length} concluído.`

                );

            }


            atualizarTrabalho(

                jobId,

                100,

                "Clipes concluídos."

            );


            limparTrabalhoDepois(
                jobId
            );


            apagarPastaDepois(

                pastaTrabalho,

                60

            );


            return res.json({

                sucesso:
                    true,

                jobId,

                cortes:
                    resultado

            });


        } catch (
            erro
        ) {

            console.error(
                "ERRO AO GERAR CLIPES:"
            );

            console.error(
                erro
            );


            marcarErro(

                jobId,

                erro.message ||

                "Erro ao gerar os clipes."

            );


            limparTrabalhoDepois(
                jobId
            );


            if (
                pastaTrabalho
            ) {

                try {

                    fs.rmSync(

                        pastaTrabalho,

                        {

                            recursive:
                                true,

                            force:
                                true

                        }

                    );

                } catch {

                }

            }


            return res
                .status(500)
                .json({

                    sucesso:
                        false,

                    erro:

                        erro.message ||

                        "Erro ao gerar os clipes."

                });


        } finally {

            try {

                if (
                    req.file?.path &&
                    fs.existsSync(
                        req.file.path
                    )
                ) {

                    fs.unlinkSync(
                        req.file.path
                    );

                }

            } catch (
                erro
            ) {

                console.error(

                    "Não foi possível apagar o upload temporário:",

                    erro.message

                );

            }

        }

    }
);


// ======================================================
// SITE ONLINE
// ======================================================

if (
    fs.existsSync(
        distDir
    )
) {

    app.use(
        express.static(
            distDir
        )
    );

    app.get(
        "*",
        (
            req,
            res
        ) => {

            res.sendFile(

                path.join(

                    distDir,

                    "index.html"

                )

            );

        }
    );

}


// ======================================================
// SERVIDOR
// ======================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "\n=============================="
        );

        console.log(
            "       CLIP AI BACKEND"
        );

        console.log(
            "==============================\n"
        );

        console.log(
            `Servidor rodando na porta ${PORT}`
        );

        console.log(
            `FFmpeg: ${FFMPEG_BIN}`
        );

        console.log(
            "\n✓ YouTube reconhecido"
        );

        console.log(
            "✓ Whisper local otimizado"
        );

        console.log(
            "✓ Progresso da IA preparado"
        );

        console.log(
            "✓ FFmpeg Static preparado"
        );

        console.log(
            "✓ Zoom moderado preparado"
        );

        console.log(
            "✓ Enquadramento mais aberto"
        );

        console.log(
            "✓ Legenda estilo Shorts preparada"
        );

        console.log(
            "✓ Primeira linha branca"
        );

        console.log(
            "✓ Segunda linha amarela"
        );

        console.log(
            "✓ Contorno preto preparado"
        );

        console.log(
            "✓ Render preparado\n"
        );

    }
);