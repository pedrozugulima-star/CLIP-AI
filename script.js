import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";


// ======================================================
// ELEMENTOS
// ======================================================

const videoInput = document.getElementById("videoInput");
const selectButton = document.getElementById("selectButton");

const videoLink = document.getElementById("videoLink");
const linkButton = document.getElementById("linkButton");

const selectedFileBox = document.getElementById("selectedFileBox");
const selectedFileName = document.getElementById("selectedFileName");
const selectedFileSize = document.getElementById("selectedFileSize");

const previewArea = document.getElementById("previewArea");
const videoPreview = document.getElementById("videoPreview");

const manualArea = document.getElementById("manualArea");

const startTime = document.getElementById("startTime");
const endTime = document.getElementById("endTime");

const markStartButton = document.getElementById("markStartButton");
const markEndButton = document.getElementById("markEndButton");
const addCutButton = document.getElementById("addCutButton");

const cutsList = document.getElementById("cutsList");

const generateButton = document.getElementById("generateButton");

const processingArea = document.getElementById("processingArea");

const resultsArea = document.getElementById("resultsArea");
const clipsGrid = document.getElementById("clipsGrid");


// ======================================================
// VARIÁVEIS
// ======================================================

let selectedFile = null;
let videoURL = null;

let ffmpegLoaded = false;

let cortes = [];
let clipURLs = [];

let youtubeVideoId = null;

const ffmpeg = new FFmpeg();


// ======================================================
// SELECIONAR VÍDEO
// ======================================================

selectButton.addEventListener("click", () => {

    videoInput.click();

});


videoInput.addEventListener("change", () => {

    const file = videoInput.files[0];

    if (!file) {
        return;
    }

    prepararVideo(file);

});


// ======================================================
// PREPARAR VÍDEO
// ======================================================

function prepararVideo(file) {

    selectedFile = file;

    youtubeVideoId = null;

    cortes = [];

    limparResultados();

    mostrarCortesPendentes();


    if (videoURL) {

        URL.revokeObjectURL(videoURL);

    }


    videoURL = URL.createObjectURL(file);


    selectedFileBox.classList.remove("hidden");

    selectedFileName.innerText = file.name;

    selectedFileSize.innerText =
        formatarTamanho(file.size);


    previewArea.classList.remove("hidden");

    manualArea.classList.remove("hidden");


    videoPreview.src = videoURL;

    videoPreview.load();


    generateButton.disabled = true;


    videoPreview.onloadedmetadata = () => {

        startTime.value = 0;

        endTime.value = Math.min(
            30,
            Math.floor(videoPreview.duration)
        );

        generateButton.disabled = false;

    };

}


// ======================================================
// LINK
// ======================================================

linkButton.addEventListener("click", async () => {

    const link = videoLink.value.trim();


    if (!link) {

        alert("Cole um link primeiro.");

        return;

    }


    linkButton.disabled = true;

    linkButton.innerText = "Verificando...";


    try {

        const resposta = await fetch(
            "http://localhost:3000/video-link",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    url: link
                })
            }
        );


        const contentType =
            resposta.headers.get("content-type") || "";


        // ==================================================
        // RESPOSTA JSON
        // ==================================================

        if (
            contentType.includes("application/json")
        ) {

            const dados =
                await resposta.json();


            // YOUTUBE
            if (dados.tipo === "youtube") {

                youtubeVideoId =
                    dados.videoId;


                selectedFile = null;


                selectedFileBox.classList.remove(
                    "hidden"
                );


                selectedFileName.innerText =
                    "YouTube detectado ✓";


                selectedFileSize.innerText =
                    "ID do vídeo: " +
                    youtubeVideoId;


                previewArea.classList.add(
                    "hidden"
                );


                manualArea.classList.add(
                    "hidden"
                );


                generateButton.disabled = true;


                alert(
                    "YouTube detectado com sucesso!\n\n" +
                    "ID do vídeo: " +
                    youtubeVideoId
                );


                return;

            }


            throw new Error(
                dados.erro ||
                "Erro ao processar o link."
            );

        }


        // ==================================================
        // VÍDEO DIRETO
        // ==================================================

        if (!resposta.ok) {

            throw new Error(
                "Não foi possível carregar esse vídeo."
            );

        }


        const blob =
            await resposta.blob();


        let extensao = "mp4";


        if (
            blob.type.includes("webm")
        ) {

            extensao = "webm";

        }


        if (
            blob.type.includes("quicktime")
        ) {

            extensao = "mov";

        }


        const arquivo =
            new File(
                [blob],
                `video-link.${extensao}`,
                {
                    type: blob.type
                }
            );


        prepararVideo(arquivo);


    } catch (erro) {

        console.error(erro);


        alert(
            "Erro ao processar o link.\n\n" +
            (
                erro.message ||
                "Erro desconhecido."
            )
        );


    } finally {

        linkButton.disabled = false;

        linkButton.innerText =
            "Usar link";

    }

});


