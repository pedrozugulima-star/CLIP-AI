// ======================================================
// SERVIDOR
// ======================================================

const API_BASE =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
        ? "http://localhost:3000"
        : "";


// ======================================================
// ELEMENTOS
// ======================================================

const videoInput =
    document.getElementById("videoInput");

const selectButton =
    document.getElementById("selectButton");

const videoPreview =
    document.getElementById("videoPreview");

const videoLink =
    document.getElementById("videoLink");

const linkButton =
    document.getElementById("linkButton");

const youtubeProgressArea =
    document.getElementById("youtubeProgressArea");

const youtubeProgressTitle =
    document.getElementById("youtubeProgressTitle");

const youtubeProgressText =
    document.getElementById("youtubeProgressText");

const youtubeProgressBar =
    document.getElementById("youtubeProgressBar");

const selectedFileBox =
    document.getElementById("selectedFileBox");

const selectedFileName =
    document.getElementById("selectedFileName");

const selectedFileSize =
    document.getElementById("selectedFileSize");

const previewArea =
    document.getElementById("previewArea");

const manualArea =
    document.getElementById("manualArea");

const startTime =
    document.getElementById("startTime");

const endTime =
    document.getElementById("endTime");

const markStartButton =
    document.getElementById("markStartButton");

const markEndButton =
    document.getElementById("markEndButton");

const addCutButton =
    document.getElementById("addCutButton");

const pendingCuts =
    document.getElementById("pendingCuts") ||
    document.getElementById("cutsList");

const generateButton =
    document.getElementById("generateButton");

const processingArea =
    document.getElementById("processingArea");

const processingTitle =
    document.getElementById("processingTitle");

const processingText =
    document.getElementById("processingText");

const progressBar =
    document.getElementById("progressBar");

const resultsArea =
    document.getElementById("resultsArea");

const resultsCount =
    document.getElementById("resultsCount");

const clipsGrid =
    document.getElementById("clipsGrid");


// ======================================================
// ESTADO
// ======================================================

let selectedFile = null;

let videoURL = null;

let cortes = [];

let segmentosIA = [];

let monitorProgresso = null;


// ======================================================
// AUXILIARES
// ======================================================

function mostrar(elemento) {

    elemento?.classList.remove(
        "hidden"
    );

}


function esconder(elemento) {

    elemento?.classList.add(
        "hidden"
    );

}


function atualizarProgresso(
    valor
) {

    if (!progressBar) {
        return;
    }

    const numero =
        Math.max(
            0,
            Math.min(
                100,
                Number(valor) || 0
            )
        );

    progressBar.style.width =
        `${numero}%`;

}


function atualizarProcessamento(
    titulo,
    texto = ""
) {

    if (processingTitle) {

        processingTitle.innerText =
            titulo;

    }

    if (processingText) {

        processingText.innerText =
            texto;

    }

}


function formatarTempo(
    segundos
) {

    segundos =
        Math.max(
            0,
            Number(segundos) || 0
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
        String(minutos).padStart(
            2,
            "0"
        ) +
        ":" +
        String(resto).padStart(
            2,
            "0"
        )
    );

}


function formatarDuracao(
    segundos
) {

    segundos =
        Math.max(
            0,
            Number(segundos) || 0
        );

    if (
        segundos < 60
    ) {

        return (
            `${Math.round(segundos)}s`
        );

    }

    const minutos =
        Math.floor(
            segundos / 60
        );

    const resto =
        Math.round(
            segundos % 60
        );

    return (
        `${minutos}m ${resto}s`
    );

}


function esperar(
    ms
) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );

}


// ======================================================
// JOB ID
// ======================================================

function criarJobId() {

    if (
        window.crypto &&
        typeof window.crypto.randomUUID ===
        "function"
    ) {

        return window.crypto.randomUUID();

    }

    return (
        `job-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`
    );

}


// ======================================================
// MONITOR DE PROGRESSO
// ======================================================

function pararMonitorProgresso() {

    if (
        monitorProgresso
    ) {

        clearInterval(
            monitorProgresso
        );

        monitorProgresso =
            null;

    }

}


