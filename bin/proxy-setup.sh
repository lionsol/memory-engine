#!/bin/bash
# WSL2 代理配置 — 由 EDi 在 2026-05-25 设置
# Clash Verge 运行在 Windows (192.168.10.35:7897)

export HTTP_PROXY=http://192.168.10.35:7897
export HTTPS_PROXY=http://192.168.10.35:7897
export http_proxy=http://192.168.10.35:7897
export https_proxy=http://192.168.10.35:7897
export NO_PROXY=localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,.local,.ts.net
export no_proxy=localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,.local,.ts.net