// ======================================================
// MARCAR INÍCIO
// ======================================================

markStartButton.addEventListener(
    "click",
    () => {

        startTime.value =
            videoPreview.currentTime.toFixed(1);

    }
);


// ======================================================
// MARCAR FINAL
// ======================================================

markEndButton.addEventListener(
    "click",
    () => {

        endTime.value =
            videoPreview.currentTime.toFixed(1);

    }
);


// ======================================================
// ADICIONAR CORTE MANUAL
// ======================================================

addCutButton.addEventListener(
    "click",
    () => {

        const inicio =
            Number(startTime.value);

        const fim =
            Number(endTime.value);


        if (fim <= inicio) {

            alert(
                "O final precisa ser maior que o início."
            );

            return;

        }


        cortes.push({

            inicio,

            fim,

            duracao:
                fim - inicio,

            titulo:
                `Corte manual ${cortes.length + 1}`,

            score:
                null

        });


        mostrarCortesPendentes();

    }
);


// ======================================================
// MOSTRAR CORTES
// ======================================================

function mostrarCortesPendentes() {

    cutsList.innerHTML = "";


    if (cortes.length === 0) {

        cutsList.innerHTML = `
            <div style="opacity:.7;">
                A IA ainda não escolheu os cortes.
            </div>
        `;

        return;

    }


    cortes.forEach(
        (corte, index) => {

            const item =
                document.createElement("div");


            item.className =
                "pending-cut";


            const score =
                corte.score !== null &&
                corte.score !== undefined

                    ? `
                        <div>
                            🔥 Score ${corte.score}
                        </div>
                      `

                    : "";


            item.innerHTML = `

                <div>

                    <strong>
                        ${escaparHTML(
                            corte.titulo ||
                            `Clipe ${index + 1}`
                        )}
                    </strong>

                    <div>

                        ${formatarTempo(
                            corte.inicio
                        )}

                        →

                        ${formatarTempo(
                            corte.fim
                        )}

                    </div>

                    ${score}

                </div>


                <button
                    type="button"
                    class="remove-cut"
                    data-index="${index}"
                >
                    ×
                </button>

            `;


            cutsList.appendChild(item);

        }
    );


    cutsList
        .querySelectorAll(".remove-cut")
        .forEach(botao => {

            botao.addEventListener(
                "click",
                () => {

                    cortes.splice(
                        Number(
                            botao.dataset.index
                        ),
                        1
                    );

                    mostrarCortesPendentes();

                }
            );

        });

}


// ======================================================
// GERAR COM IA
// ======================================================