function iniciarMonitorProgresso(
    jobId,
    configuracao = {}
) {

    pararMonitorProgresso();

    const minimo =
        Number(
            configuracao.minimo ?? 5
        );

    const maximo =
        Number(
            configuracao.maximo ?? 55
        );

    const titulo =
        configuracao.titulo ||
        "Processando...";


    const consultar =
        async () => {

            try {

                const resposta =
                    await fetch(

                        `${API_BASE}/progresso/${encodeURIComponent(
                            jobId
                        )}`

                    );


                if (
                    !resposta.ok
                ) {

                    return;

                }


                const dados =
                    await resposta.json();


                if (
                    dados.erro
                ) {

                    atualizarProcessamento(

                        "Erro no processamento",

                        dados.erro

                    );

                    return;

                }


                const porcentagemServidor =
                    Math.max(
                        0,
                        Math.min(
                            100,
                            Number(
                                dados.porcentagem
                            ) || 0
                        )
                    );


                const intervalo =
                    maximo -
                    minimo;


                const porcentagemTela =
                    minimo +
                    (
                        porcentagemServidor /
                        100
                    ) *
                    intervalo;


                atualizarProgresso(
                    porcentagemTela
                );


                atualizarProcessamento(

                    titulo,

                    dados.etapa ||
                    "Processando vídeo..."

                );


            } catch (
                erro
            ) {

                console.log(
                    "Aguardando progresso...",
                    erro.message
                );

            }

        };


    consultar();


    monitorProgresso =
        setInterval(
            consultar,
            1000
        );

}


// ======================================================
// LIMPAR RESULTADOS
// ======================================================

function limparResultados() {

    if (
        clipsGrid
    ) {

        clipsGrid.innerHTML =
            "";

    }

    esconder(
        resultsArea
    );

}


// ======================================================
// PREPARAR VÍDEO
// ======================================================

function prepararVideo(
    file
) {

    selectedFile =
        file;

    cortes =
        [];

    segmentosIA =
        [];

    limparResultados();

    atualizarProgresso(
        0
    );


    if (
        videoURL
    ) {

        URL.revokeObjectURL(
            videoURL
        );

    }


    videoURL =
        URL.createObjectURL(
            file
        );


    if (
        selectedFileName
    ) {

        selectedFileName.innerText =
            file.name;

    }


    if (
        selectedFileSize
    ) {

        const mb =
            file.size /
            1024 /
            1024;

        selectedFileSize.innerText =
            `${mb.toFixed(1)} MB`;

    }


    mostrar(
        selectedFileBox
    );

    mostrar(
        previewArea
    );

    mostrar(
        manualArea
    );


    if (
        videoPreview
    ) {

        videoPreview.src =
            videoURL;

        videoPreview.load();


        videoPreview.onloadedmetadata =
            () => {

                const duracao =
                    videoPreview.duration;


                if (
                    startTime
                ) {

                    startTime.value =
                        0;

                }


                if (
                    endTime
                ) {

                    endTime.value =
                        Math.min(
                            30,
                            duracao
                        ).toFixed(1);

                }


                if (
                    generateButton
                ) {

                    generateButton.disabled =
                        false;

                }

            };

    }


    mostrarCortesPendentes();

}


// ======================================================
// SELECIONAR VÍDEO
// ======================================================

selectButton?.addEventListener(
    "click",
    () => {

        videoInput?.click();

    }
);


videoInput?.addEventListener(
    "change",
    () => {

        const file =
            videoInput.files?.[0];

        if (
            !file
        ) {

            return;

        }

        prepararVideo(
            file
        );

    }
);


// ======================================================
// LINK
// ======================================================

