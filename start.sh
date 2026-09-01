#!/bin/bash
echo "Installing dependencies..."
npm install

echo "Building Canvas App..."
npm run build

echo "Starting Server on port 3020..."
npm start
