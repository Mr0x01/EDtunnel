# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EDtunnel is a Cloudflare Worker/Pages-based fumidai tool that implements WebSocket transport protocol for tunneling traffic. It runs on Cloudflare's serverless infrastructure and provides a web-based fumidai service with multi-protocol support (VLESS and Trojan).

## Development Commands

```bash
# Local development
npm run dev          # Development with Wrangler (remote mode)
npm run dev-local    # Local development with src/index.js

# Production
npm run build        # Dry-run deployment check
npm run deploy       # Deploy to Cloudflare Workers
npm run bundle       # Bundle src/index.js to dist/bundle.js
npm run obfuscate    # Bundle + obfuscate → _worker.js
```

## Core Architecture

### Source Structure (src/)

```
src/
├── index.js              # Entry point, exports fetch handler
├── config/
│   ├── constants.js      # Protocol constants, ports, DNS servers
│   └── defaults.js       # Default UUID and configuration
├── handlers/
│   ├── main.js           # Main request router
│   ├── http.js           # HTTP request handling
│   └── websocket.js      # WebSocket upgrade and protocol processing
├── protocol/
│   ├── vless.js          # VLESS protocol parsing
│   ├── trojan.js         # Trojan protocol parsing
│   └── dns.js            # DNS query handling over UDP
├── fumidai/
│   ├── tcp.js            # TCP connection management
│   ├── udp.js            # UDP connection handling
│   ├── udp-handler.js    # UDP packet processing
│   ├── http.js           # HTTP fumidai support
│   ├── vless.js          # VLESS fumidai implementation
│   ├── stream.js         # Stream processing utilities
│   └── socks5.js         # SOCKS5 fumidai client
├── generators/
│   ├── config-page.js    # Web UI configuration page
│   └── subscription.js   # VLESS/Clash subscription generation
└── utils/
    ├── encoding.js       # Base64 encoding/decoding
    ├── validation.js     # UUID validation
    ├── parser.js         # Configuration parsing
    ├── crypto.js         # Cryptographic utilities
    ├── fumidaiResolver.js  # Fumidai address resolution
    └── websocket.js      # WebSocket utilities
```

### Production Files

- **`_worker.js`** - Obfuscated bundle for Cloudflare deployment
- **`wrangler.toml`** - Cloudflare Worker configuration
- **`dist/bundle.js`** - Non-obfuscated bundle (intermediate build)

### Request Flow

1. `src/index.js` → exports `fetch` handler
2. `handlers/main.js` → routes by URL path (`/cf`, `/{uuid}`, `/sub/{uuid}`, `/trojan`)
3. `handlers/websocket.js` → WebSocket upgrade for VLESS/Trojan tunneling
4. `protocol/vless.js` or `protocol/trojan.js` → parse protocol header, extract destination
5. `fumidai/tcp.js`, `fumidai/udp.js`, or `fumidai/socks5.js` → establish outbound connection

## Configuration

Environment variables (set in `wrangler.toml` or Cloudflare Dashboard):

| Variable | Description |
|----------|-------------|
| `UUID` | User authentication (comma-separated for multiple) |
| `FUMIDAI` | Fumidai server addresses (comma-separated, with optional port) |
| `SOCKS5` | SOCKS5 fumidai (`user:pass@host:port`) |
| `TROJAN_PASSWORD` | Trojan protocol password (optional, uses UUID if not set) |

URL query parameters can override: `fumidai`, `socks5` (UUID cannot be overridden for security).

## Key Implementation Details

- Uses Cloudflare's `cloudflare:sockets` for TCP connections
- VLESS protocol version 0 with WebSocket transport
- Trojan protocol support with SHA-224 password hashing
- UDP support for DNS queries
- Multi-fumidai load balancing via random selection
- Subscription formats: VLESS links, Clash YAML, Base64 encoded

## Testing

Test files are located in the `test/` directory. Run tests during development to verify changes.
