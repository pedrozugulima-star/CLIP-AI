import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// ======================================================
// SERVIDOR
// No computador: localhost
// No Render: usa automaticamente o endereço do site
// ======================================================

const API_BASE =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
        ? "http://localhost:3000"
        : "";

// ======================================================
// ELEMENTOS
// ======================================================

const videoInput = document.getElementById("videoInput");
const selectButton = document.getElementById("selectButton");
const videoPreview = document.getElementById("videoPreview");

const videoLink = document.getElementById("videoLink");
const linkButton = document.getElementById("linkButton");

const selectedFileBox = document.getElementById("selectedFileBox");
const selectedFileName = document.getElementById("selectedFileName");
const selectedFileSize = document.getElementById("selectedFileSize");

const previewArea = document.getElementById("previewArea");
const manualArea = document.getElementById("manualArea");

const startTime = document.getElementById("startTime");
const endTime = document.getElementById("endTime");

const markStartButton = document.getElementById("markStartButton");
const markEndButton = document.getElementById("markEndButton");
const addCutButton = document.getElementById("addCutButton");

const pendingCuts =
    document.getElementById("pendingCuts") ||
    document.getElementById("cutsList");

const generateButton = document.getElementById("generateButton");

const processingArea = document.getElementById("processingArea");
const processingTitle = document.getElementById("processingTitle");
const processingText = document.getElementById("processingText");
const progressBar = document.getElementById("progressBar");

const resultsArea = document.getElementById("resultsArea");
const resultsCount = document.getElementById("resultsCount");
const clipsGrid = document.getElementById("clipsGrid");

// ======================================================
// ESTADO
// ======================================================

let selectedFile = null;
let videoURL = null;
let cortes = [];
let clipURLs = [];
let ffmpegLoaded = false;

const ffmpeg = new FFmpeg();

ffmpeg.on("log", ({ message }) => {
    console.log("FFMPEG:", message);
});

// ======================================================
// AUXILIARES
// ======================================================

function mostrar(elemento) {
    elemento?.classList.remove("hidden");
}

function esconder(elemento) {
    elemento?.classList.add("hidden");
}

function atualizarProgresso(valor) {
    if (progressBar) {
        progressBar.style.width = `${valor}%`;
    }
}

function atualizarProcessamento(titulo, texto = "") {
    if (processingTitle) {
        processingTitle.innerText = titulo;
    }

    if (processingText) {
        processingText.innerText = texto;
    }
}

function formatarTempo(segundos) {
    segundos = Math.max(0, Number(segundos) || 0);

    const minutos = Math.floor(segundos / 60);
    const resto = Math.floor(segundos % 60);

    return (
        String(minutos).padStart(2, "0") +
        ":" +
        String(resto).padStart(2, "0")
    );
}

function formatarDuracao(segundos) {
    segundos = Math.max(0, Number(segundos) || 0);

    if (segundos < 60) {
        return `${Math.round(segundos)}s`;
    }

    const minutos = Math.floor(segundos / 60);
    const resto = Math.round(segundos % 60);

    return `${minutos}m ${resto}s`;
}

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ======================================================
// LIMPAR RESULTADOS
// ======================================================

function limparResultados() {
    clipURLs.forEach((url) => {
        URL.revokeObjectURL(url);
    });

    clipURLs = [];

    if (clipsGrid) {
        clipsGrid.innerHTML = "";
    }

    esconder(resultsArea);
}

// ======================================================
// PREPARAR VÍDEO
// ======================================================

function prepararVideo(file) {
    selectedFile = file;
    cortes = [];

    limparResultados();

    if (videoURL) {
        URL.revokeObjectURL(videoURL);
    }

    videoURL = URL.createObjectURL(file);

    if (selectedFileName) {
        selectedFileName.innerText = file.name;
    }

    if (selectedFileSize) {
        const mb = file.size / 1024 / 1024;
        selectedFileSize.innerText = `${mb.toFixed(1)} MB`;
    }

    mostrar(selectedFileBox);
    mostrar(previewArea);
    mostrar(manualArea);

    if (videoPreview) {
        videoPreview.src = videoURL;
        videoPreview.load();

        videoPreview.onloadedmetadata = () => {
            const duracao = videoPreview.duration;

            if (startTime) {
                startTime.value = 0;
            }

            if (endTime) {
                endTime.value = Math.min(30, duracao).toFixed(1);
            }

            if (generateButton) {
                generateButton.disabled = false;
            }
        };
    }

    mostrarCortesPendentes();
}