generateButton.addEventListener(
    "click",
    async () => {

        if (!selectedFile) {

            alert(
                "Selecione um vídeo primeiro."
            );

            return;

        }


        try {

            generateButton.disabled = true;

            generateButton.innerText =
                "🧠 IA analisando...";


            mostrarProcessamento(`
                <strong>
                    🧠 Clip AI analisando o vídeo
                </strong>

                <br><br>

                Transcrevendo o conteúdo com IA local...

                <br>

                Procurando os melhores momentos...
            `);


            // ==================================================
            // ENVIAR PARA O BACKEND
            // ==================================================

            const formData =
                new FormData();


            formData.append(
                "video",
                selectedFile,
                selectedFile.name
            );


            const resposta =
                await fetch(
                    "http://localhost:3000/analisar-video",
                    {
                        method: "POST",
                        body: formData
                    }
                );


            const dados =
                await resposta.json();


            if (!resposta.ok) {

                throw new Error(
                    dados.erro ||
                    "Erro durante análise."
                );

            }


            if (
                !dados.cortes ||
                dados.cortes.length === 0
            ) {

                throw new Error(
                    "Nenhum corte foi encontrado."
                );

            }


            // ==================================================
            // RECEBER CORTES
            // ==================================================

            cortes =
                dados.cortes.map(
                    corte => ({

                        inicio:
                            Number(corte.inicio),

                        fim:
                            Number(corte.fim),

                        duracao:
                            Number(corte.duracao),

                        titulo:
                            corte.titulo,

                        score:
                            corte.score,

                        motivo:
                            corte.motivo

                    })
                );


            mostrarCortesPendentes();


            mostrarProcessamento(`
                <strong>
                    ✂️ ${cortes.length} momentos encontrados!
                </strong>

                <br><br>

                Criando os clipes em formato vertical 9:16...
            `);


            // ==================================================
            // GERAR OS VÍDEOS
            // ==================================================

            await gerarTodosOsClipes();


        } catch (erro) {

            console.error(erro);


            esconderProcessamento();


            alert(
                "Não foi possível gerar os clipes.\n\n" +
                (
                    erro.message ||
                    "Erro desconhecido."
                )
            );


        } finally {

            generateButton.disabled = false;

            generateButton.innerText =
                "✨ Gerar clipes com IA";

        }

    }
);


// ======================================================
// CARREGAR FFMPEG
// ======================================================

