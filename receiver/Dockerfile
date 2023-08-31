FROM nickblah/luajit:2-lua52compat-luarocks

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    libusb-1.0-0-dev \
    libpq-dev \
    pkg-config \
    netcat-openbsd \
    libliquid-dev \
    libvolk2-dev \
    libfftw3-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install LuaSQL
WORKDIR /tmp
RUN luarocks install luapgsql PQ_INCDIR=/usr/include/postgresql

# Install RTL-SDR
WORKDIR /tmp
RUN git clone --depth 1 git://git.osmocom.org/rtl-sdr.git \
    && cd rtl-sdr \
    && mkdir build

WORKDIR /tmp/rtl-sdr/build
RUN cmake ../ -DINSTALL_UDEV_RULES=ON -DDETACH_KERNEL_DRIVER=ON \
    && make \
    && make install \
    && cp /tmp/rtl-sdr/rtl-sdr.rules /etc/udev/rules.d/ \
    && ldconfig \
    && rm -rf /tmp/rtl-sdr

# Install LuaRadio
WORKDIR /tmp
RUN git clone --depth 1 https://github.com/vsergeev/luaradio.git \
    && cd luaradio/embed \
    && make install-lmod \
    && rm -rf /tmp/luaradio

# Copy receiver code
WORKDIR /code
COPY . ./

ENV DB_HOST=pokesag_db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASS=pokesag
ENV DB_PORT=5432

ENV DISCARD_SPAM=false

CMD ["/code/wait-for", "db:5432", "--", "luajit", "/code/receiver.lua"]
