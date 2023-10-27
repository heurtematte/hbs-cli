# SPDX-FileCopyrightText: 2022 eclipse foundation
# SPDX-License-Identifier: EPL-2.0

FROM node:21-bookworm

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG DEBIAN_FRONTEND="noninteractive"

# DL3008 Pin versions in apt get install
# hadolint ignore=DL3008
RUN apt-get update -qq && \
    apt-get install -y eatmydata --no-install-recommends && \
    eatmydata apt-get install -y -qq --no-install-recommends && \
    apt-get upgrade -y && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives

WORKDIR /app
COPY . /app

ENTRYPOINT [ "node", "/app/lib/src/index.js" ]


