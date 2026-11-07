ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm python3 py3-pip ffmpeg curl bash

WORKDIR /app
COPY . /app

RUN npm --prefix dashboard ci \
    && npm --prefix dashboard run build \
    && pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
