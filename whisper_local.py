import os
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

    video_path = sys.argv[1]

    if not os.path.exists(video_path):
        print(json.dumps({
            "sucesso": False,
            "erro": "Arquivo de vídeo não encontrado."
        }, ensure_ascii=False))
        return


    # ==========================================
    # MODELO
    #
    # LOCAL = BASE
    # RENDER = pode continuar TINY
    # pela variável WHISPER_MODEL
    # ==========================================

    model_name = os.getenv(
        "WHISPER_MODEL",
        "base"
    )


    try:

        model = WhisperModel(
            model_name,
            device="cpu",
            compute_type="int8"
        )


        # ==========================================
        # TRANSCRIÇÃO
        #
        # word_timestamps=True permite saber
        # exatamente quando cada palavra começa
        # e termina.
        # ==========================================

        segments, info = model.transcribe(
            video_path,

            beam_size=1,

            vad_filter=True,

            condition_on_previous_text=False,

            word_timestamps=True
        )


        segmentos = []

        textos = []

        duracao = 0


        for segment in segments:

            texto = segment.text.strip()

            if not texto:
                continue


            inicio = float(
                segment.start
            )

            fim = float(
                segment.end
            )


            duracao = max(
                duracao,
                fim
            )


            # ======================================
            # PALAVRAS COM TEMPO INDIVIDUAL
            # ======================================

            palavras = []


            if segment.words:

                for word in segment.words:

                    palavra_texto = (
                        word.word or ""
                    ).strip()


                    if not palavra_texto:
                        continue


                    palavra_inicio = (
                        float(word.start)
                        if word.start is not None
                        else inicio
                    )


                    palavra_fim = (
                        float(word.end)
                        if word.end is not None
                        else palavra_inicio
                    )


                    palavras.append({
                        "palavra": palavra_texto,
                        "inicio": palavra_inicio,
                        "fim": palavra_fim
                    })


            # ======================================
            # SEGMENTO
            # ======================================

            segmentos.append({

                "inicio": inicio,

                "fim": fim,

                "texto": texto,

                "palavras": palavras

            })


            textos.append(
                texto
            )


        # ==========================================
        # RESULTADO
        # ==========================================

        resultado = {

            "sucesso": True,

            "modelo": model_name,

            "idioma": info.language,

            "probabilidade_idioma":
                float(
                    info.language_probability
                ),

            "duracao": duracao,

            "texto":
                " ".join(
                    textos
                ),

            "segmentos":
                segmentos
        }


        print(
            json.dumps(
                resultado,
                ensure_ascii=False
            )
        )


    except Exception as erro:

        print(
            json.dumps({
                "sucesso": False,
                "erro": str(erro)
            }, ensure_ascii=False)
        )

        sys.exit(1)


if __name__ == "__main__":
    main()