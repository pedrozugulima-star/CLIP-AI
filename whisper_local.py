import sys
import json
from faster_whisper import WhisperModel


def main():

    if len(sys.argv) < 2:
        print(json.dumps({
            "sucesso": False,
            "erro": "Nenhum arquivo de vídeo foi informado."
        }, ensure_ascii=False))
        return


    caminho_video = sys.argv[1]


    try:

        print("Carregando modelo...", file=sys.stderr)

        model = WhisperModel(
            "small",
            device="cpu",
            compute_type="int8"
        )


        print("Transcrevendo...", file=sys.stderr)

        segments, info = model.transcribe(
            caminho_video,
            beam_size=5,
            vad_filter=True
        )


        lista_segmentos = []
        texto_completo = []


        for segmento in segments:

            texto = segmento.text.strip()

            if not texto:
                continue


            item = {
                "inicio": round(float(segmento.start), 2),
                "fim": round(float(segmento.end), 2),
                "texto": texto
            }


            lista_segmentos.append(item)

            texto_completo.append(texto)


        resultado = {
            "sucesso": True,
            "idioma": info.language,
            "probabilidade_idioma": round(
                float(info.language_probability),
                4
            ),
            "duracao": round(
                float(info.duration),
                2
            ),
            "texto": " ".join(texto_completo),
            "segmentos": lista_segmentos
        }


        print(
            json.dumps(
                resultado,
                ensure_ascii=False
            )
        )


    except Exception as erro:

        print(json.dumps({
            "sucesso": False,
            "erro": str(erro)
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()