linkButton?.addEventListener(
    "click",
    async () => {

        const link =
            videoLink?.value.trim();


        if (
            !link
        ) {

            alert(
                "Cole um link primeiro."
            );

            return;

        }


        linkButton.disabled =
            true;

        linkButton.innerText =
            "Carregando...";


        mostrar(
            youtubeProgressArea
        );

        youtubeProgressTitle.innerText =
            "Preparando vídeo do YouTube";

        youtubeProgressText.innerText =
            "Conectando com a ponte de download...";

        youtubeProgressBar.style.width =
            "2%";

        const downloadId =
            window.crypto?.randomUUID?.() ||
            `youtube-${Date.now()}-${Math.random()}`;

        const intervaloYoutube =
            setInterval(
                async () => {
                    try {
                        const respostaProgresso =
                            await fetch(
                                `${API_BASE}/video-link/progresso/${downloadId}`
                            );

                        if (!respostaProgresso.ok) {
                            return;
                        }

                        const dadosProgresso =
                            await respostaProgresso.json();

                        const valor =
                            Math.max(
                                2,
                                Math.min(
                                    100,
                                    Number(dadosProgresso.progresso) || 2
                                )
                            );

                        youtubeProgressBar.style.width =
                            `${valor}%`;

                        youtubeProgressText.innerText =
                            dadosProgresso.etapa ||
                            "Preparando vídeo...";

                    } catch {
                        // Uma falha momentânea na consulta não interrompe o download.
                    }
                },
                2000
            );


        try {

            const resposta =
                await fetch(
                    `${API_BASE}/video-link`,
                    {

                        method:
                            "POST",

                        headers: {

                            "Content-Type":
                                "application/json"

                        },

                        body:
                            JSON.stringify({

                                url:
                                    link,

                                downloadId

                            })

                    }
                );


            const contentType =
                resposta.headers.get(
                    "content-type"
                ) || "";


            if (
                contentType.includes(
                    "application/json"
                )
            ) {

                const dados =
                    await resposta.json();


                if (
                    !resposta.ok
                ) {

                    if (
                        dados.tipo ===
                        "youtube"
                    ) {

                        alert(
                            dados.mensagem ||
                            "YouTube detectado."
                        );

                        return;

                    }


                    throw new Error(

                        dados.erro ||

                        dados.error ||

                        dados.mensagem ||

                        "Não foi possível processar o link."

                    );

                }


                throw new Error(

                    dados.mensagem ||

                    "O link não retornou um vídeo."

                );

            }


            if (
                !resposta.ok
            ) {

                throw new Error(
                    "Não foi possível carregar esse vídeo."
                );

            }


            const blob =
                await resposta.blob();


            if (
                !blob.type.startsWith(
                    "video/"
                )
            ) {

                throw new Error(
                    "O link não retornou um arquivo de vídeo."
                );

            }


            let extensao =
                "mp4";


            if (
                blob.type.includes(
                    "webm"
                )
            ) {

                extensao =
                    "webm";

            }


            if (
                blob.type.includes(
                    "quicktime"
                )
            ) {

                extensao =
                    "mov";

            }


            const file =
                new File(

                    [blob],

                    `video-link.${extensao}`,

                    {

                        type:
                            blob.type

                    }

                );


            prepararVideo(
                file
            );


            clearInterval(
                intervaloYoutube
            );

            youtubeProgressBar.style.width =
                "100%";

            youtubeProgressTitle.innerText =
                "Vídeo recebido!";

            youtubeProgressText.innerText =
                "O vídeo está pronto para gerar os cortes.";

            await esperar(
                700
            );

            esconder(
                youtubeProgressArea
            );


            alert(
                "Vídeo carregado pelo link!"
            );


        } catch (
            erro
        ) {

            console.error(
                erro
            );


            alert(

                "Não foi possível carregar o vídeo.\n\n" +

                (
                    erro.message ||
                    "Erro desconhecido."
                )

            );


        } finally {

            clearInterval(
                intervaloYoutube
            );

            esconder(
                youtubeProgressArea
            );

            youtubeProgressBar.style.width =
                "0%";

            linkButton.disabled =
                false;

            linkButton.innerText =
                "Usar link";

        }

    }
);


// ======================================================
// CORTE MANUAL
// ======================================================

markStartButton?.addEventListener(
    "click",
    () => {

        if (
            !selectedFile ||
            !videoPreview
        ) {

            return;

        }


        startTime.value =
            videoPreview.currentTime.toFixed(
                1
            );

    }
);


markEndButton?.addEventListener(
    "click",
    () => {

        if (
            !selectedFile ||
            !videoPreview
        ) {

            return;

        }


        endTime.value =
            videoPreview.currentTime.toFixed(
                1
            );

    }
);


addCutButton?.addEventListener(
    "click",
    () => {

        if (
            !selectedFile
        ) {

            alert(
                "Selecione um vídeo."
            );

            return;

        }


        const start =
            Number(
                startTime?.value
            );


        const end =
            Number(
                endTime?.value
            );


        if (
            !Number.isFinite(
                start
            ) ||
            !Number.isFinite(
                end
            ) ||
            start < 0 ||
            end <= start
        ) {

            alert(
                "Confira o início e o fim do corte."
            );

            return;

        }


        if (
            Number.isFinite(
                videoPreview?.duration
            ) &&
            end >
            videoPreview.duration
        ) {

            alert(
                "O corte ultrapassa a duração do vídeo."
            );

            return;

        }


        cortes.push({

            start,

            end,

            titulo:
                `Corte ${cortes.length + 1}`

        });


        mostrarCortesPendentes();

    }
);


// ======================================================
// MOSTRAR CORTES
// ======================================================

