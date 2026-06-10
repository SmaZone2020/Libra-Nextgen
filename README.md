# Libra-Nextgen

Libra-Nextgen is a high-performance, cross-platform C2 framework for red-team operations, built on .NET 10 (Native AOT), ASP.NET Core, MongoDB, and React.

## Architecture

| Component           | Path                       | Technology                      |
| ------------------- | -------------------------- | ------------------------------- |
| Server (TeamServer) | `src/service/`             | ASP.NET Core WebAPI + WebSocket |
| Agent               | `src/agent/`               | .NET 10 Native AOT              |
| Console (Web UI)    | `src/webapp/`              | React + Vite + HeroUI           |
| Common              | `src/LibraNextgen.Common/` | Shared models & protocol        |

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js](https://nodejs.org/) 20+ (LTS)
- [MongoDB](https://www.mongodb.com/try/download/community) 7.0+

## Quick Start

### 1. Start MongoDB

```bash
mongod --dbpath ./data
```

Or use Docker:

```bash
docker run -d -p 27017:27017 --name mongodb mongo:7
```

### 2. Start the Server

```bash
cd src/service
dotnet run
```

The server starts on `http://localhost:5000`. API docs are available at `/scalar/v1` in development mode.

### 3. Start the Web Console

```bash
cd src/webapp
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### 4. First-Time Setup

On first access, the web console will prompt you to create an initial admin account. Enter a username and password (minimum 6 characters), confirm the password, and click "Create Account".

After setup, you will be logged in directly and can proceed to the dashboard.

### 5. Start an Agent

```bash
cd src/agent
dotnet run -- --server http://localhost:5000/agent
```

The agent will register with the server and appear in the dashboard.

For a Native AOT deployment (Linux x64):

```bash
dotnet publish -c Release -r linux-x64
```

### 6. Manage Agents

Use the web console to:

- View agent details (hardware, network, processes)
- Open remote shells (interactive PTY)
- Browse and manage files on the agent
- Capture screen frames (differential compression)
- Monitor camera and microphone
- View system info (processes, windows, environment variables, network)

## Development

```bash
# Run all services (server + webapp)
cd src/service && dotnet run &
cd src/webapp && npm run dev

# Build agent for Linux Native AOT
cd src/agent && dotnet publish -c Release -r linux-x64

# Build agent for Windows Native AOT
cd src/agent && dotnet publish -c Release -r win-x64
```
