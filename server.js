import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";


/* =========================================
   CONFIGURAÇÕES
========================================= */

const app = express();

const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


/* =========================================
   PASTAS TEMPORÁRIAS
========================================= */

const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, {
        recursive: true
    });
}


/* =========================================
   MIDDLEWARES
========================================= */

app.use(cors());

app.use(
    express.json({
        limit: "20mb"
    })
);


/* =========================================
   MULTER
========================================= */

const storage = multer.diskStorage({

    destination: function (req, file, cb) {

        cb(null, uploadsDir);

    },

    filename: function (req, file, cb) {

        const extensao =
            path.extname(file.originalname) || ".mp4";

        const nome =
            `video-${Date.now()}-${Math.round(
                Math.random() * 1e9
            )}${extensao}`;

        cb(null, nome);

    }

});


const upload = multer({

    storage,

    limits: {
        fileSize: 1024 * 1024 * 1024
    }

});


/* =========================================
   YOUTUBE
========================================= */

function obterIdYouTube(url) {

    try {

        const parsed = new URL(url);


        if (
            parsed.hostname.includes("youtube.com")
        ) {

            return parsed.searchParams.get("v");

        }


        if (
            parsed.hostname.includes("youtu.be")
        ) {

            return parsed.pathname
                .replace("/", "")
                .split("?")[0];

        }


        return null;

    } catch {

        return null;

    }

}


/* =========================================
   ROTA DE LINK
========================================= */

app.post("/video-link", async (req, res) => {

    const { url } = req.body;


    if (!url) {

        return res.status(400).json({
            sucesso: false,
            erro: "Nenhum link informado."
        });

    }


    const videoId = obterIdYouTube(url);


    if (videoId) {

        return res.status(422).json({

            sucesso: false,

            tipo: "youtube",

            videoId,

            mensagem:
                `YouTube detectado com sucesso! ID do vídeo: ${videoId}. ` +
                "O Clip AI reconheceu o vídeo corretamente."

        });

    }


    try {

        const resposta = await fetch(url);


        if (!resposta.ok) {

            return res.status(400).json({
                sucesso: false,
                erro: "Não foi possível carregar esse vídeo."
            });

        }


        const contentType =
            resposta.headers.get("content-type") ||
            "video/mp4";


        if (
            !contentType.includes("video") &&
            !url.toLowerCase().includes(".mp4")
        ) {

            return res.status(400).json({
                sucesso: false,
                erro:
                    "Esse endereço não parece ser um link direto de vídeo."
            });

        }


        const arrayBuffer =
            await resposta.arrayBuffer();


        const buffer =
            Buffer.from(arrayBuffer);


        res.setHeader(
            "Content-Type",
            contentType
        );


        res.setHeader(
            "Content-Length",
            buffer.length
        );


        return res.send(buffer);

    } catch (erro) {

        console.error(
            "Erro ao carregar link:",
            erro
        );


        return res.status(500).json({
            sucesso: false,
            erro:
                "O servidor não conseguiu acessar esse link."
        });

    }

});


/* =========================================
   EXECUTAR WHISPER
========================================= */

function executarWhisper(caminhoVideo) {

    return new Promise((resolve, reject) => {


        const scriptPython =
            path.join(
                __dirname,
                "whisper_local.py"
            );


        /*
            WINDOWS = python
            RENDER / LINUX = python3
        */

        const pythonCommand =
            process.platform === "win32"
                ? "python"
                : "python3";


        console.log(
            "Executando Whisper com:",
            pythonCommand
        );


        const processo = spawn(

            pythonCommand,

            [
                scriptPython,
                caminhoVideo
            ],

            {

                env: {
                    ...process.env,
                    PYTHONIOENCODING: "utf-8"
                }

            }

        );


        let saida = "";
        let erroSaida = "";


        processo.stdout.on(
            "data",
            data => {

                saida +=
                    data.toString("utf8");

            }
        );


        processo.stderr.on(
            "data",
            data => {

                const texto =
                    data.toString("utf8");

                erroSaida += texto;

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


                if (codigo !== 0) {

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


                    /*
                        Tenta primeiro interpretar
                        toda a saída como JSON.
                    */

                    let resultado;


                    try {

                        resultado =
                            JSON.parse(texto);

                    } catch {


                        /*
                            Caso alguma mensagem apareça
                            antes do JSON, procura o último
                            bloco JSON válido.
                        */

                        const inicio =
                            texto.lastIndexOf(
                                "\n{"
                            );


                        if (inicio >= 0) {

                            resultado =
                                JSON.parse(
                                    texto.slice(
                                        inicio + 1
                                    )
                                );

                        } else {

                            resultado =
                                JSON.parse(texto);

                        }

                    }


                    resolve(resultado);

                } catch (erro) {

                    console.error(
                        "Saída recebida do Python:"
                    );

                    console.error(saida);


                    reject(
                        new Error(
                            "O Python respondeu, mas o resultado não pôde ser interpretado."
                        )
                    );

                }

            }

        );

    });

}


