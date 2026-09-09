import os
import sys
import json
import subprocess
import tempfile
import shutil
from pathlib import Path

from groq import Groq


MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")


def log(mensagem):
    print(mensagem, file=sys.stderr, flush=True)


def obter_ffmpeg():
    projeto = Path(__file__).resolve().parent

    candidatos = [
        projeto / "node_modules" / "ffmpeg-static" / "ffmpeg.exe",
        projeto / "node_modules" / "ffmpeg-static" / "ffmpeg",
    ]

    for candidato in candidatos:
        if candidato.exists():
            return str(candidato)

    return "ffmpeg"


def tamanho_mb(caminho):
    return os.path.getsize(caminho) / (1024 * 1024)


def extrair_audio(video_path, audio_path):
    ffmpeg = obter_ffmpeg()

    log("Extraindo áudio comprimido para envio à Groq...")

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
            "Erro ao extrair o áudio:\n" + processo.stderr[-3000:]
        )

    if not os.path.exists(audio_path):
        raise RuntimeError("O arquivo de áudio não foi criado.")

    log(f"Áudio criado: {audio_path}")
    log(f"Tamanho do áudio: {tamanho_mb(audio_path):.2f} MB")


def valor(objeto, nome, padrao=None):
    if objeto is None:
        return padrao

    if isinstance(objeto, dict):
        return objeto.get(nome, padrao)

    return getattr(objeto, nome, padrao)


def normalizar_palavras(palavras):
    resultado = []

    if not palavras:
        return resultado

    for item in palavras:
        palavra = valor(item, "word", "")
        inicio = valor(item, "start", 0)
        fim = valor(item, "end", inicio)

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


def normalizar_segmentos(segmentos, palavras):
    resultado = []

    if segmentos:
        for indice, segmento in enumerate(segmentos):
            inicio = valor(segmento, "start", 0)
            fim = valor(segmento, "end", inicio)
            texto = valor(segmento, "text", "")

            try:
                inicio = float(inicio)
            except Exception:
                inicio = 0.0

            try:
                fim = float(fim)
            except Exception:
                fim = inicio

            palavras_segmento = []

            for palavra in palavras:
                p_inicio = palavra["inicio"]
                p_fim = palavra["fim"]

                if p_fim >= inicio and p_inicio <= fim:
                    palavras_segmento.append(palavra)

            resultado.append(
                {
                    "id": indice,
                    "inicio": inicio,
                    "fim": fim,
                    "texto": str(texto or "").strip(),
                    "palavras": palavras_segmento,
                    "start": inicio,
                    "end": fim,
                    "text": str(texto or "").strip(),
                }
            )

        return resultado

    # Fallback caso a Groq retorne palavras, mas não segmentos
    if palavras:
        tamanho_bloco = 12

        for indice in range(0, len(palavras), tamanho_bloco):
            bloco = palavras[indice:indice + tamanho_bloco]

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


def transcrever(audio_path):
    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise RuntimeError("GROQ_API_KEY não foi configurada.")

    cliente = Groq(api_key=api_key)

    log("=" * 32)
    log("CLIP AI - GROQ WHISPER")
    log("=" * 32)
    log(f"Modelo: {MODEL}")
    log(f"Enviando áudio para a Groq ({tamanho_mb(audio_path):.2f} MB)...")

    with open(audio_path, "rb") as arquivo:
        resposta = cliente.audio.transcriptions.create(
            file=(os.path.basename(audio_path), arquivo.read()),
            model=MODEL,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
            language="pt",
            temperature=0.0,
        )

    log("Transcrição recebida da Groq.")

    texto = valor(resposta, "text", "") or ""
    idioma = valor(resposta, "language", "pt") or "pt"
    duracao = valor(resposta, "duration", 0) or 0

    try:
        duracao = float(duracao)
    except Exception:
        duracao = 0.0

    palavras_brutas = valor(resposta, "words", []) or []
    segmentos_brutos = valor(resposta, "segments", []) or []

    palavras = normalizar_palavras(palavras_brutas)
    segmentos = normalizar_segmentos(segmentos_brutos, palavras)

    return {
        "sucesso": True,
        "idioma": idioma,
        "duracao": duracao,
        "texto": texto,
        "segmentos": segmentos,
    }


def main():
    pasta_temporaria = None

    try:
        if len(sys.argv) < 2:
            raise RuntimeError("Nenhum vídeo foi informado.")

        video_path = sys.argv[1]

        if not os.path.exists(video_path):
            raise RuntimeError(f"Arquivo não encontrado: {video_path}")

        log(f"Arquivo: {video_path}")
        log(f"Tamanho do vídeo: {tamanho_mb(video_path):.2f} MB")

        pasta_temporaria = tempfile.mkdtemp(prefix="clip_ai_")
        audio_path = os.path.join(pasta_temporaria, "audio.mp3")

        extrair_audio(video_path, audio_path)

        tamanho_audio = tamanho_mb(audio_path)

        if tamanho_audio >= 24:
            raise RuntimeError(
                f"O áudio comprimido ainda ficou muito grande "
                f"({tamanho_audio:.2f} MB). "
                "Será necessário dividir o áudio em partes."
            )

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
        if pasta_temporaria and os.path.exists(pasta_temporaria):
            try:
                shutil.rmtree(pasta_temporaria)
            except Exception:
                pass


if __name__ == "__main__":
    main()