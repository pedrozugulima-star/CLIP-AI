import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, "uploads");
const geradosDir = path.join(__dirname, "generated");

const ffmpegCommand = ffmpegStatic || "ffmpeg";

const YOUTUBE_BRIDGE_URL =
    String(process.env.YOUTUBE_BRIDGE_URL || "")
        .trim()
        .replace(/\/$/, "");

const YOUTUBE_BRIDGE_SECRET =
    process.env.YOUTUBE_BRIDGE_SECRET ||
    "clip-ai-bridge-temporario";

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
    destination(req, file, cb) {
        cb(null, uploadsDir);
    },

    filename(req, file, cb) {
        const extensao =
            path.extname(file.originalname) ||
            ".mp4";

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
        // Até 2 GB no modo local para aceitar vídeos longos.
        fileSize: 2 * 1024 * 1024 * 1024,
        fieldSize: 20 * 1024 * 1024
    }
});

// ======================================================
// PROGRESSO
// ======================================================

const trabalhos = new Map();
const progressoLinks = new Map();
const videosTemporarios = new Map();

function apagarVideoTemporario(
    token
) {
    const registro =
        videosTemporarios.get(
            token
        );

    if (!registro) {
        return;
    }

    videosTemporarios.delete(
        token
    );

    try {
        if (
            fs.existsSync(
                registro.caminho
            )
        ) {
            fs.unlinkSync(
                registro.caminho
            );
        }
    } catch (erro) {
        console.error(
            "Não foi possível apagar o vídeo temporário:",
            erro.message
        );
    }
}

function registrarVideoTemporario(
    caminhoOriginal,
    nomeOriginal,
    contentType
) {
    const token =
        randomUUID();

    const extensao =
        path.extname(
            nomeOriginal ||
            caminhoOriginal
        ) || ".mp4";

    const caminho =
        path.join(
            uploadsDir,
            `fonte-${token}${extensao}`
        );

    try {
        fs.renameSync(
            caminhoOriginal,
            caminho
        );
    } catch {
        fs.copyFileSync(
            caminhoOriginal,
            caminho
        );

        fs.unlinkSync(
            caminhoOriginal
        );
    }

    const registro = {
        token,
        caminho,
        nome:
            nomeOriginal ||
            `video${extensao}`,
        contentType:
            contentType ||
            "video/mp4",
        tamanho:
            fs.statSync(
                caminho
            ).size
    };

    videosTemporarios.set(
        token,
        registro
    );

    // Segurança: remove fontes abandonadas depois de três horas.
    setTimeout(
        () =>
            apagarVideoTemporario(
                token
            ),
        3 * 60 * 60 * 1000
    );

    return registro;
}

function obterVideoTemporario(
    token
) {
    if (
        !token ||
        typeof token !== "string"
    ) {
        return null;
    }

    const registro =
        videosTemporarios.get(
            token
        );

    if (
        !registro ||
        !fs.existsSync(
            registro.caminho
        )
    ) {
        return null;
    }

    return registro;
}

function atualizarProgressoLink(
    downloadId,
    progresso,
    etapa,
    erro = null
) {
    if (!downloadId) {
        return;
    }

    progressoLinks.set(
        downloadId,
        {
            progresso:
                Math.max(
                    0,
                    Math.min(100, Number(progresso) || 0)
                ),
            etapa,
            erro,
            atualizadoEm: Date.now()
        }
    );
}

function criarTrabalho(jobId) {
    if (!jobId) {
        return;
    }

    trabalhos.set(jobId, {
        porcentagem: 0,
        etapa: "Aguardando processamento...",
        concluido: false,
        erro: null
    });
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
        trabalhos.get(jobId) || {
            porcentagem: 0,
            etapa: "Aguardando processamento...",
            concluido: false,
            erro: null
        };

    trabalhos.set(jobId, {
        ...atual,
        porcentagem,
        etapa,
        concluido: porcentagem >= 100,
        erro: null
    });
}

function marcarErro(
    jobId,
    mensagem
) {
    if (!jobId) {
        return;
    }

    const atual =
        trabalhos.get(jobId) || {};

    trabalhos.set(jobId, {
        ...atual,
        etapa: "Erro no processamento.",
        concluido: true,
        erro: mensagem
    });
}

function limparTrabalhoDepois(jobId) {
    if (!jobId) {
        return;
    }

    setTimeout(() => {
        trabalhos.delete(jobId);
    }, 10 * 60 * 1000);
}

app.get(
    "/progresso/:jobId",
    (req, res) => {
        const trabalho =
            trabalhos.get(
                req.params.jobId
            );

        if (!trabalho) {
            return res.json({
                porcentagem: 0,
                etapa: "Aguardando processamento...",
                concluido: false,
                erro: null
            });
        }

        return res.json(trabalho);
    }
);

// ======================================================
// YOUTUBE
// ======================================================

