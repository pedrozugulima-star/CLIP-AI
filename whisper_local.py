import os
import sys
import json
import subprocess
import tempfile
import shutil
from pathlib import Path

from groq import Groq


MODEL = os.getenv(
    "GROQ_WHISPER_MODEL",
    "whisper-large-v3-turbo"
)

# Limite seguro para envio à Groq
MAX_AUDIO_MB = 20

# Cada parte terá no máximo 20 minutos
DURACAO_PARTE_SEGUNDOS = 1200


def log(mensagem):
    print(
        mensagem,
        file=sys.stderr,
        flush=True
    )


def obter_ffmpeg():
    projeto = Path(__file__).resolve().parent

    candidatos = [
        projeto
        / "node_modules"
        / "ffmpeg-static"
        / "ffmpeg.exe",

        projeto
        / "node_modules"
        / "ffmpeg-static"
        / "ffmpeg",
    ]

    for candidato in candidatos:
        if candidato.exists():
            return str(candidato)

    return "ffmpeg"


def tamanho_mb(caminho):
    return (
        os.path.getsize(caminho)
        / (1024 * 1024)
    )


def extrair_audio(
    video_path,
    audio_path
):
    ffmpeg = obter_ffmpeg()

    log(
        "Extraindo áudio comprimido "
        "para envio à Groq..."
    )

    comando = [
        ffmpeg,
        "-y",
        "-i",
        video_path,
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "32k",
        audio_path,
    ]

    processo = subprocess.run(
        comando,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )

    if processo.returncode != 0:
        raise RuntimeError(
            "Erro ao extrair o áudio:\n"
            + processo.stderr[-3000:]
        )

    if not os.path.exists(audio_path):
        raise RuntimeError(
            "O arquivo de áudio não foi criado."
        )

    log(
        f"Áudio criado: {audio_path}"
    )

    log(
        f"Tamanho do áudio: "
        f"{tamanho_mb(audio_path):.2f} MB"
    )


def dividir_audio(
    audio_path,
    pasta_partes
):
    ffmpeg = obter_ffmpeg()

    log(
        "Áudio grande detectado."
    )

    log(
        "Dividindo o áudio "
        "automaticamente em partes..."
    )

    os.makedirs(
        pasta_partes,
        exist_ok=True
    )

    modelo_saida = os.path.join(
        pasta_partes,
        "parte_%03d.mp3"
    )

    comando = [
        ffmpeg,
        "-y",
        "-i",
        audio_path,
        "-f",
        "segment",
        "-segment_time",
        str(DURACAO_PARTE_SEGUNDOS),
        "-reset_timestamps",
        "1",
        "-c",
        "copy",
        modelo_saida,
    ]

    processo = subprocess.run(
        comando,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )

    if processo.returncode != 0:
        raise RuntimeError(
            "Erro ao dividir o áudio:\n"
            + processo.stderr[-3000:]
        )

    partes = []

    for nome in sorted(
        os.listdir(pasta_partes)
    ):
        if not nome.lower().endswith(
            ".mp3"
        ):
            continue

        caminho = os.path.join(
            pasta_partes,
            nome
        )

        if os.path.isfile(caminho):
            partes.append(caminho)

    if not partes:
        raise RuntimeError(
            "Não foi possível criar "
            "as partes do áudio."
        )

    log(
        f"Áudio dividido em "
        f"{len(partes)} partes."
    )

    for indice, parte in enumerate(
        partes,
        start=1
    ):
        log(
            f"Parte {indice}: "
            f"{tamanho_mb(parte):.2f} MB"
        )

    return partes


def valor(
    objeto,
    nome,
    padrao=None
):
    if objeto is None:
        return padrao

    if isinstance(objeto, dict):
        return objeto.get(
            nome,
            padrao
        )

    return getattr(
        objeto,
        nome,
        padrao
    )


def normalizar_palavras(
    palavras,
    deslocamento=0.0
):
    resultado = []

    if not palavras:
        return resultado

    for item in palavras:
        palavra = valor(
            item,
            "word",
            ""
        )

        inicio = valor(
            item,
            "start",
            0
        )

        fim = valor(
            item,
            "end",
            inicio
        )

        if palavra is None:
            palavra = ""

        try:
            inicio = float(inicio)
        except Exception:
            inicio = 0.0

        try:
            fim = float(fim)
        except Exception:
            fim = inicio

        inicio += deslocamento
        fim += deslocamento

        resultado.append(
            {
                "palavra": str(palavra),
                "inicio": inicio,
                "fim": fim,
                "word": str(palavra),
                "start": inicio,
                "end": fim,
            }
        )

    return resultado


