FROM nickblah/luajit:2-lua52compat-luarocks-buster

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
    git-core \
    libusb-1.0-0-dev \
    libpq-dev \
    pkg-config \
    wget \
    libliquid-dev \
    libvolk1-dev \
    libfftw3-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install wait-for
COPY wait-for /bin
RUN chmod +x /bin/wait-for

# Install LuaSQL
WORKDIR /tmp
RUN luarocks install luapgsql PQ_INCDIR=/usr/include/postgresql

# Install RTL-SDR
WORKDIR /tmp
RUN git clone git://git.osmocom.org/rtl-sdr.git \
    && cd rtl-sdr \
    && mkdir build

WORKDIR /tmp/rtl-sdr/build
RUN cmake ../ -DINSTALL_UDEV_RULES=ON -DDETACH_KERNEL_DRIVER=ON \
    && make \
    && make install \
    && cp /tmp/rtl-sdr/rtl-sdr.rules /etc/udev/rules.d/ \
    && ldconfig

# Install LuaRadio
WORKDIR /tmp
RUN git clone https://github.com/vsergeev/luaradio.git \
    && cd luaradio/embed \
    && make install-lmod

# Copy server code
WORKDIR /code
COPY . ./

ENV DB_HOST=db
ENV DB_NAME=pokesag
ENV DB_USER=pokesag
ENV DB_PASSWORD=pokesag

CMD ["wait-for", "db:5432" "/code/server.lua"]