function ehLinkYouTube(url) {
    try {
        const parsed =
            new URL(url);

        const host =
            parsed.hostname
                .toLowerCase()
                .replace(
                    /^www\./,
                    ""
                );

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

function obterIdYouTube(url) {
    try {
        const parsed =
            new URL(url);

        const host =
            parsed.hostname
                .toLowerCase()
                .replace(
                    /^www\./,
                    ""
                );

        if (
            host === "youtu.be" ||
            host.endsWith(".youtu.be")
        ) {
            return (
                parsed.pathname
                    .split("/")
                    .filter(Boolean)[0] ||
                null
            );
        }

        if (
            host === "youtube.com" ||
            host.endsWith(".youtube.com")
        ) {
            const watchId =
                parsed.searchParams.get("v");

            if (watchId) {
                return watchId;
            }

            const partes =
                parsed.pathname
                    .split("/")
                    .filter(Boolean);

            if (
                [
                    "shorts",
                    "embed",
                    "live"
                ].includes(partes[0]) &&
                partes[1]
            ) {
                return partes[1];
            }
        }

        return null;

    } catch {
        return null;
    }
}

function obterPythonCommand() {
    return process.platform === "win32"
        ? "python"
        : "python3";
}

// ======================================================
// YT-DLP
// ======================================================

function executarYtDlp(
    url,
    pastaDestino
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {

            const pythonCommand =
                obterPythonCommand();

            const modeloSaida =
                path.join(
                    pastaDestino,
                    "video.%(ext)s"
                );

            const argumentos = [
                "-m",
                "yt_dlp",

                "--no-playlist",

                "--no-warnings",

                "--restrict-filenames",

                "--js-runtimes",
                "node",

                "--extractor-args",
               "youtube:player_client=web,android_vr,tv_downgraded",

                "--ffmpeg-location",
                ffmpegCommand,

                "-f",

                "bv*[height<=720][ext=mp4]+ba[ext=m4a]/" +
                "b[height<=720][ext=mp4]/" +
                "bv*[height<=720]+ba/" +
                "b[height<=720]/best",

                "--merge-output-format",
                "mp4",

                "-o",
                modeloSaida,

                url
            ];

            console.log("");
            console.log("==============================");
            console.log("YOUTUBE - DOWNLOAD TEMPORÁRIO");
            console.log("==============================");

            console.log(
                "Executando yt-dlp com:",
                pythonCommand
            );

            const processo =
                spawn(
                    pythonCommand,
                    argumentos,
                    {
                        env: {
                            ...process.env,

                            PYTHONIOENCODING:
                                "utf-8"
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
                            "[yt-dlp]",
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
                            "[yt-dlp]",
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
                            `Não foi possível iniciar o yt-dlp: ${erro.message}`
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
                                .slice(-8)
                                .join("\n");

                        return reject(
                            new Error(
                                detalhe ||
                                `yt-dlp terminou com código ${codigo}`
                            )
                        );
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
                                    nome.startsWith("video.")
                            );

                    if (
                        arquivos.length === 0
                    ) {
                        return reject(
                            new Error(
                                "O YouTube foi acessado, mas nenhum arquivo de vídeo foi criado."
                            )
                        );
                    }

                    resolve(
                        path.join(
                            pastaDestino,
                            arquivos[0]
                        )
                    );
                }
            );
        }
    );
}

// ======================================================
// PONTE LOCAL DO YOUTUBE
// ======================================================

async function baixarYoutube(
    url,
    pastaDestino,
    informarProgresso = () => {}
) {
    // No computador local, continua usando o yt-dlp diretamente.
    if (!YOUTUBE_BRIDGE_URL) {
        informarProgresso(
            10,
            "Baixando vídeo do YouTube..."
        );

        return executarYtDlp(
            url,
            pastaDestino
        );
    }

    console.log("");
    console.log("==============================");
    console.log("YOUTUBE - PONTE LOCAL");
    console.log("==============================");
    console.log("Iniciando trabalho na ponte...");

    informarProgresso(
        5,
        "Conectando com a ponte do YouTube..."
    );

    const headersPonte = {
        "Content-Type":
            "application/json",

        "x-bridge-secret":
            YOUTUBE_BRIDGE_SECRET
    };

    const respostaInicio = await fetch(
        `${YOUTUBE_BRIDGE_URL}/youtube/start`,
        {
            method: "POST",
            headers: headersPonte,
            body: JSON.stringify({
                url
            })
        }
    );

    if (!respostaInicio.ok) {
        const corpoErro =
            await respostaInicio.text();

        let detalhe = corpoErro;

        try {
            const dados =
                JSON.parse(corpoErro);

            detalhe =
                dados.erro ||
                corpoErro;
        } catch {
            // A ponte pode devolver texto ou HTML em falhas externas.
        }

        throw new Error(
            detalhe ||
            `A ponte respondeu com o código ${respostaInicio.status}.`
        );
    }

    const inicio =
        await respostaInicio.json();

    const jobId = inicio.jobId;

    if (!jobId) {
        throw new Error(
            "A ponte não informou o número do trabalho."
        );
    }

    console.log(
        `Trabalho criado: ${jobId}`
    );

    informarProgresso(
        10,
        "Trabalho iniciado no seu computador."
    );

    const limite =
        Date.now() +
        2 * 60 * 60 * 1000;

    while (Date.now() < limite) {
        await new Promise(
            resolve => setTimeout(resolve, 5000)
        );

        const respostaStatus = await fetch(
            `${YOUTUBE_BRIDGE_URL}/youtube/status/${jobId}`,
            {
                headers: {
                    "x-bridge-secret":
                        YOUTUBE_BRIDGE_SECRET
                }
            }
        );

        if (!respostaStatus.ok) {
            const detalhe =
                await respostaStatus.text();

            throw new Error(
                detalhe ||
                "Não foi possível consultar a ponte."
            );
        }

        const status =
            await respostaStatus.json();

        console.log(
            `[Ponte] ${status.etapa || status.status}`
        );

        informarProgresso(
            Math.min(
                88,
                Number(status.progresso) || 10
            ),
            status.etapa ||
                "Preparando vídeo..."
        );

        if (status.status === "erro") {
            throw new Error(
                status.erro ||
                "A ponte não conseguiu preparar o vídeo."
            );
        }

        if (status.status === "pronto") {
            break;
        }
    }

    if (Date.now() >= limite) {
        throw new Error(
            "A ponte excedeu o limite de duas horas."
        );
    }

    console.log(
        "Vídeo pronto. Iniciando transferência..."
    );

    informarProgresso(
        90,
        "Transferindo o vídeo para o Clip AI..."
    );

    const resposta = await fetch(
        `${YOUTUBE_BRIDGE_URL}/youtube/download/${jobId}`,
        {
            headers: {
                "x-bridge-secret":
                    YOUTUBE_BRIDGE_SECRET
            }
        }
    );

    if (!resposta.ok || !resposta.body) {
        const detalhe =
            await resposta.text();

        throw new Error(
            detalhe ||
            "A ponte não conseguiu enviar o vídeo pronto."
        );
    }

    const caminhoVideo =
        path.join(
            pastaDestino,
            "video.mp4"
        );

    await pipeline(
        Readable.fromWeb(resposta.body),
        fs.createWriteStream(caminhoVideo)
    );

    if (!fs.existsSync(caminhoVideo)) {
        throw new Error(
            "O vídeo não foi criado após o download pela ponte."
        );
    }

    console.log(
        "Vídeo recebido da ponte com sucesso."
    );

    informarProgresso(
        100,
        "Vídeo recebido com sucesso."
    );

    return caminhoVideo;
}

// ======================================================
// CONTENT TYPE
// ======================================================

function obterContentTypeVideo(
    caminhoArquivo
) {
    const extensao =
        path
            .extname(caminhoArquivo)
            .toLowerCase();

    const tipos = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".mkv": "video/x-matroska",
        ".m4v": "video/x-m4v"
    };

    return (
        tipos[extensao] ||
        "video/mp4"
    );
}