def normalizar_segmentos(
    segmentos,
    palavras,
    deslocamento=0.0
):
    resultado = []

    if segmentos:
        for indice, segmento in enumerate(
            segmentos
        ):
            inicio = valor(
                segmento,
                "start",
                0
            )

            fim = valor(
                segmento,
                "end",
                inicio
            )

            texto = valor(
                segmento,
                "text",
                ""
            )

            try:
                inicio = float(inicio)
            except Exception:
                inicio = 0.0

            try:
                fim = float(fim)
            except Exception:
                fim = inicio

            inicio += deslocamento
            fim += deslocamento

            palavras_segmento = []

            for palavra in palavras:
                p_inicio = palavra["inicio"]
                p_fim = palavra["fim"]

                if (
                    p_fim >= inicio
                    and p_inicio <= fim
                ):
                    palavras_segmento.append(
                        palavra
                    )

            resultado.append(
                {
                    "id": indice,
                    "inicio": inicio,
                    "fim": fim,
                    "texto": str(
                        texto or ""
                    ).strip(),
                    "palavras":
                        palavras_segmento,
                    "start": inicio,
                    "end": fim,
                    "text": str(
                        texto or ""
                    ).strip(),
                }
            )

        return resultado

    # Fallback caso a Groq retorne
    # palavras, mas não segmentos
    if palavras:
        tamanho_bloco = 12

        for indice in range(
            0,
            len(palavras),
            tamanho_bloco
        ):
            bloco = palavras[
                indice:
                indice + tamanho_bloco
            ]

            if not bloco:
                continue

            inicio = bloco[0]["inicio"]
            fim = bloco[-1]["fim"]

            texto = " ".join(
                item["palavra"].strip()
                for item in bloco
                if item["palavra"].strip()
            )

            resultado.append(
                {
                    "id": len(resultado),
                    "inicio": inicio,
                    "fim": fim,
                    "texto": texto,
                    "palavras": bloco,
                    "start": inicio,
                    "end": fim,
                    "text": texto,
                }
            )

    return resultado


def transcrever(
    audio_path,
    deslocamento=0.0
):
    api_key = os.getenv(
        "GROQ_API_KEY"
    )

    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY não foi configurada."
        )

    cliente = Groq(
        api_key=api_key
    )

    log("=" * 32)
    log("CLIP AI - GROQ WHISPER")
    log("=" * 32)

    log(
        f"Modelo: {MODEL}"
    )

    log(
        f"Enviando áudio para a Groq "
        f"({tamanho_mb(audio_path):.2f} MB)..."
    )

    with open(
        audio_path,
        "rb"
    ) as arquivo:

        resposta = (
            cliente
            .audio
            .transcriptions
            .create(
                file=(
                    os.path.basename(
                        audio_path
                    ),
                    arquivo.read()
                ),
                model=MODEL,
                response_format=
                    "verbose_json",
                timestamp_granularities=[
                    "word",
                    "segment"
                ],
                language="pt",
                temperature=0.0,
            )
        )

    log(
        "Transcrição recebida da Groq."
    )

    texto = (
        valor(
            resposta,
            "text",
            ""
        )
        or ""
    )

    idioma = (
        valor(
            resposta,
            "language",
            "pt"
        )
        or "pt"
    )

    duracao = (
        valor(
            resposta,
            "duration",
            0
        )
        or 0
    )

    try:
        duracao = float(duracao)
    except Exception:
        duracao = 0.0

    palavras_brutas = (
        valor(
            resposta,
            "words",
            []
        )
        or []
    )

    segmentos_brutos = (
        valor(
            resposta,
            "segments",
            []
        )
        or []
    )

    palavras = normalizar_palavras(
        palavras_brutas,
        deslocamento
    )

    segmentos = normalizar_segmentos(
        segmentos_brutos,
        palavras,
        deslocamento
    )

    return {
        "sucesso": True,
        "idioma": idioma,
        "duracao": (
            duracao
            + deslocamento
        ),
        "texto": texto,
        "segmentos": segmentos,
    }


