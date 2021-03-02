__Warning: Depending on your region, it may not be legal to share or act upon any messages received by a radio scanner. 
You are advised to check your local regulations, and to NOT expose PokéSAG to the internet.__

![PokéSAG Logo](web/client/public/images/icon_x128.png)

# PokéSAG (Docker Edition)

A dockerized version of [PokéSAG](https://github.com/JoppyFurr/PokeSAG/) by @JoppyFurr!

To run a full stack of `pokesag-docker` (including a database), you can use the following `docker-compose` file.

```yaml
---
version: "3.8"

services:
  db:
    image: postgres:13
    environment:
      POSTGRES_USER: pokesag
      POSTGRES_PASSWORD: pokesag
    volumes:
      - pokesag_db:/var/lib/postgresql/data

  web:
    image: dmptrluke/pokesag-web:latest
    ports:
      - "8000:8000"

  server:
    image: dmptrluke/pokesag-server:latest
    environment:
      TZ: Pacific/Auckland
    devices:
      - /dev/swradio0:/dev/swradio0
      - /dev/bus/usb:/dev/bus/usb
    privileged: true
    restart: on-failure
volumes:
  pokesag_db:
```

You can also choose to use an external database by omitting the `db` container and using the `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASS` environment variables on the `web` and `server` containers.

## Step by Step
If you're new to Docker, below is a step by step guide to running PokéSAG in Docker. 

First of all, you'll need to install Docker. Head to the [official documentation](https://docs.docker.com/engine/install/) and select your Linux distro under the "Server" section and follow the instructions on the page. Then install docker-compose - the instructions for that are [here](https://docs.docker.com/compose/install/).

After that, create a new folder to work in to keep things tidy. In that folder create a file called `docker-compose.yml` with the text in the previous section, and save it. If you just want a basic install of PokéSAG, you won't need to edit anything.

Finally, run `docker-compose up` to start PokéSAG! This will run in the foreground. When you're happy with how everything is working, you can use `docker-compose up -d` to run everything in the background.

To update to the latest version, just run `docker-compose pull` and then `docker-compose up -d` again.

## License

This software is released under the MIT license.

```
Copyright (c) 2018 Joppy Furr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