// ======================================================
// APAGAR TEMPORÁRIOS
// ======================================================

function apagarPastaTemporaria(
    pasta
) {
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
        console.error(
            "Não foi possível apagar pasta temporária:",
            erro.message
        );
    }
}

// ======================================================
// ROTA DO LINK
// ======================================================

app.get(
    "/video-temporario/:token",
    (
        req,
        res
    ) => {
        const registro =
            obterVideoTemporario(
                req.params.token
            );

        if (!registro) {
            return res
                .status(404)
                .json({
                    sucesso: false,
                    erro:
                        "O vídeo temporário não está mais disponível."
                });
        }

        const tamanho =
            registro.tamanho;

        const range =
            req.headers.range;

        res.setHeader(
            "Accept-Ranges",
            "bytes"
        );

        res.setHeader(
            "Cache-Control",
            "no-store"
        );

        res.setHeader(
            "Content-Type",
            registro.contentType
        );

        if (!range) {
            res.setHeader(
                "Content-Length",
                tamanho
            );

            fs.createReadStream(
                registro.caminho
            ).pipe(res);

            return;
        }

        const partes =
            range.replace(
                /bytes=/,
                ""
            ).split("-");

        const inicio =
            Number.parseInt(
                partes[0],
                10
            ) || 0;

        const fimSolicitado =
            partes[1]
                ? Number.parseInt(
                    partes[1],
                    10
                )
                : inicio +
                    1024 * 1024 - 1;

        const fim =
            Math.min(
                fimSolicitado,
                tamanho - 1
            );

        if (
            inicio < 0 ||
            inicio >= tamanho ||
            fim < inicio
        ) {
            res.status(416);
            res.setHeader(
                "Content-Range",
                `bytes */${tamanho}`
            );
            return res.end();
        }

        res.status(206);
        res.setHeader(
            "Content-Range",
            `bytes ${inicio}-${fim}/${tamanho}`
        );
        res.setHeader(
            "Content-Length",
            fim - inicio + 1
        );

        fs.createReadStream(
            registro.caminho,
            {
                start: inicio,
                end: fim
            }
        ).pipe(res);
    }
);

app.get(
    "/video-link/progresso/:downloadId",
    (
        req,
        res
    ) => {
        const dados =
            progressoLinks.get(
                req.params.downloadId
            );

        if (!dados) {
            return res.json({
                progresso: 0,
                etapa: "Aguardando início..."
            });
        }

        res.json(dados);
    }
);

