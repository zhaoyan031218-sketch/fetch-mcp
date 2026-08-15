#!/usr/bin/env node

import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFetchServer } from "./server.js";
import process from "process";

export interface HttpServerOptions {
  port: number;
  host?: string;
  authToken?: string;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function sendJson(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    // Stateless mode: no SSE stream or session to GET/DELETE
    sendJson(res, 405, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null,
    });
    return;
  }

  // A fresh server+transport per request keeps the endpoint stateless, so it
  // works behind load balancers and needs no session cleanup.
  const server = createFetchServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export function startHttpServer(options: HttpServerOptions): Promise<HttpServer> {
  const { port, host = "0.0.0.0", authToken } = options;

  const httpServer = createHttpServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];

    if (path === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (path !== "/mcp") {
      sendJson(res, 404, { error: "Not found. MCP endpoint is at /mcp" });
      return;
    }

    if (authToken && !tokenMatches(req.headers.authorization, authToken)) {
      sendJson(res, 401, {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: missing or invalid Bearer token" },
        id: null,
      });
      return;
    }

    handleMcpRequest(req, res).catch((error) => {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      } else {
        res.end();
      }
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve(httpServer));
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain || process.env.MCP_HTTP_AUTOSTART === "1") {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const authToken = process.env.MCP_AUTH_TOKEN || undefined;

  if (!authToken) {
    console.warn(
      "Warning: MCP_AUTH_TOKEN is not set. The /mcp endpoint will accept unauthenticated requests, " +
        "which lets anyone use this server to fetch arbitrary URLs. Set MCP_AUTH_TOKEN in production.",
    );
  }

  startHttpServer({ port, authToken })
    .then(() => {
      console.log(`MCP fetch server (Streamable HTTP) listening on port ${port} at /mcp`);
    })
    .catch((error) => {
      console.error("Fatal error starting HTTP server:", error);
      process.exit(1);
    });
}