// ======================================================
// ESCOLHER ARQUIVO
// ======================================================

selectButton?.addEventListener("click", () => {
    videoInput?.click();
});

videoInput?.addEventListener("change", () => {
    const file = videoInput.files?.[0];

    if (!file) {
        return;
    }

    prepararVideo(file);
});

// ======================================================
// LINK
// ======================================================

linkButton?.addEventListener("click", async () => {
    const link = videoLink?.value.trim();

    if (!link) {
        alert("Cole um link primeiro.");
        return;
    }

    linkButton.disabled = true;
    linkButton.innerText = "Carregando...";

    try {
        const resposta = await fetch(`${API_BASE}/video-link`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                url: link
            })
        });

        const contentType =
            resposta.headers.get("content-type") || "";

        // YouTube ou resposta JSON
        if (contentType.includes("application/json")) {
            const dados = await resposta.json();

            if (!resposta.ok) {
                throw new Error(
                    dados.erro ||
                    dados.error ||
                    "Não foi possível processar o link."
                );
            }

            if (
                dados.youtube ||
                dados.youtubeVideoId ||
                dados.videoId
            ) {
                const id =
                    dados.youtubeVideoId ||
                    dados.videoId ||
                    "";

                alert(
                    "YouTube detectado com sucesso!" +
                    (id ? `\n\nID do vídeo: ${id}` : "") +
                    "\n\nO Clip AI reconheceu o vídeo corretamente."
                );

                return;
            }

            throw new Error(
                dados.mensagem ||
                "O link foi reconhecido, mas não retornou um vídeo."
            );
        }

        if (!resposta.ok) {
            throw new Error(
                "Não foi possível carregar esse vídeo."
            );
        }

        const blob = await resposta.blob();

        if (!blob.type.startsWith("video/")) {
            throw new Error(
                "O link não retornou um arquivo de vídeo."
            );
        }

        let extensao = "mp4";

        if (blob.type.includes("webm")) {
            extensao = "webm";
        }

        if (blob.type.includes("quicktime")) {
            extensao = "mov";
        }

        const file = new File(
            [blob],
            `video-link.${extensao}`,
            {
                type: blob.type
            }
        );

        prepararVideo(file);

        alert("Vídeo carregado pelo link!");

    } catch (erro) {
        console.error(erro);

        alert(
            "Não foi possível carregar o vídeo.\n\n" +
            (erro.message || "Erro desconhecido.")
        );

    } finally {
        linkButton.disabled = false;
        linkButton.innerText = "Usar link";
    }
});

// ======================================================
// CORTE MANUAL
// ======================================================

markStartButton?.addEventListener("click", () => {
    if (!selectedFile || !videoPreview) {
        return;
    }

    startTime.value =
        videoPreview.currentTime.toFixed(1);
});

markEndButton?.addEventListener("click", () => {
    if (!selectedFile || !videoPreview) {
        return;
    }

    endTime.value =
        videoPreview.currentTime.toFixed(1);
});

addCutButton?.addEventListener("click", () => {
    if (!selectedFile) {
        alert("Selecione um vídeo.");
        return;
    }

    const start = Number(startTime?.value);
    const end = Number(endTime?.value);

    if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start
    ) {
        alert("Confira o início e o fim do corte.");
        return;
    }

    if (
        Number.isFinite(videoPreview?.duration) &&
        end > videoPreview.duration
    ) {
        alert(
            "O corte ultrapassa a duração do vídeo."
        );
        return;
    }

    cortes.push({
        start,
        end,
        titulo: `Corte ${cortes.length + 1}`
    });

    mostrarCortesPendentes();
});

// ======================================================
// MOSTRAR CORTES
// ======================================================

