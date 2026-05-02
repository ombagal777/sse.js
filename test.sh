#!/usr/bin/env bash
set -euo pipefail

output_path=""
mode=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output_path)
      output_path="$2"
      shift 2
      ;;
    base|new)
      mode="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$output_path" || -z "$mode" ]]; then
  echo "Usage: ./test.sh --output_path <path> base|new"
  exit 1
fi

# Ensure output directory exists
mkdir -p "$(dirname "$output_path")"

# Force jest-junit to write to the exact file path
export JEST_JUNIT_OUTPUT_DIR="$(dirname "$output_path")"
export JEST_JUNIT_OUTPUT_NAME="$(basename "$output_path")"

if [[ "$mode" == "base" ]]; then
  ./node_modules/.bin/jest --ci \
    --runTestsByPath lib/sse.test.js \
    --reporters=default --reporters=jest-junit
elif [[ "$mode" == "new" ]]; then
  ./node_modules/.bin/jest --ci \
    --runTestsByPath lib/sse.backoff.test.js \
    --reporters=default --reporters=jest-junit
else
  echo "Unknown mode: $mode"
  exit 1
fi