app.post(
    "/video-link",
    async (
        req,
        res
    ) => {

        const {
            url,
            downloadId
        } = req.body;

        atualizarProgressoLink(
            downloadId,
            2,
            "Link recebido pelo Clip AI."
        );

        if (!url) {
            return res
                .status(400)
                .json({
                    sucesso: false,
                    erro:
                        "Nenhum link informado."
                });
        }

        // ==================================================
        // YOUTUBE
        // ==================================================

        if (
            ehLinkYouTube(url)
        ) {
            const videoId =
                obterIdYouTube(url);

            const pastaTemporaria =
                path.join(
                    uploadsDir,

                    `youtube-${Date.now()}-${Math.round(
                        Math.random() *
                        1e9
                    )}`
                );

            fs.mkdirSync(
                pastaTemporaria,
                {
                    recursive: true
                }
            );

            try {
                console.log("");
                console.log(
                    "Link do YouTube recebido:"
                );
                console.log(url);

                if (videoId) {
                    console.log(
                        "ID do YouTube:",
                        videoId
                    );
                }

                const caminhoVideo =
                    await baixarYoutube(
                        url,
                        pastaTemporaria,
                        (
                            progresso,
                            etapa
                        ) => {
                            atualizarProgressoLink(
                                downloadId,
                                progresso,
                                etapa
                            );
                        }
                    );

                const stats =
                    fs.statSync(
                        caminhoVideo
                    );

                const contentType =
                    obterContentTypeVideo(
                        caminhoVideo
                    );

                const extensao =
                    path.extname(
                        caminhoVideo
                    ) ||
                    ".mp4";

                console.log(
                    "Download do YouTube concluído."
                );

                console.log(
                    "Tamanho:",
                    (
                        stats.size /
                        1024 /
                        1024
                    ).toFixed(2),
                    "MB"
                );

                const registro =
                    registrarVideoTemporario(
                        caminhoVideo,
                        `youtube-video${extensao}`,
                        contentType
                    );

                apagarPastaTemporaria(
                    pastaTemporaria
                );

                atualizarProgressoLink(
                    downloadId,
                    100,
                    "Vídeo pronto para análise."
                );

                console.log(
                    "Vídeo guardado no servidor para análise e geração sem reenvio."
                );

                return res.json({
                    sucesso: true,
                    tipo: "youtube",
                    videoToken:
                        registro.token,
                    nome:
                        registro.nome,
                    tamanho:
                        registro.tamanho,
                    contentType:
                        registro.contentType,
                    previewUrl:
                        `/video-temporario/${encodeURIComponent(
                            registro.token
                        )}`
                });

            } catch (erro) {
                atualizarProgressoLink(
                    downloadId,
                    0,
                    "Falha ao preparar o vídeo.",
                    erro.message ||
                        "Erro desconhecido."
                );

                apagarPastaTemporaria(
                    pastaTemporaria
                );

                console.error(
                    "Erro ao baixar vídeo do YouTube:",
                    erro
                );

                const mensagem =
                    String(
                        erro.message ||
                        ""
                    );

                const mensagemLower =
                    mensagem.toLowerCase();

                const bloqueado =
                    mensagemLower.includes("sign in") ||
                    mensagemLower.includes("bot") ||
                    mensagemLower.includes(
                        "confirm you're not a bot"
                    ) ||
                    mensagem.includes("403");

                return res
                    .status(
                        bloqueado
                            ? 502
                            : 500
                    )
                    .json({
                        sucesso: false,

                        tipo:
                            bloqueado
                                ? "youtube-bloqueado"
                                : "youtube",

                        videoId,

                        erro:
                            bloqueado
                                ?
                                "O YouTube bloqueou o acesso automático deste servidor para esse vídeo. Tente outro vídeo ou faça upload do arquivo."
                                :
                                "Não foi possível baixar esse vídeo do YouTube. Veja o terminal do servidor para o detalhe técnico."
                    });
            }
        }

        // ==================================================
        // LINKS DIRETOS
        // ==================================================

        try {
            const resposta =
                await fetch(url);

            if (!resposta.ok) {
                return res
                    .status(400)
                    .json({
                        sucesso: false,

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
                !contentType.includes("video") &&
                !url
                    .toLowerCase()
                    .includes(".mp4")
            ) {
                return res
                    .status(400)
                    .json({
                        sucesso: false,

                        erro:
                            "Esse endereço não parece ser um link direto de vídeo."
                    });
            }

            const arrayBuffer =
                await resposta.arrayBuffer();

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

            return res.send(buffer);

        } catch (erro) {
            console.error(
                "Erro ao carregar link:",
                erro
            );

            return res
                .status(500)
                .json({
                    sucesso: false,

                    erro:
                        "O servidor não conseguiu acessar esse link."
                });
        }
    }
);

// ======================================================
// GROQ / WHISPER
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
                obterPythonCommand();

            console.log(
                "Executando Whisper/Groq com:",
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

            let saida = "";
            let erroSaida = "";

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

                    erroSaida += texto;

                    if (texto.trim()) {
                        console.log(
                            "[Whisper]",
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

                        let resultado;

                        try {
                            resultado =
                                JSON.parse(texto);

                        } catch {
                            const inicio =
                                texto.lastIndexOf(
                                    "\n{"
                                );

                            resultado =
                                JSON.parse(
                                    inicio >= 0
                                        ?
                                        texto.slice(
                                            inicio + 1
                                        )
                                        :
                                        texto
                                );
                        }

                        resolve(resultado);

                    } catch (erro) {
                        console.error(
                            "Saída recebida do Python:",
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
// PALAVRAS IMPORTANTES
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

// ======================================================
// SCORE
// ======================================================

function calcularScore(
    texto,
    duracao
) {
    const frase =
        String(
            texto ||
            ""
        ).toLowerCase();

    let score = 50;

    for (
        const palavra
        of palavrasFortes
    ) {
        if (
            frase.includes(
                palavra
            )
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

// ======================================================
// TÍTULO
// ======================================================

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
        palavras.length === 0
    ) {
        return (
            `Melhor momento ${indice + 1}`
        );
    }

    const titulo =
        palavras
            .slice(0, 8)
            .join(" ");

    return titulo.length > 60
        ?
        `${titulo.slice(
            0,
            57
        )}...`
        :
        titulo;
}

// ======================================================
// CONFIGURAÇÃO DE CORTES
// ======================================================

function obterConfiguracao(
    duracao
) {
    if (
        duracao <= 90
    ) {
        return {
            quantidade: 3,
            minimo: 12,
            maximo: 30
        };
    }

    if (
        duracao <= 300
    ) {
        return {
            quantidade: 5,
            minimo: 15,
            maximo: 40
        };
    }

    if (
        duracao <= 900
    ) {
        return {
            quantidade: 8,
            minimo: 18,
            maximo: 50
        };
    }

    if (
        duracao <= 1800
    ) {
        return {
            quantidade: 12,
            minimo: 20,
            maximo: 55
        };
    }

    if (
        duracao <= 3600
    ) {
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

// ======================================================
// CANDIDATOS
// ======================================================

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
        const inicio =
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

// ======================================================
// SOBREPOSIÇÃO DE CORTES
// ======================================================

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
        fim -
        inicio
    );
}

// ======================================================
// MELHORES CORTES
// ======================================================

function escolherMelhoresCortes(
    segmentos,
    duracaoVideo
) {
    const configuracao =
        obterConfiguracao(
            duracaoVideo
        );

    const candidatos =
        criarCandidatos(
            segmentos,
            configuracao.minimo,
            configuracao.maximo
        );

    console.log(
        "Duração do vídeo:",
        duracaoVideo
    );

    console.log(
        "Meta de clipes:",
        configuracao.quantidade
    );

    console.log(
        "Candidatos encontrados:",
        candidatos.length
    );

    candidatos.sort(
        (a, b) =>
            b.score -
            a.score
    );

    const escolhidos = [];

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

            score: 70
        });
    }

    escolhidos.sort(
        (a, b) =>
            a.inicio -
            b.inicio
    );

    const resultado =
        escolhidos.map(
            (
                corte,
                indice
            ) => ({
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

// ======================================================
// ANALISAR VÍDEO
// ======================================================

app.post(
    "/analisar-video",

    upload.single("video"),

    async (
        req,
        res
    ) => {

        const jobId =
            req.body?.jobId ||
            null;

        const videoTemporario =
            obterVideoTemporario(
                req.body?.videoToken
            );

        criarTrabalho(jobId);

        if (
            !req.file &&
            !videoTemporario
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
                    sucesso: false,

                    erro:
                        "Nenhum vídeo foi enviado."
                });
        }

        const caminhoVideo =
            req.file?.path ||
            videoTemporario.caminho;

        let timerProgresso =
            null;

        try {
            console.log("");
            console.log("===========================");
            console.log("NOVO VÍDEO RECEBIDO");
            console.log("===========================");
            console.log(
                "Arquivo:",
                req.file?.originalname ||
                videoTemporario.nome
            );

            atualizarTrabalho(
                jobId,
                10,
                "Vídeo recebido. Preparando análise..."
            );

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

            if (timerProgresso) {
                clearInterval(
                    timerProgresso
                );

                timerProgresso =
                    null;
            }

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
                transcricao.segmentos ||
                [];

            const ultimoSegmento =
                segmentos[
                    segmentos.length - 1
                ];

            const duracao =
                Number(
                    transcricao.duracao ||
                    ultimoSegmento?.fim ||
                    ultimoSegmento?.end ||
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

            atualizarTrabalho(
                jobId,
                100,
                "Análise concluída."
            );

            limparTrabalhoDepois(
                jobId
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
            if (timerProgresso) {
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
                    sucesso: false,

                    erro:
                        erro.message ||
                        "Erro ao analisar o vídeo."
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

            } catch (erro) {
                console.error(
                    "Não foi possível apagar o arquivo temporário:",
                    erro.message
                );
            }
        }
    }
);

// ======================================================
// FFMPEG
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

            const processo =
                spawn(
                    ffmpegCommand,
                    argumentos,
                    {
                        cwd,
                        windowsHide: true
                    }
                );

            let erroSaida = "";

            processo.stderr.on(
                "data",
                data => {
                    const texto =
                        data.toString(
                            "utf8"
                        );

                    erroSaida +=
                        texto;

                    if (texto.trim()) {
                        console.log(
                            "[FFmpeg]",
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
                            `Não foi possível iniciar o FFmpeg: ${erro.message}`
                        )
                    );
                }
            );

            processo.on(
                "close",
                codigo => {
                    if (codigo === 0) {
                        resolve();
                        return;
                    }

                    reject(
                        new Error(
                            `FFmpeg terminou com código ${codigo}.\n` +
                            erroSaida.slice(-2500)
                        )
                    );
                }
            );
        }
    );
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
            Number(segundos) ||
            0
        );

    const horas =
        Math.floor(
            total / 3600
        );

    const minutos =
        Math.floor(
            (total % 3600) /
            60
        );

    const segundosRestantes =
        total % 60;

    return (
        `${horas}:` +
        `${String(minutos).padStart(
            2,
            "0"
        )}:` +
        `${segundosRestantes
            .toFixed(2)
            .padStart(
                5,
                "0"
            )}`
    );
}

// ======================================================
// LIMPAR TEXTO
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
// ESCAPAR TEXTO ASS
// ======================================================

function escaparTextoASS(
    texto
) {
    return limparTextoLegenda(
        texto
    )
        .replace(
            /\\/g,
            ""
        )
        .replace(
            /[{}]/g,
            ""
        )
        .trim();
}

// ======================================================
// DUAS LINHAS
// AMARELA EM CIMA + BRANCA EMBAIXO
// ======================================================

function formatarDuasLinhasASS(
    listaPalavras
) {
    const palavras =
        listaPalavras
            .map(
                item =>
                    escaparTextoASS(
                        typeof item ===
                            "string"
                            ?
                            item
                            :
                            item?.texto ??
                            item?.palavra ??
                            item?.word ??
                            ""
                    )
            )
            .filter(Boolean);

    if (
        palavras.length === 0
    ) {
        return "";
    }

    const pontoQuebra =
        Math.ceil(
            palavras.length /
            2
        );

    const linhaAmarela =
        palavras
            .slice(
                0,
                pontoQuebra
            )
            .join(" ")
            .toUpperCase();

    const linhaBranca =
        palavras
            .slice(
                pontoQuebra
            )
            .join(" ")
            .toUpperCase();

    // ASS usa AABBGGRR
    // amarelo visual

    const amarelo =
        "{\\c&H0000D4FF&}";

    const branco =
        "{\\c&H00FFFFFF&}";

    if (!linhaBranca) {
        return (
            `${amarelo}${linhaAmarela}`
        );
    }

    return (
        `${amarelo}${linhaAmarela}\\N` +
        `${branco}${linhaBranca}`
    );
}

// ======================================================
// REMOVER PALAVRAS REPETIDAS / SOBREPOSTAS
// ======================================================

function normalizarPalavrasLegenda(
    palavras,
    inicioCorte,
    fimCorte
) {
    const validas = [];

    for (
        const item
        of palavras
    ) {
        const texto =
            limparTextoLegenda(
                item.palavra ??
                item.word ??
                item.texto ??
                ""
            );

        let inicio =
            Number(
                item.inicio ??
                item.start
            );

        let fim =
            Number(
                item.fim ??
                item.end
            );

        if (
            !texto ||
            !Number.isFinite(inicio) ||
            !Number.isFinite(fim)
        ) {
            continue;
        }

        if (
            fim <= inicioCorte ||
            inicio >= fimCorte
        ) {
            continue;
        }

        inicio =
            Math.max(
                inicio,
                inicioCorte
            );

        fim =
            Math.min(
                fim,
                fimCorte
            );

        if (
            fim <= inicio
        ) {
            continue;
        }

        const ultimo =
            validas[
                validas.length - 1
            ];

        // ==============================================
        // Se Groq devolver a MESMA palavra duplicada
        // praticamente no mesmo tempo, ignora.
        // ==============================================

        if (ultimo) {
            const mesmoTexto =
                ultimo.texto
                    .toLowerCase() ===
                texto.toLowerCase();

            const muitoPerto =
                Math.abs(
                    ultimo.inicio -
                    inicio
                ) < 0.12;

            if (
                mesmoTexto &&
                muitoPerto
            ) {
                continue;
            }
        }

        validas.push({
            texto,
            inicio,
            fim
        });
    }

    validas.sort(
        (a, b) =>
            a.inicio -
            b.inicio
    );

    return validas;
}

// ======================================================
// CRIAR BLOCOS DE LEGENDA
// ======================================================

function criarBlocosPalavras(
    palavras,
    inicioCorte,
    fimCorte
) {
    const validas =
        normalizarPalavrasLegenda(
            palavras,
            inicioCorte,
            fimCorte
        );

    const blocos = [];

    // ==================================================
    // MÁXIMO DE 5 PALAVRAS POR BLOCO
    // Menos risco de quebra automática em 3 ou 4 linhas.
    // ==================================================

    const quantidadePorBloco =
        5;

    for (
        let i = 0;
        i < validas.length;
        i += quantidadePorBloco
    ) {
        const grupo =
            validas.slice(
                i,
                i +
                quantidadePorBloco
            );

        if (
            grupo.length === 0
        ) {
            continue;
        }

        let inicio =
            grupo[0].inicio;

        let fim =
            grupo[
                grupo.length - 1
            ].fim;

        if (
            !Number.isFinite(inicio) ||
            !Number.isFinite(fim)
        ) {
            continue;
        }

        if (
            fim <= inicio
        ) {
            fim =
                inicio + 0.15;
        }

        blocos.push({
            inicio,
            fim,

            texto:
                formatarDuasLinhasASS(
                    grupo
                )
        });
    }

    // ==================================================
    // CORREÇÃO PRINCIPAL:
    // IMPEDE DUAS LEGENDAS DE FICAREM NA TELA AO MESMO TEMPO
    // ==================================================

    for (
        let i = 0;
        i < blocos.length;
        i++
    ) {
        const atual =
            blocos[i];

        const proximo =
            blocos[i + 1];

        if (!proximo) {
            continue;
        }

        // deixa pequeno espaço entre uma legenda e outra

        const limite =
            proximo.inicio -
            0.03;

        if (
            atual.fim >
            limite
        ) {
            atual.fim =
                limite;
        }

        // segurança para nunca terminar antes de começar

        if (
            atual.fim <=
            atual.inicio
        ) {
            atual.fim =
                Math.min(
                    atual.inicio +
                    0.12,
                    proximo.inicio -
                    0.01
                );
        }
    }

    return blocos.filter(
        bloco =>
            bloco.texto &&
            bloco.fim >
            bloco.inicio
    );
}

// ======================================================
// CABEÇALHO ASS
// ======================================================

function cabecalhoASS() {
    return `[Script Info]
ScriptType: v4.00+
PlayResX: 540
PlayResY: 960
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Legenda,Arial,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,2,30,30,145,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
}

// ======================================================
// AJUSTAR EVENTOS PARA NUNCA SOBREPOR
// ======================================================

function corrigirSobreposicaoEventos(
    eventos
) {
    if (
        eventos.length <= 1
    ) {
        return eventos;
    }

    eventos.sort(
        (a, b) =>
            a.inicio -
            b.inicio
    );

    const corrigidos = [];

    for (
        let i = 0;
        i < eventos.length;
        i++
    ) {
        const atual = {
            ...eventos[i]
        };

        const proximo =
            eventos[i + 1];

        if (proximo) {
            const limiteFim =
                proximo.inicio -
                0.03;

            if (
                atual.fim >
                limiteFim
            ) {
                atual.fim =
                    limiteFim;
            }
        }

        if (
            atual.fim <=
            atual.inicio
        ) {
            continue;
        }

        corrigidos.push(
            atual
        );
    }

    return corrigidos;
}

// ======================================================
// CRIAR ASS DO CORTE
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

    const palavrasDoCorte = [];

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
                ?
                segmento.palavras
                :
                Array.isArray(
                    segmento.words
                )
                    ?
                    segmento.words
                    :
                    [];

        palavrasDoCorte.push(
            ...palavras
        );
    }

    const blocos =
        criarBlocosPalavras(
            palavrasDoCorte,
            inicioCorte,
            fimCorte
        );

    let eventos = [];

    // ==================================================
    // COM TIMESTAMPS DE PALAVRAS
    // ==================================================

    if (
        blocos.length > 0
    ) {
        for (
            const bloco
            of blocos
        ) {
            const inicio =
                Math.max(
                    0,
                    bloco.inicio -
                    inicioCorte
                );

            const fim =
                Math.min(
                    fimCorte -
                    inicioCorte,

                    Math.max(
                        inicio + 0.08,

                        bloco.fim -
                        inicioCorte
                    )
                );

            if (
                fim <= inicio ||
                !bloco.texto
            ) {
                continue;
            }

            eventos.push({
                inicio,
                fim,
                texto:
                    bloco.texto
            });
        }

        // SEGUNDA TRAVA:
        // mesmo se algum timestamp estranho escapar da primeira,
        // aqui garantimos que os eventos finais não se sobreponham.

        eventos =
            corrigirSobreposicaoEventos(
                eventos
            );

        const linhas =
            eventos.map(
                evento =>
                    `Dialogue: 0,${tempoASS(
                        evento.inicio
                    )},${tempoASS(
                        evento.fim
                    )},Legenda,,0,0,0,,${evento.texto}`
            );

        return (
            cabecalhoASS() +
            linhas.join("\n") +
            "\n"
        );
    }

    // ==================================================
    // FALLBACK SEM TIMESTAMPS DE PALAVRA
    // ==================================================

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
            fimOriginal <= inicioCorte ||
            inicioOriginal >= fimCorte
        ) {
            continue;
        }

        const textoCompleto =
            limparTextoLegenda(
                segmento.texto ??
                segmento.text ??
                ""
            );

        if (!textoCompleto) {
            continue;
        }

        const palavras =
            textoCompleto
                .split(/\s+/)
                .filter(Boolean);

        const grupos = [];

        for (
            let i = 0;
            i < palavras.length;
            i += 5
        ) {
            grupos.push(
                palavras.slice(
                    i,
                    i + 5
                )
            );
        }

        const inicioSegmento =
            Math.max(
                inicioOriginal,
                inicioCorte
            );

        const fimSegmento =
            Math.min(
                fimOriginal,
                fimCorte
            );

        const duracaoSegmento =
            Math.max(
                0.1,
                fimSegmento -
                inicioSegmento
            );

        const duracaoGrupo =
            duracaoSegmento /
            Math.max(
                1,
                grupos.length
            );

        grupos.forEach(
            (
                grupo,
                grupoIndex
            ) => {

                const inicioAbs =
                    inicioSegmento +
                    grupoIndex *
                    duracaoGrupo;

                const fimAbs =
                    Math.min(
                        fimSegmento,

                        inicioAbs +
                        duracaoGrupo -
                        0.03
                    );

                const inicio =
                    Math.max(
                        0,
                        inicioAbs -
                        inicioCorte
                    );

                const fim =
                    Math.max(
                        inicio + 0.08,

                        fimAbs -
                        inicioCorte
                    );

                const texto =
                    formatarDuasLinhasASS(
                        grupo
                    );

                if (!texto) {
                    return;
                }

                eventos.push({
                    inicio,
                    fim,
                    texto
                });
            }
        );
    }

    eventos =
        corrigirSobreposicaoEventos(
            eventos
        );

    const linhas =
        eventos.map(
            evento =>
                `Dialogue: 0,${tempoASS(
                    evento.inicio
                )},${tempoASS(
                    evento.fim
                )},Legenda,,0,0,0,,${evento.texto}`
        );

    return (
        cabecalhoASS() +
        linhas.join("\n") +
        "\n"
    );
}

// ======================================================
// JSON
// ======================================================

function normalizarArrayJSON(
    valor,
    nome
) {
    if (
        Array.isArray(valor)
    ) {
        return valor;
    }

    if (
        typeof valor !== "string" ||
        !valor.trim()
    ) {
        return [];
    }

    try {
        const convertido =
            JSON.parse(valor);

        if (
            !Array.isArray(
                convertido
            )
        ) {
            throw new Error(
                `${nome} precisa ser uma lista.`
            );
        }

        return convertido;

    } catch (erro) {
        throw new Error(
            `${nome} inválida: ${erro.message}`
        );
    }
}

// ======================================================
// LIMPEZA GERADOS
// ======================================================

function apagarPastaDepois(
    pasta,
    minutos = 60
) {
    setTimeout(
        () => {
            try {
                if (
                    fs.existsSync(
                        pasta
                    )
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
                console.error(
                    "Não foi possível apagar a pasta de clipes:",
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
// ======================================================

app.post(
    "/gerar-clipes",

    upload.single("video"),

    async (
        req,
        res
    ) => {

        const jobId =
            req.body?.jobId ||
            `job-${Date.now()}`;

        const videoTemporario =
            obterVideoTemporario(
                req.body?.videoToken
            );

        criarTrabalho(jobId);

        if (
            !req.file &&
            !videoTemporario
        ) {
            marcarErro(
                jobId,
                "Nenhum vídeo foi enviado para geração."
            );

            return res
                .status(400)
                .json({
                    sucesso: false,

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
                cortes.length === 0
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
                String(jobId)
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
                    recursive: true
                }
            );

            const extensao =
                path.extname(
                    req.file?.originalname ||
                    videoTemporario.nome
                ) ||
                ".mp4";

            const nomeEntrada =
                `entrada${extensao}`;

            const caminhoEntrada =
                path.join(
                    pastaTrabalho,
                    nomeEntrada
                );

            const entradaFFmpeg =
                videoTemporario
                    ? videoTemporario.caminho
                    : caminhoEntrada;

            if (req.file) {
                fs.copyFileSync(
                    req.file.path,
                    caminhoEntrada
                );
            }

            const resultado = [];

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
                    !Number.isFinite(inicio) ||
                    !Number.isFinite(fim) ||
                    fim <= inicio
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

                const progressoAntes =
                    10 +
                    Math.round(
                        (
                            i /
                            cortes.length
                        ) *
                        85
                    );

                atualizarTrabalho(
                    jobId,
                    progressoAntes,

                    `Gerando clipe ${i + 1} de ${cortes.length} com legenda dinâmica...`
                );

                const caminhoMarca =
                    path.join(
                        process.cwd(),
                        "favicon.png"
                    );

                const temMarca =
                    fs.existsSync(
                        caminhoMarca
                    );

                // Mantém a saída em 9:16, usa um quadro frontal 3:4 com
                // menos zoom e completa o restante com fundo preto.
                // Se favicon.png estiver presente, adiciona a marca d'água.
                const filtroLegenda =
                    "[0:v]" +
                    "scale=540:720:force_original_aspect_ratio=increase," +
                    "crop=540:720," +
                    "pad=540:960:0:120:color=black[quadro];" +
                    (
                        temMarca
                            ?
                            "[1:v]scale=72:-1,format=rgba," +
                            "colorchannelmixer=aa=0.65[marca];" +
                            "[quadro][marca]" +
                            "overlay=W-w-18:18,fps=30"
                            :
                            "[quadro]fps=30"
                    ) +
                    (
                        ass.trim()
                            ? `,subtitles=${nomeLegenda}`
                            : ""
                    ) +
                    ",format=yuv420p[video_final]";

                await executarFFmpeg(
                    [
                        "-y",

                        "-ss",
                        String(inicio),

                        "-i",
                        entradaFFmpeg,

                        ...(
                            temMarca
                                ? [
                                    "-loop",
                                    "1",
                                    "-i",
                                    caminhoMarca
                                ]
                                : []
                        ),

                        "-t",
                        String(duracao),

                        "-filter_complex",
                        filtroLegenda,

                        "-map",
                        "[video_final]",

                        "-map",
                        "0:a?",

                        "-c:v",
                        "libx264",

                        "-preset",
                        "superfast",

                        "-crf",
                        "23",

                        "-c:a",
                        "aac",

                        "-b:a",
                        "128k",

                        "-movflags",
                        "+faststart",

                        nomeSaida
                    ],

                    pastaTrabalho
                );

                resultado.push({
                    ...corte,

                    start: inicio,
                    end: fim,

                    arquivo:
                        nomeSaida,

                    url:
                        `/generated/${encodeURIComponent(
                            pastaNome
                        )}/${encodeURIComponent(
                            nomeSaida
                        )}`
                });

                const progressoDepois =
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
                    );

                atualizarTrabalho(
                    jobId,
                    progressoDepois,

                    `Clipe ${i + 1} de ${cortes.length} concluído.`
                );
            }

            atualizarTrabalho(
                jobId,
                100,
                "Clipes com legenda dinâmica concluídos."
            );

            limparTrabalhoDepois(
                jobId
            );

            apagarPastaDepois(
                pastaTrabalho,
                60
            );

            if (videoTemporario) {
                apagarVideoTemporario(
                    videoTemporario.token
                );
            }

            return res.json({
                sucesso: true,
                jobId,
                cortes: resultado
            });

        } catch (erro) {
            console.error(
                "ERRO AO GERAR CLIPES:",
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

            if (pastaTrabalho) {
                try {
                    fs.rmSync(
                        pastaTrabalho,
                        {
                            recursive: true,
                            force: true
                        }
                    );

                } catch {
                    // nada
                }
            }

            return res
                .status(500)
                .json({
                    sucesso: false,

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

            } catch (erro) {
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
        console.log("");
        console.log("==============================");
        console.log("       CLIP AI BACKEND");
        console.log("==============================");
        console.log("");

        console.log(
            `Servidor rodando na porta ${PORT}`
        );

        console.log("");

        console.log(
            "✓ Links diretos"
        );

        console.log(
            "✓ YouTube: download temporário via yt-dlp"
        );

        console.log(
            "✓ Groq/Whisper preparado"
        );

        console.log(
            "✓ Vídeo curto: até 3 clipes"
        );

        console.log(
            "✓ Vídeo de 1 hora: até 15 clipes"
        );

        console.log(
            "✓ Timestamps por palavra preparados"
        );

        console.log(
            "✓ Progresso da IA preparado"
        );

        console.log(
            `✓ FFmpeg preparado: ${ffmpegCommand}`
        );

        console.log(
            "✓ Legenda tamanho 30"
        );

        console.log(
            "✓ Linha superior amarela"
        );

        console.log(
            "✓ Linha inferior branca"
        );

        console.log(
            "✓ Proteção contra legendas sobrepostas"
        );

        console.log(
            "✓ Máximo de 5 palavras por bloco"
        );

        console.log(
            "✓ Legendas posicionadas mais acima"
        );

        console.log(
            "✓ Vídeos temporários do YouTube são apagados automaticamente"
        );

        console.log(
            "✓ Render preparado"
        );

        console.log("");
    }
);
