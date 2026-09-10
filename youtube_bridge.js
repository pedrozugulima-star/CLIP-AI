import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";

const app = express();

const trabalhosYoutube = new Map();

const TEMPO_MAXIMO_TRABALHO =
    2 * 60 * 60 * 1000;

const PORT =
    Number(
        process.env.YOUTUBE_BRIDGE_PORT || 3333
    );

const BRIDGE_SECRET =
    process.env.YOUTUBE_BRIDGE_SECRET ||
    "clip-ai-bridge-temporario";

const ffmpegCommand =
    ffmpegStatic || "ffmpeg";

const COOKIES_FILE =
    path.join(
        process.cwd(),
        "www.youtube.com_cookies.txt"
    );

app.use(
    express.json({
        limit: "1mb"
    })
);

// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================

function obterPythonCommand() {

    return process.platform === "win32"
        ? "python"
        : "python3";
}

function ehUrlYoutube(url) {

    try {

        const parsed =
            new URL(url);

        const host =
            parsed.hostname
                .toLowerCase()
                .replace(/^www\./, "");

        return (
            host === "youtube.com" ||
            host.endsWith(".youtube.com") ||
            host === "youtu.be" ||
            host.endsWith(".youtu.be")
        );

    } catch {

        return false;
    }
}

function criarPastaTemporaria() {

    const id =
        crypto.randomUUID();

    const pasta =
        path.join(
            os.tmpdir(),
            `clip-ai-youtube-${id}`
        );

    fs.mkdirSync(
        pasta,
        {
            recursive: true
        }
    );

    return pasta;
}

function removerPasta(pasta) {

    try {

        if (
            pasta &&
            fs.existsSync(pasta)
        ) {

            fs.rmSync(
                pasta,
                {
                    recursive: true,
                    force: true
                }
            );
        }

    } catch (erro) {

        console.log(
            "Não foi possível limpar a pasta temporária:",
            erro.message
        );
    }
}

// ======================================================
// EXECUTAR PROCESSO
// ======================================================

function executarProcesso(
    comando,
    argumentos,
    nome
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            const processo =
                spawn(
                    comando,
                    argumentos,
                    {
                        env: {
                            ...process.env,
                            PYTHONIOENCODING: "utf-8"
                        }
                    }
                );

            let erroSaida = "";

            processo.stdout.on(
                "data",
                data => {

                    const texto =
                        data
                            .toString("utf8")
                            .trim();

                    if (texto) {

                        console.log(
                            `[${nome}]`,
                            texto
                        );
                    }
                }
            );

            processo.stderr.on(
                "data",
                data => {

                    const texto =
                        data.toString("utf8");

                    erroSaida += texto;

                    if (texto.trim()) {

                        console.log(
                            `[${nome}]`,
                            texto.trim()
                        );
                    }
                }
            );

            processo.on(
                "error",
                erro => {

                    reject(
                        new Error(
                            `Não foi possível iniciar ${nome}: ${erro.message}`
                        )
                    );
                }
            );

            processo.on(
                "close",
                codigo => {

                    if (codigo !== 0) {

                        const detalhe =
                            erroSaida
                                .trim()
                                .split("\n")
                                .slice(-20)
                                .join("\n");

                        return reject(
                            new Error(
                                detalhe ||
                                `${nome} terminou com código ${codigo}`
                            )
                        );
                    }

                    resolve();
                }
            );
        }
    );
}

// ======================================================
// DOWNLOAD YOUTUBE
// ======================================================