function mostrarCortesPendentes() {
    if (!pendingCuts) {
        return;
    }

    pendingCuts.innerHTML = "";

    cortes.forEach((corte, index) => {
        const item = document.createElement("div");
        item.className = "pending-cut";

        const texto = document.createElement("span");

        texto.innerText =
            `${corte.titulo || `Corte ${index + 1}`} • ` +
            `${formatarTempo(corte.start)} → ` +
            `${formatarTempo(corte.end)}`;

        const remover = document.createElement("button");

        remover.type = "button";
        remover.innerText = "Remover";

        remover.addEventListener("click", () => {
            cortes.splice(index, 1);
            mostrarCortesPendentes();
        });

        item.appendChild(texto);
        item.appendChild(remover);

        pendingCuts.appendChild(item);
    });
}

// ======================================================
// IA LOCAL - ENCONTRAR MELHORES MOMENTOS
// ======================================================

async function analisarComIA() {
    atualizarProcessamento(
        "Analisando com IA...",
        "Transcrevendo e procurando os melhores momentos."
    );

    atualizarProgresso(8);

    const formData = new FormData();

    formData.append(
        "video",
        selectedFile,
        selectedFile.name
    );

    const resposta = await fetch(
        `${API_BASE}/analisar-video`,
        {
            method: "POST",
            body: formData
        }
    );

    let dados;

    try {
        dados = await resposta.json();
    } catch {
        throw new Error(
            "O servidor não retornou uma resposta válida."
        );
    }

    if (!resposta.ok) {
        throw new Error(
            dados.erro ||
            dados.error ||
            "Erro durante a análise do vídeo."
        );
    }

    const cortesRecebidos =
        dados.cortes ||
        dados.cuts ||
        [];

    if (!Array.isArray(cortesRecebidos)) {
        throw new Error(
            "A IA não retornou uma lista de cortes."
        );
    }

    const novosCortes =
        cortesRecebidos
            .map((corte, index) => {
                const start = Number(
                    corte.start ??
                    corte.inicio ??
                    corte.startTime
                );

                const end = Number(
                    corte.end ??
                    corte.fim ??
                    corte.endTime
                );

                return {
                    start,
                    end,
                    titulo:
                        corte.titulo ||
                        corte.title ||
                        `Momento ${index + 1}`,
                    motivo:
                        corte.motivo ||
                        corte.reason ||
                        ""
                };
            })
            .filter((corte) => {
                return (
                    Number.isFinite(corte.start) &&
                    Number.isFinite(corte.end) &&
                    corte.end > corte.start
                );
            });

    if (novosCortes.length === 0) {
        throw new Error(
            "A IA não encontrou cortes válidos neste vídeo."
        );
    }

    cortes = novosCortes;

    mostrarCortesPendentes();

    return cortes;
}

// ======================================================
// CARREGAR FFMPEG
// ======================================================

async function carregarFFmpeg() {
    if (ffmpegLoaded) {
        return;
    }

    atualizarProcessamento(
        "Carregando processador...",
        "Na primeira vez isso pode levar alguns segundos."
    );

    const baseURL =
        "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

    const coreURL =
        await toBlobURL(
            `${baseURL}/ffmpeg-core.js`,
            "text/javascript"
        );

    const wasmURL =
        await toBlobURL(
            `${baseURL}/ffmpeg-core.wasm`,
            "application/wasm"
        );

    await ffmpeg.load({
        coreURL,
        wasmURL
    });

    ffmpegLoaded = true;
}

// ======================================================
// GERAR
// ======================================================

