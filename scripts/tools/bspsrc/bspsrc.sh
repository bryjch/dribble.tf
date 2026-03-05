#!/bin/sh
set -eu
VM_OPTIONS=
BASEDIR=$(dirname "$0")
"java" $VM_OPTIONS -cp "$BASEDIR/bspsrc.jar" info.ata4.bspsrc.app.src.BspSourceLauncher $*