async function baixarYoutube(
    url,
    pastaDestino
) {

    if (
        !fs.existsSync(
            COOKIES_FILE
        )
    ) {

        throw new Error(
            "Arquivo www.youtube.com_cookies.txt não encontrado na pasta do Clip AI."
        );
    }

    const pythonCommand =
        obterPythonCommand();

    const arquivoOriginal =
        path.join(
            pastaDestino,
            "youtube-original.mp4"
        );

    const argumentos = [

        "-m",
        "yt_dlp",

        "--cookies",
        COOKIES_FILE,

        "--no-playlist",

        "--restrict-filenames",

        "--js-runtimes",
        "node",

        "--remote-components",
        "ejs:github",

        "--ffmpeg-location",
        ffmpegCommand,

        "-f",

        "bv*[height<=720][ext=mp4]+ba[ext=m4a]/" +
        "b[height<=720][ext=mp4]/" +
        "bv*[height<=720]+ba/" +
        "b[height<=720]/" +
        "best[height<=720]/best",

        "--merge-output-format",
        "mp4",

        "-o",
        arquivoOriginal,

        url
    ];

    console.log("");
    console.log(
        "======================================"
    );
    console.log(
        "CLIP AI - YOUTUBE BRIDGE"
    );
    console.log(
        "======================================"
    );

    console.log(
        "Cookies do YouTube encontrados."
    );

    console.log(
        "Baixando vídeo em até 720p..."
    );

    console.log(
        url
    );

    await executarProcesso(
        pythonCommand,
        argumentos,
        "yt-dlp"
    );

    if (
        fs.existsSync(
            arquivoOriginal
        )
    ) {

        return arquivoOriginal;
    }

    const arquivos =
        fs
            .readdirSync(
                pastaDestino
            )
            .filter(
                nome =>
                    !nome.endsWith(".part") &&
                    !nome.endsWith(".ytdl") &&
                    nome
                        .toLowerCase()
                        .endsWith(".mp4")
            );

    if (
        arquivos.length === 0
    ) {

        throw new Error(
            "O YouTube foi baixado, mas nenhum MP4 foi criado."
        );
    }

    return path.join(
        pastaDestino,
        arquivos[0]
    );
}

// ======================================================
// COMPRESSÃO 720P
// ======================================================

async function comprimirVideo(
    arquivoEntrada,
    pastaDestino
) {

    const arquivoSaida =
        path.join(
            pastaDestino,
            "youtube-720p-otimizado.mp4"
        );

    console.log("");
    console.log(
        "Comprimindo vídeo para 720p otimizado..."
    );

    const argumentos = [

        "-y",

        "-i",
        arquivoEntrada,

        "-vf",
        "scale=-2:720:force_original_aspect_ratio=decrease",

        "-c:v",
        "libx264",

        "-preset",
        "veryfast",

        "-crf",
        "26",

        "-maxrate",
        "1800k",

        "-bufsize",
        "3600k",

        "-c:a",
        "aac",

        "-b:a",
        "96k",

        "-ac",
        "2",

        "-movflags",
        "+faststart",

        arquivoSaida
    ];

    await executarProcesso(
        ffmpegCommand,
        argumentos,
        "ffmpeg"
    );

    if (
        !fs.existsSync(
            arquivoSaida
        )
    ) {

        throw new Error(
            "A compressão terminou, mas o arquivo otimizado não foi criado."
        );
    }

    return arquivoSaida;
}

// ======================================================
// TRABALHOS ASSÍNCRONOS
// ======================================================

function resumoTrabalho(trabalho) {
    return {
        ok: true,
        jobId: trabalho.jobId,
        status: trabalho.status,
        etapa: trabalho.etapa,
        progresso: trabalho.progresso || 0,
        erro: trabalho.erro || null,
        criadoEm: trabalho.criadoEm,
        atualizadoEm: trabalho.atualizadoEm
    };
}

function atualizarTrabalho(
    trabalho,
    status,
    etapa,
    progresso = trabalho.progresso || 0
) {
    trabalho.status = status;
    trabalho.etapa = etapa;
    trabalho.progresso = progresso;
    trabalho.atualizadoEm = Date.now();
}

