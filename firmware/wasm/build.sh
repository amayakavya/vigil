#!/bin/sh
# Builds docs/node.wasm: the node's application and signal core, the same C the
# ESP32-S3 runs, for the handset's bench node and for analysis/check_node.mjs.
# Needs zig (any recent release) on the PATH or in ZIG.
set -e
cd "$(dirname "$0")"
ZIG="${ZIG:-zig}"
"$ZIG" cc -target wasm32-wasi -mexec-model=reactor -O2 -s -std=c99 -Wall -Wextra \
  -o ../../docs/node.wasm bench.c ../core/node.c ../core/vigil.c
ls -l ../../docs/node.wasm
