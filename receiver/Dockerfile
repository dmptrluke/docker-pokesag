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

# gnuradio is one monolithic package; xterm satisfies its hard dep on
# x-terminal-emulator during install. After install, force-purge everything
# not needed at runtime. main.py uses: runtime, analog, blocks, fft,
# filter, pmt (plus osmosdr from gr-osmosdr)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    xterm \
    gnuradio \
    gr-osmosdr \
    rtl-sdr \
    && dpkg --force-depends --purge \
    \
    # unused gnuradio modules (keep audio/uhd/funcube/iqbalance: osmosdr links them)
    $(dpkg -l | grep -oP 'libgnuradio-(qtgui|video-sdl|soapy|dtv|trellis|vocoder|wavelet|iio|zeromq)\S*' | tr '\n' ' ') \
    \
    # Qt5, Qt6, and GUI toolkits
    $(dpkg -l | grep -oP '(libqt[56]|libqwt-qt5|qt\S*-dev-tools|python3-pyqt[56]|pyqt[56]-dev-tools)\S*' | tr '\n' ' ') \
    python3-pyqtgraph python3-opengl python3-sip \
    \
    # X11, Mesa/OpenGL, fonts, display
    $(dpkg -l | grep -oP 'lib(x11|xcb|xau|xdmcp|xext|xrender|xft|xmu|xpm|xt6|xaw|xinerama|xkbcommon|ice6|sm6)\S*' | tr '\n' ' ') \
    $(dpkg -l | grep -oP 'lib(gl1|glx|glapi|egl|glu1|glvnd|mesa)\S*' | grep -v libglib | tr '\n' ' ') \
    xterm xbitmaps xkb-data x11-data libx11-data shared-mime-info \
    fonts-mathjax fonts-dejavu-core fontconfig fontconfig-config \
    libfontconfig1 libfreetype6 libpixman-1-0 libjbig0 \
    \
    # unused hardware/protocol libs (keep libuhd: osmosdr links it)
    $(dpkg -l | grep -oP 'lib(sdl|codec2|utempter)\S+' | tr '\n' ' ') \
    \
    # build toolchain and compilers
    gcc-12 g++-12 cpp-12 castxml \
    binutils binutils-common binutils-x86-64-linux-gnu libgprofng0 \
    $(dpkg -l | grep -oP 'libllvm\S+' | tr '\n' ' ') \
    libclang-cpp14 libz3-4 \
    libboost1.74-dev libopenblas-pthread-dev libpython3.11-dev \
    libstdc++-12-dev libc6-dev libgcc-12-dev linux-libc-dev \
    python3.11-dev zlib1g-dev \
    \
    # gcc sanitizer/debug libs (keep libquadmath + libgfortran for numpy)
    $(dpkg -l | grep -oP 'lib(asan|tsan|lsan|ubsan|cc1-0|itm|gomp)\S+' | tr '\n' ' ') \
    \
    # python packages and libs unused at runtime
    python3-pygccxml python3-thrift python3-gi python3-gi-cairo \
    python3-pythran python3-scipy python3-lxml \
    python3-all-dev python3-dev python3-all \
    libicu72 \
    perl libperl5.36 perl-modules-5.36 \
    libjs-mathjax \
    \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /code

COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-hashes -o /tmp/requirements.txt \
    && uv pip install --system --break-system-packages --no-cache -r /tmp/requirements.txt \
    && rm /usr/local/bin/uv /tmp/requirements.txt

COPY --from=build /usr/local/bin/multimon-ng /usr/local/bin/multimon-ng
COPY --from=ghcr.io/dmptrluke/healthcheck@sha256:3e9025c3550d94f35f1c565f8e71f89c9492fa4e79e440292ab776a144c460bb /healthcheck /usr/local/bin/healthcheck
COPY . .

RUN rm -rf /var/lib/dpkg /var/lib/apt /usr/bin/dpkg /usr/bin/apt-get

ENV DB_HOST=db \
    DB_NAME=pokesag \
    DB_USER=pokesag \
    DB_PASS=pokesag \
    DB_PORT=5432 \
    DISCARD_SPAM=false

HEALTHCHECK --start-period=60s --interval=30s --timeout=5s \
    CMD ["healthcheck", "file-age", "/tmp/pokesag_heartbeat", "120"]

CMD ["python3", "/code/src/main.py"]
