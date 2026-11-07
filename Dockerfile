ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

RUN apk add --no-cache nodejs npm python3 py3-pip ffmpeg curl bash nginx

WORKDIR /app
COPY . /app

RUN npm --prefix dashboard ci \
    && npm --prefix dashboard run build \
    && pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY run.sh /run.sh
COPY nginx.conf /etc/nginx/http.d/default.conf
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
