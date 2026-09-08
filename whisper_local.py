import sys
import os
import json
import uuid
import mimetypes
import urllib.request
import urllib.error


# ==========================================================
# CONFIGURAÇÕES
# ==========================================================

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

GROQ_MODEL = os.getenv(
    "GROQ_WHISPER_MODEL",
    "whisper-large-v3-turbo"
)


# ==========================================================
# LOG
# Tudo que for log vai para STDERR.
# O Node recebe somente o JSON pelo STDOUT.
# ==========================================================

def log(*args):
    print(
        *args,
        file=sys.stderr,
        flush=True
    )


# ==========================================================
# RESPOSTA DE ERRO
# ==========================================================

def responder_erro(mensagem):
    resultado = {
        "sucesso": False,
        "erro": str(mensagem)
    }

    print(
        json.dumps(
            resultado,
            ensure_ascii=False
        ),
        flush=True
    )


# ==========================================================
# MULTIPART FORM-DATA
# Sem biblioteca externa.
# Assim não precisamos instalar SDK da Groq.
# ==========================================================

def adicionar_campo(
    partes,
    boundary,
    nome,
    valor
):
    partes.append(
        f"--{boundary}\r\n".encode()
    )

    partes.append(
        (
            f'Content-Disposition: form-data; '
            f'name="{nome}"\r\n\r\n'
        ).encode()
    )

    partes.append(
        str(valor).encode("utf-8")
    )

    partes.append(
        b"\r\n"
    )


def adicionar_arquivo(
    partes,
    boundary,
    caminho
):
    nome_arquivo = os.path.basename(
        caminho
    )

    mime_type = (
        mimetypes.guess_type(
            nome_arquivo
        )[0]
        or
        "application/octet-stream"
    )

    partes.append(
        f"--{boundary}\r\n".encode()
    )

    partes.append(
        (
            f'Content-Disposition: form-data; '
            f'name="file"; '
            f'filename="{nome_arquivo}"\r\n'
        ).encode()
    )

    partes.append(
        (
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode()
    )

    with open(
        caminho,
        "rb"
    ) as arquivo:
        partes.append(
            arquivo.read()
        )

    partes.append(
        b"\r\n"
    )


# ==========================================================
# CHAMAR GROQ
# ==========================================================

def transcrever_com_groq(
    caminho_video
):
    api_key = os.getenv(
        "GROQ_API_KEY"
    )

    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY não foi configurada."
        )

    if not os.path.exists(
        caminho_video
    ):
        raise RuntimeError(
            "Arquivo de vídeo não encontrado."
        )

    tamanho = os.path.getsize(
        caminho_video
    )

    tamanho_mb = tamanho / (
        1024 * 1024
    )

    log(
        "================================"
    )
    log(
        "CLIP AI - GROQ WHISPER"
    )
    log(
        "================================"
    )
    log(
        f"Arquivo: {caminho_video}"
    )
    log(
        f"Tamanho: {tamanho_mb:.2f} MB"
    )
    log(
        f"Modelo: {GROQ_MODEL}"
    )
    log(
        "Enviando para Groq..."
    )

    boundary = (
        "----ClipAI"
        +
        uuid.uuid4().hex
    )

    partes = []

    adicionar_campo(
        partes,
        boundary,
        "model",
        GROQ_MODEL
    )

    adicionar_campo(
        partes,
        boundary,
        "response_format",
        "verbose_json"
    )

    adicionar_campo(
        partes,
        boundary,
        "temperature",
        "0"
    )

    # Português melhora velocidade
    # e precisão no nosso caso.
    adicionar_campo(
        partes,
        boundary,
        "language",
        "pt"
    )

    # Precisamos dos segmentos para
    # encontrar os melhores cortes.
    adicionar_campo(
        partes,
        boundary,
        "timestamp_granularities[]",
        "segment"
    )

    # Precisamos das palavras para
    # gerar as legendas sincronizadas.
    adicionar_campo(
        partes,
        boundary,
        "timestamp_granularities[]",
        "word"
    )

    adicionar_arquivo(
        partes,
        boundary,
        caminho_video
    )

    partes.append(
        f"--{boundary}--\r\n".encode()
    )

    corpo = b"".join(
        partes
    )

    requisicao = urllib.request.Request(
        GROQ_URL,
        data=corpo,
        method="POST"
    )

    requisicao.add_header(
        "Authorization",
        f"Bearer {api_key}"
    )

    requisicao.add_header(
        "Content-Type",
        (
            "multipart/form-data; "
            f"boundary={boundary}"
        )
    )

    requisicao.add_header(
        "Content-Length",
        str(
            len(corpo)
        )
    )

    try:
        with urllib.request.urlopen(
            requisicao,
            timeout=300
        ) as resposta:

            conteudo = (
                resposta
                .read()
                .decode(
                    "utf-8"
                )
            )

    except urllib.error.HTTPError as erro:

        try:
            detalhe = (
                erro
                .read()
                .decode(
                    "utf-8",
                    errors="replace"
                )
            )

        except Exception:
            detalhe = str(
                erro
            )

        raise RuntimeError(
            f"Groq respondeu HTTP {erro.code}: "
            f"{detalhe}"
        )

    except urllib.error.URLError as erro:

        raise RuntimeError(
            "Não foi possível conectar à Groq: "
            f"{erro}"
        )

    try:
        dados = json.loads(
            conteudo
        )

    except json.JSONDecodeError:
        raise RuntimeError(
            "A Groq respondeu em um formato inválido."
        )

    log(
        "Transcrição recebida da Groq."
    )

    return dados