def transcrever_audio_completo(
    audio_path,
    pasta_temporaria
):
    tamanho_audio = tamanho_mb(
        audio_path
    )

    # Áudio pequeno:
    # envia normalmente
    if tamanho_audio < MAX_AUDIO_MB:
        log(
            "Áudio dentro do limite."
        )

        return transcrever(
            audio_path
        )

    # Áudio grande:
    # divide e transcreve em partes
    pasta_partes = os.path.join(
        pasta_temporaria,
        "partes"
    )

    partes = dividir_audio(
        audio_path,
        pasta_partes
    )

    textos = []
    segmentos_todos = []

    idioma_final = "pt"
    duracao_final = 0.0

    total_partes = len(partes)

    for indice, parte in enumerate(
        partes
    ):
        numero = indice + 1

        deslocamento = (
            indice
            * DURACAO_PARTE_SEGUNDOS
        )

        log(
            ""
        )

        log(
            f"Transcrevendo parte "
            f"{numero} de {total_partes}..."
        )

        resultado = transcrever(
            parte,
            deslocamento
        )

        texto_parte = (
            resultado.get(
                "texto",
                ""
            )
            or ""
        ).strip()

        if texto_parte:
            textos.append(
                texto_parte
            )

        segmentos_parte = (
            resultado.get(
                "segmentos",
                []
            )
            or []
        )

        segmentos_todos.extend(
            segmentos_parte
        )

        idioma_parte = resultado.get(
            "idioma",
            "pt"
        )

        if idioma_parte:
            idioma_final = idioma_parte

        duracao_parte = resultado.get(
            "duracao",
            0
        )

        try:
            duracao_parte = float(
                duracao_parte
            )
        except Exception:
            duracao_parte = 0.0

        if duracao_parte > duracao_final:
            duracao_final = duracao_parte

        log(
            f"Parte {numero} de "
            f"{total_partes} concluída."
        )

    # Reorganiza IDs depois de juntar
    for indice, segmento in enumerate(
        segmentos_todos
    ):
        segmento["id"] = indice

    # Garante duração pelo último segmento
    if segmentos_todos:
        ultimo_fim = max(
            float(
                segmento.get(
                    "fim",
                    0
                )
            )
            for segmento
            in segmentos_todos
        )

        if ultimo_fim > duracao_final:
            duracao_final = ultimo_fim

    log(
        ""
    )

    log(
        "Todas as partes foram "
        "transcritas com sucesso."
    )

    log(
        f"Total de segmentos: "
        f"{len(segmentos_todos)}"
    )

    return {
        "sucesso": True,
        "idioma": idioma_final,
        "duracao": duracao_final,
        "texto": " ".join(textos),
        "segmentos": segmentos_todos,
    }


def main():
    pasta_temporaria = None

    try:
        if len(sys.argv) < 2:
            raise RuntimeError(
                "Nenhum vídeo foi informado."
            )

        video_path = sys.argv[1]

        if not os.path.exists(
            video_path
        ):
            raise RuntimeError(
                f"Arquivo não encontrado: "
                f"{video_path}"
            )

        log(
            f"Arquivo: {video_path}"
        )

        log(
            f"Tamanho do vídeo: "
            f"{tamanho_mb(video_path):.2f} MB"
        )

        pasta_temporaria = (
            tempfile.mkdtemp(
                prefix="clip_ai_"
            )
        )

        audio_path = os.path.join(
            pasta_temporaria,
            "audio.mp3"
        )

        extrair_audio(
            video_path,
            audio_path
        )

        resultado = (
            transcrever_audio_completo(
                audio_path,
                pasta_temporaria
            )
        )

        print(
            json.dumps(
                resultado,
                ensure_ascii=False,
            ),
            flush=True,
        )

    except Exception as erro:
        log(
            f"ERRO: {erro}"
        )

        resultado = {
            "sucesso": False,
            "erro": str(erro),
        }

        print(
            json.dumps(
                resultado,
                ensure_ascii=False,
            ),
            flush=True,
        )

        sys.exit(1)

    finally:
        if (
            pasta_temporaria
            and os.path.exists(
                pasta_temporaria
            )
        ):
            try:
                shutil.rmtree(
                    pasta_temporaria
                )
            except Exception:
                pass


if __name__ == "__main__":
    main()