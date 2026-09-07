import os
import sys
import json
from faster_whisper import WhisperModel


def main():
    if len(sys.argv) < 2:
        resultado = {
            "sucesso": False,
            "erro": "Nenhum arquivo de vídeo foi informado."
        }

        print(
            json.dumps(
                resultado,
                ensure_ascii=False
            )
        )

        return

    video_path = sys.argv[1]

    if not os.path.exists(video_path):
        resultado = {
            "sucesso": False,
            "erro": "O arquivo de vídeo não foi encontrado."
        }

        print(
            json.dumps(
                resultado,
                ensure_ascii=False
            )
        )

        return

    # ==========================================
    # MODELO
    #
    # No PC usa SMALL por padrão.
    # No Render podemos usar:
    # WHISPER_MODEL=tiny
    # ==========================================

    model_name = os.getenv(
        "WHISPER_MODEL",
        "small"
    )

    try:
        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8"
        )

        segments, info = model.transcribe(
            video_path,
            beam_size=5,
            vad_filter=True
        )

        segmentos = []
        textos = []

        duracao = 0

        for segment in segments:
            texto = segment.text.strip()

            if not texto:
                continue

            inicio = float(segment.start)
            fim = float(segment.end)

            duracao = max(
                duracao,
                fim
            )

            segmentos.append({
                "inicio": inicio,
                "fim": fim,
                "texto": texto
            })

            textos.append(texto)

        texto_completo = " ".join(textos)

        resultado = {
            "sucesso": True,
            "modelo": model_name,
            "idioma": info.language,
            "probabilidade_idioma": float(
                info.language_probability
            ),
            "duracao": duracao,
            "texto": texto_completo,
            "segmentos": segmentos
        }

        print(
            json.dumps(
                resultado,
                ensure_ascii=False
            )
        )

    except Exception as erro:
        resultado = {
            "sucesso": False,
            "erro": str(erro)
        }

        print(
            json.dumps(
                resultado,
                ensure_ascii=False
            )
        )

        sys.exit(1)


if __name__ == "__main__":
    main()