generateButton?.addEventListener("click", async () => {
    if (!selectedFile) {
        alert("Selecione um vídeo primeiro.");
        return;
    }

    generateButton.disabled = true;

    mostrar(processingArea);
    esconder(resultsArea);

    limparResultados();

    atualizarProgresso(3);

    try {
        // Se o usuário não criou cortes manualmente,
        // a IA escolhe automaticamente.
        if (cortes.length === 0) {
            await analisarComIA();
        }

        await carregarFFmpeg();

        atualizarProcessamento(
            "Preparando vídeo...",
            "Carregando o vídeo para criar os cortes."
        );

        atualizarProgresso(18);

        try {
            await ffmpeg.deleteFile("entrada.mp4");
        } catch {
            // arquivo ainda não existe
        }

        await ffmpeg.writeFile(
            "entrada.mp4",
            await fetchFile(selectedFile)
        );

        if (clipsGrid) {
            clipsGrid.innerHTML = "";
        }

        for (
            let i = 0;
            i < cortes.length;
            i++
        ) {
            const corte = cortes[i];

            const duracao =
                corte.end -
                corte.start;

            atualizarProcessamento(
                `Criando clipe ${i + 1} de ${cortes.length}`,
                "Convertendo para vídeo vertical 9:16..."
            );

            const porcentagem =
                22 +
                ((i / cortes.length) * 72);

            atualizarProgresso(porcentagem);

            const nome =
                `clip-${i + 1}.mp4`;

            try {
                await ffmpeg.deleteFile(nome);
            } catch {
                // ainda não existe
            }

            await ffmpeg.exec([
                "-ss",
                String(corte.start),

                "-i",
                "entrada.mp4",

                "-t",
                String(duracao),

                "-vf",
                "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280",

                "-c:v",
                "libx264",

                "-preset",
                "ultrafast",

                "-crf",
                "26",

                "-c:a",
                "aac",

                "-b:a",
                "128k",

                "-movflags",
                "+faststart",

                nome
            ]);

            const data =
                await ffmpeg.readFile(nome);

            const blob =
                new Blob(
                    [data.buffer],
                    {
                        type: "video/mp4"
                    }
                );

            const url =
                URL.createObjectURL(blob);

            clipURLs.push(url);

            criarCardClip(
                url,
                corte,
                i
            );

            try {
                await ffmpeg.deleteFile(nome);
            } catch {
                // nada
            }
        }

        atualizarProgresso(100);

        atualizarProcessamento(
            "Tudo pronto!",
            "Seus clipes foram gerados."
        );

        await esperar(500);

        esconder(processingArea);
        mostrar(resultsArea);

        if (resultsCount) {
            resultsCount.innerText =
                `${cortes.length} ` +
                (
                    cortes.length === 1
                        ? "clipe gerado."
                        : "clipes gerados."
                );
        }

        resultsArea?.scrollIntoView({
            behavior: "smooth"
        });

    } catch (erro) {
        console.error(erro);

        esconder(processingArea);

        alert(
            "Erro ao gerar os clipes:\n\n" +
            (erro.message || "Erro desconhecido.")
        );

    } finally {
        generateButton.disabled = false;
    }
});

// ======================================================
// CARD DO CLIPE
// ======================================================

function criarCardClip(
    url,
    corte,
    index
) {
    if (!clipsGrid) {
        return;
    }

    const card =
        document.createElement("article");

    card.className =
        "clip-card";

    const videoWrapper =
        document.createElement("div");

    videoWrapper.className =
        "clip-video-wrapper";

    const video =
        document.createElement("video");

    video.className =
        "clip-video";

    video.src = url;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;

    videoWrapper.appendChild(video);

    const content =
        document.createElement("div");

    content.className =
        "clip-content";

    const titulo =
        document.createElement("div");

    titulo.className =
        "clip-title";

    titulo.innerText =
        corte.titulo ||
        `Clipe ${String(index + 1).padStart(2, "0")}`;

    const tempo =
        document.createElement("div");

    tempo.className =
        "clip-time";

    tempo.innerText =
        `${formatarTempo(corte.start)} → ` +
        `${formatarTempo(corte.end)} • ` +
        formatarDuracao(
            corte.end -
            corte.start
        );

    const download =
        document.createElement("a");

    download.className =
        "download-button";

    download.href = url;

    download.download =
        `clip-ai-${index + 1}.mp4`;

    download.innerText =
        "⬇ Baixar clipe";

    content.appendChild(titulo);
    content.appendChild(tempo);
    content.appendChild(download);

    card.appendChild(videoWrapper);
    card.appendChild(content);

    clipsGrid.appendChild(card);
}