/* =========================================
   PALAVRAS IMPORTANTES
========================================= */

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


/* =========================================
   SCORE DOS CORTES
========================================= */

function calcularScore(texto, duracao) {

    const frase =
        String(texto || "")
            .toLowerCase();


    let score = 50;


    for (
        const palavra of palavrasFortes
    ) {

        if (
            frase.includes(palavra)
        ) {

            score += 4;

        }

    }


    if (
        frase.includes("?")
    ) {

        score += 5;

    }


    if (
        frase.includes("!")
    ) {

        score += 4;

    }


    const quantidadePalavras =
        frase
            .split(/\s+/)
            .filter(Boolean)
            .length;


    if (
        quantidadePalavras >= 25
    ) {

        score += 5;

    }


    if (
        quantidadePalavras >= 50
    ) {

        score += 4;

    }


    if (
        duracao >= 20 &&
        duracao <= 45
    ) {

        score += 7;

    }


    if (
        duracao > 45 &&
        duracao <= 60
    ) {

        score += 4;

    }


    return Math.min(
        Math.round(score),
        99
    );

}


/* =========================================
   TÍTULO AUTOMÁTICO
========================================= */

function criarTitulo(texto, indice) {

    const palavras =
        String(texto || "")
            .replace(/\s+/g, " ")
            .trim()
            .split(" ")
            .filter(Boolean);


    if (
        palavras.length === 0
    ) {

        return `Melhor momento ${indice + 1}`;

    }


    const titulo =
        palavras
            .slice(0, 8)
            .join(" ");


    return titulo.length > 60
        ? `${titulo.slice(0, 57)}...`
        : titulo;

}


/* =========================================
   QUANTIDADE DE CLIPES
========================================= */

function obterConfiguracao(duracao) {


    if (duracao <= 90) {

        return {
            quantidade: 3,
            minimo: 12,
            maximo: 30
        };

    }


    if (duracao <= 300) {

        return {
            quantidade: 5,
            minimo: 15,
            maximo: 40
        };

    }


    if (duracao <= 900) {

        return {
            quantidade: 8,
            minimo: 18,
            maximo: 50
        };

    }


    if (duracao <= 1800) {

        return {
            quantidade: 12,
            minimo: 20,
            maximo: 55
        };

    }


    if (duracao <= 3600) {

        return {
            quantidade: 15,
            minimo: 20,
            maximo: 60
        };

    }


    return {
        quantidade: 20,
        minimo: 20,
        maximo: 60
    };

}


/* =========================================
   CRIAR CANDIDATOS
========================================= */

function criarCandidatos(
    segmentos,
    minimo,
    maximo
) {

    const candidatos = [];


    for (
        let i = 0;
        i < segmentos.length;
        i++
    ) {


        let inicio =
            Number(
                segmentos[i].inicio ??
                segmentos[i].start ??
                0
            );


        let fim = inicio;

        let texto = "";


        for (
            let j = i;
            j < segmentos.length;
            j++
        ) {


            const segmento =
                segmentos[j];


            const segmentoFim =
                Number(
                    segmento.fim ??
                    segmento.end ??
                    fim
                );


            fim = segmentoFim;


            texto +=
                ` ${segmento.texto ??
                    segmento.text ??
                    ""}`;


            const duracao =
                fim - inicio;


            if (
                duracao >= minimo
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
                duracao >= maximo
            ) {

                break;

            }

        }

    }


    return candidatos;

}


/* =========================================
   SOBREPOSIÇÃO
========================================= */

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