function mostrarCortesPendentes() {

    if (
        !pendingCuts
    ) {

        return;

    }


    pendingCuts.innerHTML =
        "";


    cortes.forEach(
        (
            corte,
            index
        ) => {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "pending-cut";


            const texto =
                document.createElement(
                    "span"
                );


            texto.innerText =
                `${corte.titulo || `Corte ${index + 1}`} • ` +
                `${formatarTempo(corte.start)} → ` +
                `${formatarTempo(corte.end)}`;


            const remover =
                document.createElement(
                    "button"
                );


            remover.type =
                "button";


            remover.innerText =
                "Remover";


            remover.addEventListener(
                "click",
                () => {

                    cortes.splice(
                        index,
                        1
                    );

                    mostrarCortesPendentes();

                }
            );


            item.appendChild(
                texto
            );


            item.appendChild(
                remover
            );


            pendingCuts.appendChild(
                item
            );

        }
    );

}


// ======================================================
// ANÁLISE COM IA
// ======================================================

async function analisarComIA() {

    atualizarProcessamento(

        "Analisando com IA...",

        "Enviando o vídeo para análise."

    );


    atualizarProgresso(
        5
    );


    const jobId =
        criarJobId();


    iniciarMonitorProgresso(

        jobId,

        {

            minimo:
                5,

            maximo:
                55,

            titulo:
                "Analisando com IA..."

        }

    );


    const formData =
        new FormData();


    formData.append(

        "video",

        selectedFile,

        selectedFile.name

    );


    formData.append(
        "jobId",
        jobId
    );


    try {

        const resposta =
            await fetch(
                `${API_BASE}/analisar-video`,
                {

                    method:
                        "POST",

                    body:
                        formData

                }
            );


        let dados;


        try {

            dados =
                await resposta.json();

        } catch {

            throw new Error(
                "O servidor não retornou uma resposta válida."
            );

        }


        if (
            !resposta.ok
        ) {

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


        if (
            !Array.isArray(
                cortesRecebidos
            )
        ) {

            throw new Error(
                "A IA não retornou uma lista de cortes."
            );

        }


        segmentosIA =
            Array.isArray(
                dados.segmentos
            )
                ? dados.segmentos
                : [];


        const novosCortes =
            cortesRecebidos

                .map(
                    (
                        corte,
                        index
                    ) => {

                        const start =
                            Number(

                                corte.start ??

                                corte.inicio ??

                                corte.startTime

                            );


                        const end =
                            Number(

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

                                "",

                            texto:

                                corte.texto ||

                                ""

                        };

                    }
                )

                .filter(
                    corte => {

                        return (

                            Number.isFinite(
                                corte.start
                            ) &&

                            Number.isFinite(
                                corte.end
                            ) &&

                            corte.end >
                            corte.start

                        );

                    }
                );


        if (
            novosCortes.length ===
            0
        ) {

            throw new Error(
                "A IA não encontrou cortes válidos neste vídeo."
            );

        }


        cortes =
            novosCortes;


        mostrarCortesPendentes();


        atualizarProgresso(
            55
        );


        atualizarProcessamento(

            "IA concluída!",

            `${cortes.length} melhores momentos encontrados.`

        );


        return cortes;


    } finally {

        pararMonitorProgresso();

    }

}


// ======================================================
// GERAR NO SERVIDOR
// ======================================================

async function gerarClipesNoServidor() {

    const jobId =
        criarJobId();


    atualizarProcessamento(

        "Criando seus clipes...",

        "Preparando o FFmpeg nativo."

    );


    atualizarProgresso(
        58
    );


    iniciarMonitorProgresso(

        jobId,

        {

            minimo:
                58,

            maximo:
                98,

            titulo:
                "Criando seus clipes..."

        }

    );


    const formData =
        new FormData();


    formData.append(

        "video",

        selectedFile,

        selectedFile.name

    );


    formData.append(
        "jobId",
        jobId
    );


    formData.append(

        "cortes",

        JSON.stringify(
            cortes
        )

    );


    formData.append(

        "segmentos",

        JSON.stringify(
            segmentosIA
        )

    );


    try {

        const resposta =
            await fetch(
                `${API_BASE}/gerar-clipes`,
                {

                    method:
                        "POST",

                    body:
                        formData

                }
            );


        let dados;


        try {

            dados =
                await resposta.json();

        } catch {

            throw new Error(
                "O servidor não retornou uma resposta válida ao gerar os clipes."
            );

        }


        if (
            !resposta.ok
        ) {

            throw new Error(

                dados.erro ||

                dados.error ||

                "Erro ao gerar os clipes."

            );

        }


        if (
            !Array.isArray(
                dados.cortes
            ) ||
            dados.cortes.length ===
            0
        ) {

            throw new Error(
                "O servidor não retornou os vídeos gerados."
            );

        }


        return dados.cortes;


    } finally {

        pararMonitorProgresso();

    }

}


// ======================================================
// BOTÃO GERAR
// ======================================================

generateButton?.addEventListener(
    "click",
    async () => {

        if (
            !selectedFile
        ) {

            alert(
                "Selecione um vídeo primeiro."
            );

            return;

        }


        generateButton.disabled =
            true;


        mostrar(
            processingArea
        );


        esconder(
            resultsArea
        );


        limparResultados();


        atualizarProgresso(
            3
        );


        try {

            /*
                Se não houver cortes manuais,
                a IA escolhe os melhores momentos.
            */

            if (
                cortes.length ===
                0
            ) {

                await analisarComIA();

            }


            /*
                Agora os vídeos são gerados
                pelo FFmpeg nativo do servidor.
            */

            const clipesGerados =
                await gerarClipesNoServidor();


            if (
                clipsGrid
            ) {

                clipsGrid.innerHTML =
                    "";

            }


            clipesGerados.forEach(
                (
                    corte,
                    index
                ) => {

                    const url =

                        `${API_BASE}${corte.url}`;


                    criarCardClip(

                        url,

                        corte,

                        index

                    );

                }
            );


            atualizarProgresso(
                100
            );


            atualizarProcessamento(

                "Tudo pronto!",

                segmentosIA.length > 0

                    ? "Seus clipes foram gerados com legenda."

                    : "Seus clipes foram gerados."

            );


            await esperar(
                700
            );


            esconder(
                processingArea
            );


            mostrar(
                resultsArea
            );


            if (
                resultsCount
            ) {

                resultsCount.innerText =

                    `${clipesGerados.length} ` +

                    (
                        clipesGerados.length ===
                        1

                            ? "clipe gerado."

                            : "clipes gerados."
                    );

            }


            resultsArea?.scrollIntoView({

                behavior:
                    "smooth"

            });


        } catch (
            erro
        ) {

            pararMonitorProgresso();


            console.error(
                erro
            );


            esconder(
                processingArea
            );


            alert(

                "Erro ao gerar os clipes:\n\n" +

                (
                    erro.message ||
                    "Erro desconhecido."
                )

            );


        } finally {

            pararMonitorProgresso();


            generateButton.disabled =
                false;

        }

    }
);


// ======================================================
// CARD DO CLIPE
// ======================================================

function criarCardClip(
    url,
    corte,
    index
) {

    if (
        !clipsGrid
    ) {

        return;

    }


    const card =
        document.createElement(
            "article"
        );


    card.className =
        "clip-card";


    const videoWrapper =
        document.createElement(
            "div"
        );


    videoWrapper.className =
        "clip-video-wrapper";


    const video =
        document.createElement(
            "video"
        );


    video.className =
        "clip-video";


    video.src =
        url;


    video.controls =
        true;


    video.preload =
        "metadata";


    video.playsInline =
        true;


    videoWrapper.appendChild(
        video
    );


    const content =
        document.createElement(
            "div"
        );


    content.className =
        "clip-content";


    const titulo =
        document.createElement(
            "div"
        );


    titulo.className =
        "clip-title";


    titulo.innerText =

        corte.titulo ||

        `Clipe ${String(
            index + 1
        ).padStart(
            2,
            "0"
        )}`;


    const tempo =
        document.createElement(
            "div"
        );


    tempo.className =
        "clip-time";


    const inicio =
        Number(

            corte.start ??

            corte.inicio ??

            0

        );


    const fim =
        Number(

            corte.end ??

            corte.fim ??

            0

        );


    tempo.innerText =

        `${formatarTempo(inicio)} → ` +

        `${formatarTempo(fim)} • ` +

        formatarDuracao(
            fim - inicio
        );


    const download =
        document.createElement(
            "a"
        );


    download.className =
        "download-button";


    download.href =
        url;


    download.download =
        `clip-ai-${index + 1}.mp4`;


    download.innerText =
        "⬇ Baixar clipe";


    content.appendChild(
        titulo
    );


    content.appendChild(
        tempo
    );


    content.appendChild(
        download
    );


    card.appendChild(
        videoWrapper
    );


    card.appendChild(
        content
    );


    clipsGrid.appendChild(
        card
    );

}
