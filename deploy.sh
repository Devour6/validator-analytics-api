#!/bin/bash
# Deployment script for Validator Analytics API

echo "🚀 Deploying Validator Analytics API..."

# Build the application
echo "📦 Building application..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"

# Start the server
echo "🎯 Starting production server..."
npm run start

echo "🚀 Validator Analytics API deployed successfully!"
echo "📡 Health check: http://localhost:3001/health"
echo "🎯 API endpoint: http://localhost:3001/api/validators"