/* =========================================
   ESCOLHER MELHORES CORTES
========================================= */

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
        (a, b) =>
            b.score - a.score
    );


    const escolhidos = [];


    /*
        PRIMEIRA PASSAGEM

        Evita cortes muito sobrepostos.
    */

    for (
        const candidato of candidatos
    ) {


        const temSobreposicao =
            escolhidos.some(
                escolhido =>
                    calcularSobreposicao(
                        candidato,
                        escolhido
                    ) > 3
            );


        if (!temSobreposicao) {

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


    /*
        SEGUNDA PASSAGEM

        Caso ainda faltem cortes,
        permite candidatos próximos,
        mas com inícios diferentes.
    */

    if (
        escolhidos.length <
        configuracao.quantidade
    ) {


        for (
            const candidato of candidatos
        ) {


            const jaExiste =
                escolhidos.some(
                    escolhido =>
                        Math.abs(
                            escolhido.inicio -
                            candidato.inicio
                        ) < 8
                );


            if (!jaExiste) {

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


    /*
        FALLBACK

        Caso o Whisper tenha poucos
        segmentos.
    */

    if (
        escolhidos.length === 0 &&
        segmentos.length > 0
    ) {


        const primeiro =
            segmentos[0];


        const ultimo =
            segmentos[
                segmentos.length - 1
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
                fim - inicio,

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

            score: 70

        });

    }


    /*
        ORGANIZA EM ORDEM DO VÍDEO
    */

    escolhidos.sort(
        (a, b) =>
            a.inicio - b.inicio
    );


    const resultado =
        escolhidos.map(
            (corte, indice) => ({

                inicio:
                    Number(
                        corte.inicio.toFixed(2)
                    ),

                fim:
                    Number(
                        corte.fim.toFixed(2)
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


    console.log(
        "Cortes escolhidos:",
        resultado.length
    );


    return resultado;

}


/* =========================================
   ANALISAR VÍDEO
========================================= */

app.post(
    "/analisar-video",
    upload.single("video"),
    async (req, res) => {


        if (!req.file) {

            return res.status(400).json({
                sucesso: false,
                erro:
                    "Nenhum vídeo foi enviado."
            });

        }


        const caminhoVideo =
            req.file.path;


        console.log("");
        console.log("===========================");
        console.log("NOVO VÍDEO RECEBIDO");
        console.log("===========================");

        console.log(
            "Arquivo:",
            req.file.originalname
        );


        try {


            console.log(
                "Iniciando transcrição..."
            );


            const transcricao =
                await executarWhisper(
                    caminhoVideo
                );


            if (
                !transcricao ||
                transcricao.sucesso === false
            ) {

                throw new Error(
                    transcricao?.erro ||
                    "Erro na transcrição."
                );

            }


            const segmentos =
                transcricao.segmentos || [];


            const duracao =
                Number(
                    transcricao.duracao ||
                    segmentos[
                        segmentos.length - 1
                    ]?.fim ||
                    segmentos[
                        segmentos.length - 1
                    ]?.end ||
                    0
                );


            console.log(
                "Transcrição concluída."
            );


            console.log(
                "Segmentos:",
                segmentos.length
            );


            const cortes =
                escolherMelhoresCortes(
                    segmentos,
                    duracao
                );


            return res.json({

                sucesso: true,

                idioma:
                    transcricao.idioma,

                duracao,

                texto:
                    transcricao.texto,

                segmentos,

                cortes

            });


        } catch (erro) {


            console.error(
                "ERRO NA ANÁLISE:"
            );

            console.error(erro);


            return res.status(500).json({

                sucesso: false,

                erro:
                    erro.message ||
                    "Erro ao analisar o vídeo."

            });


        } finally {


            /*
                APAGA O VÍDEO TEMPORÁRIO
                após terminar a análise.
            */

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

            } catch (erro) {

                console.error(
                    "Não foi possível apagar o arquivo temporário:",
                    erro.message
                );

            }

        }

    }
);


/* =========================================
   SERVIR O SITE ONLINE
========================================= */

const distDir =
    path.join(
        __dirname,
        "dist"
    );


if (
    fs.existsSync(distDir)
) {

    app.use(
        express.static(
            distDir
        )
    );


    /*
        Se a rota não for da API,
        entrega o index.html.
    */

    app.get("*", (req, res) => {

        res.sendFile(
            path.join(
                distDir,
                "index.html"
            )
        );

    });

}


/* =========================================
   INICIAR SERVIDOR
========================================= */

app.listen(PORT, () => {

    console.log("");
    console.log("==============================");
    console.log("       CLIP AI BACKEND");
    console.log("==============================");
    console.log("");

    console.log(
        `Servidor rodando na porta ${PORT}`
    );

    console.log("");

    console.log("✓ Links diretos");
    console.log("✓ YouTube reconhecido");
    console.log("✓ Whisper local");
    console.log("✓ Vídeo curto: até 3 clipes");
    console.log("✓ Vídeo de 1 hora: até 15 clipes");
    console.log("✓ Render preparado");
    console.log("✓ Sem créditos de API");

    console.log("");

});