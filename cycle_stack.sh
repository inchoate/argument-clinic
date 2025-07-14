#!/bin/bash

# cycle_stack.sh - Script to tear down and rebuild Docker Compose services
# Usage: ./cycle_stack.sh [service_name1] [service_name2] ...

set -e # Exit on error

# Check if Docker Compose is installed
if ! command -v docker compose &>/dev/null; then
    echo "Error: docker compose is not installed or not in PATH"
    exit 1
fi

# Function to cycle the entire stack
cycle_all() {
    echo "🔄 Cycling entire Docker Compose stack..."
    echo "⬇️ Bringing down all services..."
    docker compose down

    echo "⬆️ Rebuilding and starting all services..."
    docker compose up -d --build

    echo "✅ Stack cycling complete!"
}

# Function to cycle a specific service
cycle_service() {
    local service=$1

    # Check if the service exists in the docker-compose.yml
    if ! docker compose config --services | grep -q "^$service$"; then
        echo "❌ Error: Service '$service' not found in docker-compose.yml"
        echo "Available services:"
        docker compose config --services
        return 1
    fi

    echo "🔄 Cycling service: $service"
    echo "⬇️ Stopping service..."
    docker compose stop $service

    echo "🗑️ Removing service container..."
    docker compose rm -f $service

    echo "🏗️ Rebuilding and starting service..."
    docker compose up -d --build $service

    echo "✅ Service '$service' cycling complete!"
}

# Function to cycle multiple services
cycle_services() {
    local failed=0

    echo "🔄 Cycling multiple services: $*"

    # Stop all specified services first
    echo "⬇️ Stopping services..."
    docker compose stop "$@"

    # Remove all specified services
    echo "🗑️ Removing service containers..."
    docker compose rm -f "$@"

    # Rebuild and start all specified services
    echo "🏗️ Rebuilding and starting services..."
    docker compose up -d --build "$@"

    # Verify each service exists and was started
    for service in "$@"; do
        if ! docker compose config --services | grep -q "^$service$"; then
            echo "❌ Error: Service '$service' not found in docker-compose.yml"
            failed=1
        fi
    done

    if [ $failed -eq 0 ]; then
        echo "✅ All specified services cycling complete!"
    else
        echo "⚠️ Some services failed to cycle"
        return 1
    fi
}

# Main script logic
if [ $# -eq 0 ]; then
    # No arguments provided, cycle the entire stack
    cycle_all
elif [ $# -eq 1 ]; then
    # One argument provided, cycle the specified service
    cycle_service "$1"
else
    # Multiple arguments provided, cycle specified services
    cycle_services "$@"
fi

# Show running containers
echo "📊 Current running containers:"
docker compose ps
