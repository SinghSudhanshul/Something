#!/bin/bash

echo "Checking Homebrew..."

if ! command -v brew &> /dev/null; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

echo "Installing jq..."
brew install jq

echo "Done. Version:"
jq --version
