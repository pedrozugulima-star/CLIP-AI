const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));


// ======================================================
// PASTA DE UPLOAD
// ======================================================

const pastaUploads = path.join(__dirname, "uploads");

if (!fs.existsSync(pastaUploads)) {
    fs.mkdirSync(pastaUploads, { recursive: true });
}


// ======================================================
// CONFIGURAÇÃO DO UPLOAD
// ======================================================

const upload = multer({
    dest: pastaUploads,

    limits: {
        fileSize: 1024 * 1024 * 1024
    }
});


// ======================================================
// TESTE DO SERVIDOR
// ======================================================

app.get("/", (req, res) => {
    res.send("Clip AI Backend local funcionando!");
});


// ======================================================
// RECONHECER LINK DO YOUTUBE
// ======================================================

function obterIdYouTube(link) {

    try {

        const url = new URL(link);

        const host = url.hostname
            .replace("www.", "")
            .replace("m.", "");


        if (host === "youtu.be") {

            return (
                url.pathname
                    .split("/")
                    .filter(Boolean)[0]
                || null
            );

        }


        if (
            host === "youtube.com" ||
            host === "music.youtube.com"
        ) {

            if (url.pathname === "/watch") {
                return url.searchParams.get("v");
            }


            if (url.pathname.startsWith("/shorts/")) {
                return url.pathname.split("/")[2] || null;
            }


            if (url.pathname.startsWith("/embed/")) {
                return url.pathname.split("/")[2] || null;
            }


            if (url.pathname.startsWith("/live/")) {
                return url.pathname.split("/")[2] || null;
            }

        }


        return null;

    } catch {

        return null;

    }

}


// ======================================================
// RECEBER LINK
// ======================================================

