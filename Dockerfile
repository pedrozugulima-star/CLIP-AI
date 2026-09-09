FROM node:24-bookworm-slim

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PATH="/app/.venv/bin:$PATH"
ENV CHROME_BIN="/usr/bin/chromium"

# Dependências do sistema
RUN apt-get update && apt-get install -y \
    python3 \
    python3-venv \
    python3-pip \
    git \
    chromium \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Dependências Node
COPY package*.json ./

RUN npm install

# Cria ambiente Python isolado
RUN python3 -m venv /app/.venv

# Copia requirements primeiro
COPY requirements.txt ./

RUN pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install -U yt-dlp yt-dlp-getpot-wpc bgutil-ytdlp-pot-provider

# Instala e compila o servidor local de PO Token
RUN git clone --depth 1 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /app/bgutil-ytdlp-pot-provider && \
    cd /app/bgutil-ytdlp-pot-provider/server && \
    npm ci && \
    npx tsc

# Copia o restante do Clip AI
COPY . .

# Gera o frontend Vite
RUN npm run build

# Render fornece a porta pela variável PORT
EXPOSE 10000

# Inicia o servidor de PO Token e depois o Clip AI
CMD ["sh", "-c", "node /app/bgutil-ytdlp-pot-provider/server/build/main.js & node server.js"]