# ==========================================================
# CONVERTER PALAVRAS
# ==========================================================

def converter_palavras(
    palavras_groq
):
    palavras = []

    for item in (
        palavras_groq or []
    ):
        palavra = str(
            item.get(
                "word",
                ""
            )
        ).strip()

        inicio = float(
            item.get(
                "start",
                0
            )
            or 0
        )

        fim = float(
            item.get(
                "end",
                inicio
            )
            or inicio
        )

        if not palavra:
            continue

        palavras.append(
            {
                "palavra": palavra,
                "inicio": inicio,
                "fim": fim,

                # Mantemos também os nomes
                # originais por segurança.
                "word": palavra,
                "start": inicio,
                "end": fim
            }
        )

    return palavras


# ==========================================================
# ENCONTRAR PALAVRAS DE CADA SEGMENTO
# ==========================================================

def palavras_do_segmento(
    todas_palavras,
    inicio_segmento,
    fim_segmento
):
    resultado = []

    for palavra in todas_palavras:

        inicio_palavra = float(
            palavra.get(
                "inicio",
                0
            )
        )

        fim_palavra = float(
            palavra.get(
                "fim",
                inicio_palavra
            )
        )

        # A palavra pertence ao segmento
        # quando existe sobreposição.
        if (
            fim_palavra >=
            inicio_segmento - 0.05
            and
            inicio_palavra <=
            fim_segmento + 0.05
        ):
            resultado.append(
                palavra
            )

    return resultado


# ==========================================================
# CONVERTER SEGMENTOS
# ==========================================================

def converter_segmentos(
    segmentos_groq,
    palavras
):
    segmentos = []

    for indice, item in enumerate(
        segmentos_groq or []
    ):

        inicio = float(
            item.get(
                "start",
                0
            )
            or 0
        )

        fim = float(
            item.get(
                "end",
                inicio
            )
            or inicio
        )

        texto = str(
            item.get(
                "text",
                ""
            )
        ).strip()

        palavras_segmento = (
            palavras_do_segmento(
                palavras,
                inicio,
                fim
            )
        )

        segmentos.append(
            {
                "id": item.get(
                    "id",
                    indice
                ),

                "inicio": inicio,
                "fim": fim,
                "texto": texto,
                "palavras":
                    palavras_segmento,

                # Também deixamos os campos
                # no padrão original.
                "start": inicio,
                "end": fim,
                "text": texto
            }
        )

    return segmentos


