FROM debian:bookworm-slim AS build

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

# Runtime

FROM debian:bookworm-slim

COPY --from=ghcr.io/astral-sh/uv:0.6 /uv /usr/local/bin/uv

# gnuradio requires a terminal emulator; xterm is the lightest provider.
# gr-osmosdr provides the osmosdr source block for RTL-SDR.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    xterm \
    gnuradio \
    gr-osmosdr \
    rtl-sdr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code

COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-hashes -o /tmp/requirements.txt \
    && uv pip install --system --break-system-packages --no-cache -r /tmp/requirements.txt \
    && rm /usr/local/bin/uv /tmp/requirements.txt

COPY --from=build /usr/local/bin/multimon-ng /usr/local/bin/multimon-ng
COPY . .

ENV DB_HOST=db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432
ENV DISCARD_SPAM=false

HEALTHCHECK --start-period=60s --interval=30s --timeout=5s \
    CMD find /tmp/pokesag_heartbeat -mmin -2 | grep -q . || exit 1

CMD ["python3", "/code/receiver.py"]
