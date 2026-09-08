import sys
import os
import json
import subprocess
import tempfile
from pathlib import Path

try:
    from groq import Groq
except ImportError:
    Groq = None


MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def localizar_ffmpeg():
    base = Path(__file__).resolve().parent

    candidatos = [
        base / "node_modules" / "ffmpeg-static" / "ffmpeg.exe",
        base / "node_modules" / "ffmpeg-static" / "ffmpeg",
        Path("ffmpeg"),
    ]

    for candidato in candidatos:
        if str(candidato) == "ffmpeg":
            return "ffmpeg"

        if candidato.exists():
            return str(candidato)

    return "ffmpeg"


def extrair_audio(video_path):
    ffmpeg = localizar_ffmpeg()

    temp_dir = tempfile.mkdtemp(prefix="clip_ai_")
    audio_path = os.path.join(temp_dir, "audio.flac")

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
        "-map",
        "0:a:0",
        "-c:a",
        "flac",
        audio_path,
    ]

    log("Extraindo áudio para envio à Groq...")

    processo = subprocess.run(
        comando,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if processo.returncode != 0:
        raise RuntimeError(
            "Erro ao extrair áudio com FFmpeg:\n"
            + processo.stderr[-3000:]
        )

    if not os.path.exists(audio_path):
        raise RuntimeError("O arquivo de áudio não foi criado.")

    tamanho_mb = os.path.getsize(audio_path) / (1024 * 1024)

    log(f"Áudio criado: {audio_path}")
    log(f"Tamanho do áudio: {tamanho_mb:.2f} MB")

    return audio_path, temp_dir


def pegar_valor(obj, nome, padrao=None):
    if isinstance(obj, dict):
        return obj.get(nome, padrao)

    return getattr(obj, nome, padrao)


def normalizar_palavras(words):
    resultado = []

    if not words:
        return resultado

    for item in words:
        palavra = pegar_valor(item, "word", "")
        inicio = pegar_valor(item, "start", 0)
        fim = pegar_valor(item, "end", 0)

        if palavra is None:
            palavra = ""

        palavra = str(palavra).strip()

        if not palavra:
            continue

        try:
            inicio = float(inicio or 0)
        except Exception:
            inicio = 0.0

        try:
            fim = float(fim or inicio)
        except Exception:
            fim = inicio

        resultado.append(
            {
                "palavra": palavra,
                "inicio": inicio,
                "fim": fim,
                "word": palavra,
                "start": inicio,
                "end": fim,
            }
        )

    return resultado


def normalizar_segmentos(segments, palavras_globais):
    resultado = []

    if not segments:
        return resultado

    for indice, segmento in enumerate(segments):
        inicio = pegar_valor(segmento, "start", 0)
        fim = pegar_valor(segmento, "end", 0)
        texto = pegar_valor(segmento, "text", "")

        try:
            inicio = float(inicio or 0)
        except Exception:
            inicio = 0.0

        try:
            fim = float(fim or inicio)
        except Exception:
            fim = inicio

        texto = str(texto or "").strip()

        palavras_segmento = []

        for palavra in palavras_globais:
            p_inicio = palavra["inicio"]
            p_fim = palavra["fim"]

            if p_fim >= inicio and p_inicio <= fim:
                palavras_segmento.append(palavra)

        resultado.append(
            {
                "id": indice,
                "inicio": inicio,
                "fim": fim,
                "texto": texto,
                "palavras": palavras_segmento,
                "start": inicio,
                "end": fim,
                "text": texto,
            }
        )

    return resultado


def criar_segmentos_por_palavras(palavras):
    segmentos = []

    if not palavras:
        return segmentos

    bloco = 12

    for i in range(0, len(palavras), bloco):
        grupo = palavras[i : i + bloco]

        if not grupo:
            continue

        inicio = grupo[0]["inicio"]
        fim = grupo[-1]["fim"]

        texto = " ".join(
            palavra["palavra"]
            for palavra in grupo
        ).strip()

        segmentos.append(
            {
                "id": len(segmentos),
                "inicio": inicio,
                "fim": fim,
                "texto": texto,
                "palavras": grupo,
                "start": inicio,
                "end": fim,
                "text": texto,
            }
        )

    return segmentos


def converter_resposta(transcricao):
    texto = pegar_valor(transcricao, "text", "") or ""
    idioma = pegar_valor(transcricao, "language", "pt") or "pt"
    duracao = pegar_valor(transcricao, "duration", 0) or 0

    words = pegar_valor(transcricao, "words", []) or []
    segments = pegar_valor(transcricao, "segments", []) or []

    palavras = normalizar_palavras(words)
    segmentos = normalizar_segmentos(segments, palavras)

    if not segmentos and palavras:
        segmentos = criar_segmentos_por_palavras(palavras)

    if not texto and segmentos:
        texto = " ".join(
            segmento["texto"]
            for segmento in segmentos
        ).strip()

    try:
        duracao = float(duracao)
    except Exception:
        duracao = 0.0

    if duracao <= 0 and palavras:
        duracao = palavras[-1]["fim"]

    if duracao <= 0 and segmentos:
        duracao = segmentos[-1]["fim"]

    return {
        "sucesso": True,
        "idioma": idioma,
        "duracao": duracao,
        "texto": texto,
        "segmentos": segmentos,
    }


def transcrever(audio_path):
    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY não foi configurada."
        )

    if Groq is None:
        raise RuntimeError(
            "Biblioteca 'groq' não instalada. "
            "Adicione groq no requirements.txt."
        )

    client = Groq(api_key=api_key)

    log("==============================")
    log("CLIP AI - GROQ WHISPER")
    log("==============================")
    log(f"Modelo: {MODEL}")
    log("Enviando áudio para Groq...")

    with open(audio_path, "rb") as arquivo:
        resposta = client.audio.transcriptions.create(
            file=(os.path.basename(audio_path), arquivo.read()),
            model=MODEL,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
            language="pt",
            temperature=0.0,
        )

    log("Transcrição recebida da Groq.")

    return converter_resposta(resposta)


def limpar_temp(temp_dir):
    try:
        if not temp_dir:
            return

        for nome in os.listdir(temp_dir):
            caminho = os.path.join(temp_dir, nome)

            try:
                os.remove(caminho)
            except Exception:
                pass

        try:
            os.rmdir(temp_dir)
        except Exception:
            pass

    except Exception:
        pass


def main():
    temp_dir = None

    try:
        if len(sys.argv) < 2:
            raise RuntimeError(
                "Informe o caminho do vídeo."
            )

        video_path = sys.argv[1]

        if not os.path.exists(video_path):
            raise RuntimeError(
                f"Arquivo não encontrado: {video_path}"
            )

        tamanho_video = os.path.getsize(video_path) / (1024 * 1024)

        log(f"Arquivo: {video_path}")
        log(f"Tamanho do vídeo: {tamanho_video:.2f} MB")

        audio_path, temp_dir = extrair_audio(video_path)

        resultado = transcrever(audio_path)

        print(
            json.dumps(
                resultado,
                ensure_ascii=False,
            ),
            flush=True,
        )

    except Exception as erro:
        log(f"ERRO: {erro}")

        print(
            json.dumps(
                {
                    "sucesso": False,
                    "erro": str(erro),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )

        sys.exit(1)

    finally:
        limpar_temp(temp_dir)


if __name__ == "__main__":
    main()