# ==========================================================
# SEGMENTO DE EMERGÊNCIA
# Caso a API retorne palavras mas não segmentos.
# ==========================================================

def criar_segmentos_por_palavras(
    palavras,
    texto_completo
):
    if not palavras:
        return []

    segmentos = []

    quantidade = 12

    for i in range(
        0,
        len(palavras),
        quantidade
    ):
        grupo = palavras[
            i:
            i + quantidade
        ]

        if not grupo:
            continue

        inicio = grupo[0][
            "inicio"
        ]

        fim = grupo[-1][
            "fim"
        ]

        texto = " ".join(
            item["palavra"]
            for item in grupo
        )

        segmentos.append(
            {
                "id": len(
                    segmentos
                ),
                "inicio": inicio,
                "fim": fim,
                "texto": texto,
                "palavras": grupo,
                "start": inicio,
                "end": fim,
                "text": texto
            }
        )

    # Último recurso:
    # existe texto mas nenhuma palavra.
    if (
        not segmentos
        and
        texto_completo
    ):
        segmentos.append(
            {
                "id": 0,
                "inicio": 0,
                "fim": 1,
                "texto":
                    texto_completo,
                "palavras": [],
                "start": 0,
                "end": 1,
                "text":
                    texto_completo
            }
        )

    return segmentos


# ==========================================================
# NORMALIZAR RESPOSTA PARA O SERVER.JS
# ==========================================================

def normalizar_resposta(
    dados
):
    texto = str(
        dados.get(
            "text",
            ""
        )
        or ""
    ).strip()

    idioma = str(
        dados.get(
            "language",
            "pt"
        )
        or "pt"
    )

    palavras = converter_palavras(
        dados.get(
            "words",
            []
        )
    )

    segmentos = converter_segmentos(
        dados.get(
            "segments",
            []
        ),
        palavras
    )

    if not segmentos:
        segmentos = (
            criar_segmentos_por_palavras(
                palavras,
                texto
            )
        )

    duracao = dados.get(
        "duration"
    )

    try:
        duracao = float(
            duracao
        )

    except (
        TypeError,
        ValueError
    ):
        duracao = 0

    if (
        duracao <= 0
        and
        segmentos
    ):
        duracao = float(
            segmentos[-1][
                "fim"
            ]
        )

    if (
        duracao <= 0
        and
        palavras
    ):
        duracao = float(
            palavras[-1][
                "fim"
            ]
        )

    log(
        f"Idioma: {idioma}"
    )
    log(
        f"Duração: {duracao:.2f}s"
    )
    log(
        f"Segmentos: {len(segmentos)}"
    )
    log(
        f"Palavras: {len(palavras)}"
    )

    return {
        "sucesso": True,
        "idioma": idioma,
        "duracao": duracao,
        "texto": texto,
        "segmentos": segmentos
    }


# ==========================================================
# MAIN
# ==========================================================

def main():

    if len(
        sys.argv
    ) < 2:
        responder_erro(
            "Nenhum vídeo foi informado."
        )
        sys.exit(
            1
        )

    caminho_video = (
        sys.argv[1]
    )

    try:
        dados = (
            transcrever_com_groq(
                caminho_video
            )
        )

        resultado = (
            normalizar_resposta(
                dados
            )
        )

        # IMPORTANTE:
        # somente este JSON vai para STDOUT.
        print(
            json.dumps(
                resultado,
                ensure_ascii=False
            ),
            flush=True
        )

    except Exception as erro:

        log(
            "ERRO GROQ:",
            str(
                erro
            )
        )

        responder_erro(
            str(
                erro
            )
        )

        sys.exit(
            1
        )


if __name__ == "__main__":
    main()