FROM debian:bookworm-slim AS build

# ---- Build multimon-ng from source ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    build-essential \
    cmake \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp
RUN git clone --branch 1.4.1 --depth 1 https://github.com/EliasOenal/multimon-ng.git \
    && cd multimon-ng \
    && mkdir build \
    && cd build \
    && cmake .. \
    && make -j"$(nproc)" \
    && make install

# ---- Runtime image ----
FROM debian:bookworm-slim

# gnuradio requires a terminal emulator; xterm is the lightest provider.
# gr-osmosdr provides the osmosdr source block for RTL-SDR.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    xterm \
    gnuradio \
    gr-osmosdr \
    rtl-sdr \
    python3-pip \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* \
    && pip3 install --no-cache-dir --break-system-packages environs psycopg[binary]

COPY --from=build /usr/local/bin/multimon-ng /usr/local/bin/multimon-ng

WORKDIR /code
COPY . .

ENV DB_HOST=db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432
ENV DISCARD_SPAM=false

# Healthcheck: verify the heartbeat file was touched within the last 120 seconds
HEALTHCHECK --start-period=60s --interval=30s --timeout=5s \
    CMD find /tmp/pokesag_heartbeat -mmin -2 | grep -q . || exit 1

CMD ["python3", "/code/receiver.py"]
