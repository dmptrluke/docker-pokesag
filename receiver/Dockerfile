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

# gnuradio pulls in compilers, LLVM, Qt, scipy as hard deps that aren't
# needed at runtime. Force-purge after install to save ~900MB.
# gnuradio requires a terminal emulator; xterm is the lightest provider.
# gr-osmosdr provides the osmosdr source block for RTL-SDR.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    xterm \
    gnuradio \
    gr-osmosdr \
    rtl-sdr \
    && dpkg --force-depends --purge \
    libboost1.74-dev libopenblas-pthread-dev libpython3.11-dev \
    libstdc++-12-dev libc6-dev libgcc-12-dev linux-libc-dev \
    gcc-12 g++-12 cpp-12 castxml \
    binutils binutils-common binutils-x86-64-linux-gnu \
    libllvm14 libllvm15 libclang-cpp14 libz3-4 \
    python3-pygccxml python3-all-dev python3-dev python3-all \
    python3-scipy python3-pyqt5 python3-pyqt6 \
    libjs-mathjax \
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
