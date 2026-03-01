FROM debian:bookworm-slim

# ---- Install GNURadio + gr-osmosdr + system Python deps ----
# gnuradio requires a terminal emulator; xterm is the lightest provider.
# gr-osmosdr provides the osmosdr source block for RTL-SDR.
# python3-psycopg2 for PostgreSQL access.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    xterm \
    gnuradio \
    gr-osmosdr \
    python3-psycopg2 \
    rtl-sdr \
    build-essential \
    cmake \
    git \
    netcat-openbsd \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# ---- Build and install multimon-ng from source (latest) ----
WORKDIR /tmp
RUN git clone --depth 1 https://github.com/EliasOenal/multimon-ng.git \
    && cd multimon-ng \
    && mkdir build

WORKDIR /tmp/multimon-ng/build
RUN cmake .. \
    && make -j"$(nproc)" \
    && make install \
    && rm -rf /tmp/multimon-ng

# ---- Copy receiver code ----
WORKDIR /code
COPY . .

ENV DB_HOST=pokesag_db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432
ENV DISCARD_SPAM=false

CMD ["python3", "/code/receiver.py"]
