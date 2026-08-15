import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startHttpServer } from "./http";

const AUTH_TOKEN = "test-secret-token";

let server: HttpServer;
let baseUrl: string;

beforeAll(async () => {
  server = await startHttpServer({ port: 0, host: "127.0.0.1", authToken: AUTH_TOKEN });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

function mcpPost(body: object, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${AUTH_TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

describe("HTTP server", () => {
  it("responds to health checks without auth", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });

  it("rejects requests without a Bearer token", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initializeRequest),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with a wrong Bearer token", async () => {
    const res = await mcpPost(initializeRequest, { Authorization: "Bearer wrong-token" });
    expect(res.status).toBe(401);
  });

  it("rejects non-POST requests to /mcp", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status).toBe(405);
  });

  it("handles initialize requests", async () => {
    const res = await mcpPost(initializeRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("zcaceres/fetch");
  });

  it("lists all fetch tools", async () => {
    const res = await mcpPost({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      "fetch_html",
      "fetch_markdown",
      "fetch_txt",
      "fetch_json",
      "fetch_readable",
      "fetch_youtube_transcript",
    ]);
  });

  it("returns a JSON-RPC error for unknown tools", async () => {
    const res = await mcpPost({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "not_a_tool", arguments: { url: "https://example.com" } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.message).toContain("Tool not found");
  });
});