async function carregarFFmpeg() {

    if (ffmpegLoaded) {
        return;
    }


    mostrarProcessamento(`
        <strong>
            ⚙️ Preparando editor de vídeo...
        </strong>

        <br><br>

        Aguarde alguns segundos.
    `);


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
// GERAR TODOS OS CLIPES
// ======================================================

async function gerarTodosOsClipes() {

    await carregarFFmpeg();


    limparResultados();


    resultsArea.classList.remove(
        "hidden"
    );


    mostrarProcessamento(`
        <strong>
            ⚙️ Preparando vídeo...
        </strong>
    `);


    await ffmpeg.writeFile(
        "entrada.mp4",
        await fetchFile(selectedFile)
    );


    for (
        let i = 0;
        i < cortes.length;
        i++
    ) {

        const corte =
            cortes[i];


        const numero =
            i + 1;


        mostrarProcessamento(`
            <strong>
                ✂️ Criando clipe ${numero} de ${cortes.length}
            </strong>

            <br><br>

            ${escaparHTML(
                corte.titulo || ""
            )}

            <br><br>

            Convertendo para vertical 9:16...
        `);


        const nomeSaida =
            `clip-${numero}.mp4`;


        const duracao =
            corte.fim -
            corte.inicio;


        // ==================================================
        // CORTE + CONVERSÃO VERTICAL 9:16
        //
        // 720 x 1280
        //
        // O vídeo é ampliado e o centro é recortado.
        // ==================================================

        await ffmpeg.exec([

            "-ss",
            String(corte.inicio),

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

            nomeSaida

        ]);


        // ==================================================
        // LER O ARQUIVO GERADO
        // ==================================================

        const dados =
            await ffmpeg.readFile(
                nomeSaida
            );


        const blob =
            new Blob(
                [dados.buffer],
                {
                    type:
                        "video/mp4"
                }
            );


        const url =
            URL.createObjectURL(
                blob
            );


        clipURLs.push(url);


        // ==================================================
        // CRIAR CARD
        // ==================================================

        criarCardClipe(
            corte,
            url,
            numero
        );


        // ==================================================
        // APAGAR TEMPORÁRIO DO FFMPEG
        // ==================================================

        try {

            await ffmpeg.deleteFile(
                nomeSaida
            );

        } catch {

            // Não faz nada
        }

    }


    // ==================================================
    // FINALIZOU
    // ==================================================

    esconderProcessamento();


    resultsArea.scrollIntoView({
        behavior: "smooth"
    });


    alert(
        `🎉 Pronto!\n\n${cortes.length} clipes foram criados.`
    );

}


// ======================================================
// CRIAR CARD DO CLIPE
// ======================================================

function criarCardClipe(
    corte,
    url,
    numero
) {

    const card =
        document.createElement("div");


    card.className =
        "clip-card";


    const score =
        corte.score !== null &&
        corte.score !== undefined

            ? `
                <div class="clip-score">
                    🔥 Score ${corte.score}
                </div>
              `

            : "";


    card.innerHTML = `

        <div class="clip-video-wrapper">

            <video
                class="clip-video"
                src="${url}"
                controls
                preload="metadata"
            ></video>

        </div>


        <div class="clip-content">

            ${score}


            <h3>

                ${escaparHTML(
                    corte.titulo ||
                    `Clipe ${numero}`
                )}

            </h3>


            <p>

                ${formatarTempo(
                    corte.inicio
                )}

                →

                ${formatarTempo(
                    corte.fim
                )}

            </p>


            <p>

                Duração:

                ${formatarDuracao(
                    corte.fim -
                    corte.inicio
                )}

            </p>


            <a
                href="${url}"
                download="clip-ai-${numero}.mp4"
                class="download-button"
            >
                ⬇ Baixar clipe
            </a>

        </div>

    `;


    clipsGrid.appendChild(card);

}


// ======================================================
// PROCESSAMENTO
// ======================================================

function mostrarProcessamento(texto) {

    processingArea.classList.remove(
        "hidden"
    );


    processingArea.innerHTML =
        texto;

}


function esconderProcessamento() {

    processingArea.classList.add(
        "hidden"
    );

}


// ======================================================
// LIMPAR RESULTADOS
// ======================================================

function limparResultados() {

    clipURLs.forEach(url => {

        URL.revokeObjectURL(url);

    });


    clipURLs = [];


    clipsGrid.innerHTML = "";


    resultsArea.classList.add(
        "hidden"
    );

}


// ======================================================
// FORMATAR TAMANHO
// ======================================================

function formatarTamanho(bytes) {

    if (
        bytes <
        1024 * 1024
    ) {

        return (
            (bytes / 1024)
                .toFixed(1)
            +
            " KB"
        );

    }


    return (
        (
            bytes /
            1024 /
            1024
        ).toFixed(2)
        +
        " MB"
    );

}


// ======================================================
// FORMATAR TEMPO
// ======================================================

function formatarTempo(segundos) {

    segundos =
        Math.max(
            0,
            Number(segundos)
        );


    const minutos =
        Math.floor(
            segundos / 60
        );


    const resto =
        Math.floor(
            segundos % 60
        );


    return (
        String(minutos)
            .padStart(2, "0")
        +
        ":"
        +
        String(resto)
            .padStart(2, "0")
    );

}


// ======================================================
// FORMATAR DURAÇÃO
// ======================================================

function formatarDuracao(segundos) {

    const total =
        Math.round(segundos);


    if (total < 60) {

        return (
            total +
            " segundos"
        );

    }


    const minutos =
        Math.floor(
            total / 60
        );


    const resto =
        total % 60;


    return (
        `${minutos} min ${resto}s`
    );

}


// ======================================================
// EVITAR HTML NO TÍTULO
// ======================================================

function escaparHTML(texto) {

    const div =
        document.createElement("div");


    div.textContent =
        texto || "";


    return div.innerHTML;

}


// ======================================================
// INICIALIZAÇÃO
// ======================================================

generateButton.innerText =
    "✨ Gerar clipes com IA";


mostrarCortesPendentes();