async function processarTrabalhoYoutube(
    trabalho,
    url
) {
    try {
        atualizarTrabalho(
            trabalho,
            "processando",
            "Baixando vídeo do YouTube...",
            15
        );

        const arquivoOriginal =
            await baixarYoutube(
                url,
                trabalho.pastaTemporaria
            );

        atualizarTrabalho(
            trabalho,
            "processando",
            "Preparando o vídeo para envio, sem recompressão...",
            85
        );

        // O yt-dlp já baixa em MP4 e limita a qualidade a 720p.
        // Usamos o arquivo diretamente para não reconverter vídeos longos.
        trabalho.arquivo = arquivoOriginal;

        atualizarTrabalho(
            trabalho,
            "pronto",
            "Vídeo pronto para envio, sem recompressão.",
            90
        );

        console.log("");
        console.log("======================================");
        console.log("VÍDEO PRONTO PARA O CLIP AI");
        console.log("======================================");
        console.log(
            `Trabalho: ${trabalho.jobId}`
        );

    } catch (erro) {
        trabalho.erro =
            erro.message ||
            "Erro ao processar o vídeo.";

        atualizarTrabalho(
            trabalho,
            "erro",
            "Falha no processamento.",
            trabalho.progresso || 0
        );

        console.error(
            "Erro no trabalho do YouTube:",
            erro
        );
    }
}

setInterval(
    () => {
        const agora = Date.now();

        for (
            const [jobId, trabalho]
            of trabalhosYoutube.entries()
        ) {
            if (
                agora - trabalho.atualizadoEm >
                TEMPO_MAXIMO_TRABALHO
            ) {
                removerPasta(
                    trabalho.pastaTemporaria
                );

                trabalhosYoutube.delete(jobId);
            }
        }
    },
    10 * 60 * 1000
).unref();

// ======================================================
// AUTENTICAÇÃO DA PONTE
// ======================================================

function autenticar(
    req,
    res,
    next
) {

    const segredo =
        req.headers[
            "x-bridge-secret"
        ];

    if (
        segredo !==
        BRIDGE_SECRET
    ) {

        return res
            .status(401)
            .json({
                ok: false,
                erro:
                    "Acesso não autorizado."
            });
    }

    next();
}

// ======================================================
// STATUS
// ======================================================

app.get(
    "/",
    (
        req,
        res
    ) => {

        res.json({
            ok: true,
            servico:
                "Clip AI YouTube Bridge",
            status:
                "online",
            qualidade:
                "720p otimizado",
            cookies:
                fs.existsSync(
                    COOKIES_FILE
                )
                    ? "encontrados"
                    : "não encontrados"
        });
    }
);

app.get(
    "/health",
    (
        req,
        res
    ) => {

        res.json({
            ok: true,
            status:
                "online",
            qualidade:
                "720p otimizado",
            cookies:
                fs.existsSync(
                    COOKIES_FILE
                )
                    ? "encontrados"
                    : "não encontrados"
        });
    }
);

// ======================================================
// DOWNLOAD
// ======================================================

app.post(
    "/youtube/start",
    autenticar,
    (
        req,
        res
    ) => {
        const url =
            String(
                req.body?.url || ""
            ).trim();

        if (!url) {
            return res.status(400).json({
                ok: false,
                erro: "Informe a URL do YouTube."
            });
        }

        if (!ehUrlYoutube(url)) {
            return res.status(400).json({
                ok: false,
                erro: "A URL informada não é do YouTube."
            });
        }

        const jobId = crypto.randomUUID();
        const agora = Date.now();

        const trabalho = {
            jobId,
            status: "aguardando",
            etapa: "Trabalho recebido.",
            progresso: 5,
            erro: null,
            arquivo: null,
            pastaTemporaria:
                criarPastaTemporaria(),
            criadoEm: agora,
            atualizadoEm: agora
        };

        trabalhosYoutube.set(
            jobId,
            trabalho
        );

        res.status(202).json(
            resumoTrabalho(trabalho)
        );

        processarTrabalhoYoutube(
            trabalho,
            url
        );
    }
);

app.get(
    "/youtube/status/:jobId",
    autenticar,
    (
        req,
        res
    ) => {
        const trabalho =
            trabalhosYoutube.get(
                req.params.jobId
            );

        if (!trabalho) {
            return res.status(404).json({
                ok: false,
                erro: "Trabalho não encontrado ou expirado."
            });
        }

        res.json(
            resumoTrabalho(trabalho)
        );
    }
);

