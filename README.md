<div align="center">

# PROXYHUB

**A self-hosted multi-provider AI gateway and access management platform.**

Built on top of [New API](https://github.com/QuantumNous/new-api)

</div>

---

## 📝 Overview

**PROXYHUB** is a self-hosted AI gateway project focused on unified AI access, authentication, provider integration, and model management.

The project is built on top of **New API** and integrates **9Router** together with custom services developed specifically for PROXYHUB.

The goal is to provide a centralized platform for managing access to multiple AI providers through a single gateway.

> **Project status:** PROXYHUB is currently under active development. Some authentication and provider-management features are still being implemented.

---

## ✨ Features

- Multi-provider AI gateway
- Unified user authentication
- OAuth / OIDC integration
- AI provider integration
- Model and API access management
- Self-hosted deployment
- Docker-based infrastructure
- PostgreSQL persistence
- Redis-based caching
- Caddy reverse proxy
- Custom provider integration services
- Multi-user support

---

## 🛠️ Technology Stack

| Technology | Purpose |
| --- | --- |
| **Go** | Backend |
| **Gin** | HTTP backend framework |
| **React** | Web interface |
| **TypeScript** | Frontend |
| **New API** | Gateway foundation |
| **9Router** | AI provider routing and integration |
| **PostgreSQL** | Persistent database |
| **Redis** | Cache and shared state |
| **Docker** | Containerization |
| **Docker Compose** | Service orchestration |
| **Caddy** | Reverse proxy and HTTPS |
| **OAuth / OIDC** | Authentication |

---

## 🧩 Project Components

### New API

PROXYHUB is built on top of **New API**, which provides the main gateway and web application foundation.

It provides functionality such as:

- User management
- Authentication
- API key management
- Model management
- Provider/channel configuration
- Usage management
- Quota management
- Web console
- AI API gateway functionality

PROXYHUB extends this foundation with additional services and functionality.

### 9Router

[9Router](https://github.com/decolua/9router) is integrated into PROXYHUB to provide additional AI provider connectivity and routing capabilities.

### Bridge

PROXYHUB includes a custom **Bridge** service developed specifically for the project.

The Bridge is responsible for additional provider integration functionality and is currently under active development.

### Caddy

Caddy is used as the reverse proxy and HTTPS entry point.

### PostgreSQL

PostgreSQL is used for persistent application data.

### Redis

Redis is used for caching and shared application state.

---

## 🔐 Authentication

PROXYHUB uses OAuth/OIDC-based authentication.

Google OIDC is currently used as the primary authentication provider during development.

Additional authentication and access-control functionality is currently being developed.

> Internal authentication and provider-integration implementation details are intentionally not documented in this README.

---

## 🤖 AI Provider Management

PROXYHUB is designed to provide a unified interface for multiple AI providers.

The gateway allows applications to interact with AI providers through a centralized API rather than integrating with each provider independently.

Provider availability and supported models depend on the configured provider and its authentication state.

---

## 🌐 API Gateway

PROXYHUB builds upon the API gateway capabilities provided by New API.

Common OpenAI-compatible endpoints include:

```text
GET  /v1/models
POST /v1/chat/completions
POST /v1/responses