app.post("/video-link", async (req, res) => {

    try {

        const { url } = req.body;


        if (!url) {

            return res.status(400).json({
                erro: "Nenhum link foi informado."
            });

        }


        // --------------------------------------------------
        // YOUTUBE
        // --------------------------------------------------

        const youtubeId = obterIdYouTube(url);


        if (youtubeId) {

            console.log("YouTube detectado:", youtubeId);


            return res.status(422).json({

                tipo: "youtube",

                videoId: youtubeId,

                url,

                erro: "YouTube detectado."

            });

        }


        // --------------------------------------------------
        // LINK DIRETO
        // --------------------------------------------------

        const resposta = await fetch(url);


        if (!resposta.ok) {

            return res.status(400).json({
                erro: "Não foi possível acessar esse vídeo."
            });

        }


        const contentType =
            resposta.headers.get("content-type");


        if (
            !contentType ||
            !contentType.includes("video")
        ) {

            return res.status(400).json({
                erro: "Esse endereço não parece ser um vídeo direto."
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
            "Content-Disposition",
            'attachment; filename="video-link.mp4"'
        );


        res.send(buffer);

    } catch (erro) {

        console.error("Erro no link:", erro);


        res.status(500).json({
            erro: "Erro ao processar o link."
        });

    }

});


// ======================================================
// EXECUTAR WHISPER LOCAL
// ======================================================

function executarWhisper(caminhoVideo) {

    return new Promise((resolve, reject) => {

        const scriptPython =
            path.join(
                __dirname,
                "whisper_local.py"
            );


        console.log("");
        console.log("Executando Whisper local...");


        const processo = spawn(
            "python",
            [
                scriptPython,
                caminhoVideo
            ],
            {
                cwd: __dirname
            }
        );


        let saida = "";
        let erros = "";


        processo.stdout.on("data", dados => {

            saida +=
                dados.toString("utf8");

        });


        processo.stderr.on("data", dados => {

            const texto =
                dados.toString("utf8");


            erros += texto;


            console.log(
                texto.trim()
            );

        });


        processo.on("error", erro => {

            reject(
                new Error(
                    "Não consegui iniciar o Python: " +
                    erro.message
                )
            );

        });


        processo.on("close", codigo => {

            if (codigo !== 0) {

                reject(
                    new Error(
                        erros ||
                        "Whisper terminou com erro."
                    )
                );

                return;

            }


            try {

                const resultado =
                    JSON.parse(
                        saida.trim()
                    );


                if (!resultado.sucesso) {

                    reject(
                        new Error(
                            resultado.erro ||
                            "Erro na transcrição."
                        )
                    );

                    return;

                }


                resolve(resultado);

            } catch (erro) {

                console.error(
                    "Resposta do Whisper:",
                    saida
                );


                reject(
                    new Error(
                        "Não consegui interpretar a resposta do Whisper."
                    )
                );

            }

        });

    });

}


// ======================================================
// PALAVRAS QUE AUMENTAM O SCORE
// ======================================================

const palavrasFortes = [

    "importante",
    "segredo",
    "problema",
    "erro",
    "verdade",
    "nunca",
    "sempre",
    "mudou",
    "mudança",
    "descobri",
    "aprendi",
    "resultado",
    "melhor",
    "pior",
    "diferença",
    "atenção",
    "cuidado",
    "imagine",
    "incrível",
    "surpreendente",
    "porque",
    "como",
    "quando",
    "você",
    "precisa",
    "deve",
    "conseguir",
    "conseguiu",
    "história",
    "experiência",
    "acredito",
    "entenda",
    "lembre",
    "fundamental",
    "principal"

];


// ======================================================
// CALCULAR SCORE
// ======================================================

function calcularScore(texto, duracao) {

    const minusculo =
        texto.toLowerCase();


    let score = 40;


    const palavras =
        minusculo
            .split(/\s+/)
            .filter(Boolean);


    score += Math.min(
        palavras.length / 5,
        18
    );


    palavrasFortes.forEach(palavra => {

        if (
            minusculo.includes(palavra)
        ) {

            score += 2;

        }

    });


    if (texto.includes("?")) {
        score += 5;
    }


    if (texto.includes("!")) {
        score += 4;
    }


    if (
        duracao >= 20 &&
        duracao <= 45
    ) {

        score += 8;

    }


    return Math.max(
        1,
        Math.min(
            99,
            Math.round(score)
        )
    );

}


// ======================================================
// CRIAR TÍTULO
// ======================================================

function criarTitulo(texto) {

    const palavras =
        texto
            .replace(/\s+/g, " ")
            .trim()
            .split(" ");


    let titulo =
        palavras
            .slice(0, 8)
            .join(" ");


    if (palavras.length > 8) {
        titulo += "...";
    }


    return (
        titulo ||
        "Momento em destaque"
    );

}


// ======================================================
// QUANTIDADE DE CLIPES POR DURAÇÃO
// ======================================================

function obterConfiguracao(duracao) {

    // Até 1min30
    if (duracao <= 90) {

        return {
            quantidade: 3,
            minimo: 12,
            maximo: 30
        };

    }


    // Até 5 minutos
    if (duracao <= 300) {

        return {
            quantidade: 5,
            minimo: 15,
            maximo: 40
        };

    }


    // Até 15 minutos
    if (duracao <= 900) {

        return {
            quantidade: 8,
            minimo: 18,
            maximo: 50
        };

    }


    // Até 30 minutos
    if (duracao <= 1800) {

        return {
            quantidade: 12,
            minimo: 20,
            maximo: 55
        };

    }


    // Até 1 hora
    if (duracao <= 3600) {

        return {
            quantidade: 15,
            minimo: 20,
            maximo: 60
        };

    }


    // Acima de 1 hora
    return {
        quantidade: 20,
        minimo: 20,
        maximo: 60
    };

}


// ======================================================
// CRIAR CANDIDATOS
// ======================================================

function criarCandidatos(
    segmentos,
    minimo,
    maximo
) {

    const candidatos = [];


    for (
        let inicioIndex = 0;
        inicioIndex < segmentos.length;
        inicioIndex++
    ) {

        const inicio =
            Number(
                segmentos[inicioIndex].inicio
            );


        let texto = "";


        for (
            let fimIndex = inicioIndex;
            fimIndex < segmentos.length;
            fimIndex++
        ) {

            const segmento =
                segmentos[fimIndex];


            texto +=
                (texto ? " " : "") +
                segmento.texto;


            const fim =
                Number(segmento.fim);


            const duracao =
                fim - inicio;


            if (
                duracao >= minimo &&
                duracao <= maximo
            ) {

                candidatos.push({

                    inicio:
                        Number(
                            inicio.toFixed(2)
                        ),

                    fim:
                        Number(
                            fim.toFixed(2)
                        ),

                    duracao:
                        Number(
                            duracao.toFixed(2)
                        ),

                    texto,

                    score:
                        calcularScore(
                            texto,
                            duracao
                        ),

                    titulo:
                        criarTitulo(texto),

                    motivo:
                        "Momento selecionado automaticamente pelo Clip AI."

                });

            }


            if (duracao > maximo) {
                break;
            }

        }

    }


    return candidatos;

}


// ======================================================
// ESCOLHER OS MELHORES CORTES
// ======================================================

function escolherMelhoresCortes(
    segmentos,
    duracaoVideo
) {

    if (
        !segmentos ||
        segmentos.length === 0
    ) {

        return [];

    }


    const configuracao =
        obterConfiguracao(
            duracaoVideo
        );


    console.log("");
    console.log(
        "Duração do vídeo:",
        duracaoVideo,
        "segundos"
    );


    console.log(
        "Meta:",
        configuracao.quantidade,
        "clipes"
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


    // Melhores scores primeiro
    candidatos.sort(
        (a, b) =>
            b.score - a.score
    );


    const escolhidos = [];


    // ==================================================
    // PRIMEIRA PASSADA
    // Evita cortes muito sobrepostos
    // ==================================================

    for (const candidato of candidatos) {

        if (
            escolhidos.length >=
            configuracao.quantidade
        ) {
            break;
        }


        const sobrepoe =
            escolhidos.some(outro => {

                const inicioSobreposicao =
                    Math.max(
                        candidato.inicio,
                        outro.inicio
                    );


                const fimSobreposicao =
                    Math.min(
                        candidato.fim,
                        outro.fim
                    );


                const sobreposicao =
                    fimSobreposicao -
                    inicioSobreposicao;


                return (
                    sobreposicao > 3
                );

            });


        if (!sobrepoe) {

            escolhidos.push(
                candidato
            );

        }

    }


    // ==================================================
    // SEGUNDA PASSADA
    // Se faltarem clipes, libera um pouco mais
    // ==================================================

    if (
        escolhidos.length <
        configuracao.quantidade
    ) {

        for (const candidato of candidatos) {

            if (
                escolhidos.length >=
                configuracao.quantidade
            ) {
                break;
            }


            const jaExiste =
                escolhidos.some(outro => {

                    return (
                        Math.abs(
                            outro.inicio -
                            candidato.inicio
                        ) < 8
                    );

                });


            if (!jaExiste) {

                escolhidos.push(
                    candidato
                );

            }

        }

    }


    // ==================================================
    // FALLBACK PARA VÍDEOS MUITO CURTOS
    // ==================================================

    if (
        escolhidos.length === 0
    ) {

        const primeiro =
            segmentos[0];


        const ultimo =
            segmentos[
                segmentos.length - 1
            ];


        const inicio =
            Number(primeiro.inicio);


        const fim =
            Number(ultimo.fim);


        escolhidos.push({

            inicio,

            fim,

            duracao:
                fim - inicio,

            titulo:
                criarTitulo(
                    segmentos
                        .map(
                            item =>
                                item.texto
                        )
                        .join(" ")
                ),

            score: 70,

            motivo:
                "Melhor trecho disponível."

        });

    }


    // Organizar na ordem em que aparecem no vídeo

    escolhidos.sort(
        (a, b) =>
            a.inicio - b.inicio
    );


    return escolhidos.slice(
        0,
        configuracao.quantidade
    );

}


// ======================================================
// ANALISAR VÍDEO
// ======================================================

app.post(
    "/analisar-video",

    upload.single("video"),

    async (req, res) => {

        let caminho = null;


        try {

            console.log("");
            console.log(
                "================================"
            );

            console.log(
                "CLIP AI - ANÁLISE LOCAL"
            );

            console.log(
                "================================"
            );


            if (!req.file) {

                return res
                    .status(400)
                    .json({

                        erro:
                            "Nenhum vídeo foi enviado."

                    });

            }


            caminho =
                req.file.path;


            console.log(
                "Arquivo:",
                req.file.originalname
            );


            console.log(
                "Tamanho:",
                (
                    req.file.size /
                    1024 /
                    1024
                ).toFixed(2),
                "MB"
            );


            // --------------------------------------------------
            // WHISPER
            // --------------------------------------------------

            console.log("");
            console.log(
                "1/2 Transcrevendo com Whisper..."
            );


            const transcricao =
                await executarWhisper(
                    caminho
                );


            console.log("");
            console.log(
                "Transcrição concluída!"
            );


            console.log(
                "Idioma:",
                transcricao.idioma
            );


            console.log(
                "Segmentos:",
                transcricao.segmentos.length
            );


            // --------------------------------------------------
            // ESCOLHER CORTES
            // --------------------------------------------------

            console.log("");
            console.log(
                "2/2 Selecionando melhores momentos..."
            );


            const cortes =
                escolherMelhoresCortes(

                    transcricao.segmentos,

                    Number(
                        transcricao.duracao
                    )

                );


            console.log("");
            console.log(
                "Cortes encontrados:",
                cortes.length
            );


            cortes.forEach(
                (corte, index) => {

                    console.log(

                        `Clipe ${index + 1}:`,

                        `${corte.inicio}s → ${corte.fim}s`,

                        `Score ${corte.score}`

                    );

                }
            );


            res.json({

                sucesso: true,

                modo: "local",

                arquivo:
                    req.file.originalname,

                idioma:
                    transcricao.idioma,

                duracao:
                    transcricao.duracao,

                transcricao:
                    transcricao.texto,

                segmentos:
                    transcricao.segmentos,

                cortes

            });


        } catch (erro) {

            console.error("");
            console.error(
                "ERRO NA ANÁLISE:"
            );

            console.error(erro);


            res
                .status(500)
                .json({

                    sucesso: false,

                    erro:
                        erro.message ||
                        "Erro ao analisar vídeo."

                });


        } finally {

            if (
                caminho &&
                fs.existsSync(caminho)
            ) {

                try {

                    fs.unlinkSync(
                        caminho
                    );

                } catch {

                    console.log(
                        "Não consegui apagar o arquivo temporário."
                    );

                }

            }

        }

    }
);


// ======================================================
// ERRO DE ARQUIVO GRANDE
// ======================================================

app.use(
    (
        erro,
        req,
        res,
        next
    ) => {

        if (
            erro instanceof multer.MulterError &&
            erro.code === "LIMIT_FILE_SIZE"
        ) {

            return res
                .status(413)
                .json({

                    erro:
                        "O vídeo ultrapassou o limite de 1 GB."

                });

        }


        next(erro);

    }
);


// ======================================================
// INICIAR SERVIDOR
// ======================================================

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "CLIP AI BACKEND"
        );

        console.log(
            `Servidor rodando na porta ${PORT}`
        );

        console.log("");

        console.log(
            "✓ Links diretos"
        );

        console.log(
            "✓ YouTube reconhecido"
        );

        console.log(
            "✓ Whisper local"
        );

        console.log(
            "✓ Vídeo curto: até 3 clipes"
        );

        console.log(
            "✓ Vídeo de 1 hora: até 15 clipes"
        );

        console.log(
            "✓ Sem créditos de API"
        );

        console.log("");

    }
);