app.get(
    "/youtube/download/:jobId",
    autenticar,
    (
        req,
        res
    ) => {
        const trabalho =
            trabalhosYoutube.get(
                req.params.jobId
            );

        if (!trabalho) {
            return res.status(404).json({
                ok: false,
                erro: "Trabalho não encontrado ou expirado."
            });
        }

        if (
            trabalho.status !== "pronto" ||
            !trabalho.arquivo ||
            !fs.existsSync(trabalho.arquivo)
        ) {
            return res.status(409).json({
                ok: false,
                status: trabalho.status,
                erro:
                    trabalho.erro ||
                    "O vídeo ainda não está pronto."
            });
        }

        res.download(
            trabalho.arquivo,
            "youtube.mp4",
            erro => {
                if (erro) {
                    console.log(
                        "Erro ao enviar vídeo:",
                        erro.message
                    );
                    return;
                }

                console.log(
                    "Vídeo enviado com sucesso."
                );

                removerPasta(
                    trabalho.pastaTemporaria
                );

                trabalhosYoutube.delete(
                    trabalho.jobId
                );
            }
        );
    }
);

app.post(
    "/youtube",
    autenticar,
    async (
        req,
        res
    ) => {

        let pastaTemporaria =
            null;

        try {

            const url =
                String(
                    req.body?.url || ""
                ).trim();

            if (!url) {

                return res
                    .status(400)
                    .json({
                        ok: false,
                        erro:
                            "Informe a URL do YouTube."
                    });
            }

            if (
                !ehUrlYoutube(url)
            ) {

                return res
                    .status(400)
                    .json({
                        ok: false,
                        erro:
                            "A URL informada não é do YouTube."
                    });
            }

            pastaTemporaria =
                criarPastaTemporaria();

            const arquivoOriginal =
                await baixarYoutube(
                    url,
                    pastaTemporaria
                );

            const tamanhoOriginalMB =
                fs.statSync(
                    arquivoOriginal
                ).size /
                1024 /
                1024;

            console.log("");
            console.log(
                `Arquivo original: ${tamanhoOriginalMB.toFixed(2)} MB`
            );

            const arquivoOtimizado =
                await comprimirVideo(
                    arquivoOriginal,
                    pastaTemporaria
                );

            const tamanhoOtimizadoMB =
                fs.statSync(
                    arquivoOtimizado
                ).size /
                1024 /
                1024;

            console.log("");
            console.log(
                "======================================"
            );

            console.log(
                "VÍDEO PRONTO PARA O CLIP AI"
            );

            console.log(
                "======================================"
            );

            console.log(
                `Arquivo otimizado: ${tamanhoOtimizadoMB.toFixed(2)} MB`
            );

            console.log(
                "Enviando vídeo pela ponte..."
            );

            res.download(
                arquivoOtimizado,
                "youtube.mp4",
                erro => {

                    removerPasta(
                        pastaTemporaria
                    );

                    if (erro) {

                        console.log(
                            "Erro ao enviar vídeo:",
                            erro.message
                        );

                    } else {

                        console.log(
                            "Vídeo enviado com sucesso."
                        );
                    }
                }
            );

        } catch (erro) {

            console.error(
                ""
            );

            console.error(
                "Erro na ponte do YouTube:"
            );

            console.error(
                erro
            );

            removerPasta(
                pastaTemporaria
            );

            if (
                !res.headersSent
            ) {

                res
                    .status(500)
                    .json({
                        ok: false,
                        erro:
                            erro.message ||
                            "Erro ao baixar vídeo do YouTube."
                    });
            }
        }
    }
);

// ======================================================
// INICIAR SERVIDOR
// ======================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "======================================"
        );

        console.log(
            "CLIP AI - YOUTUBE BRIDGE"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Ponte rodando na porta ${PORT}`
        );

        console.log(
            "Qualidade: 720p otimizado"
        );

        console.log(
            `Cookies: ${
                fs.existsSync(
                    COOKIES_FILE
                )
                    ? "OK"
                    : "NÃO ENCONTRADOS"
            }`
        );

        console.log(
            `Teste local: http://localhost:${PORT}`
        );

        console.log("");
    }
);
