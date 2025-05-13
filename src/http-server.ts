// http-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import { configureHaloscanServer } from "./haloscan-core.js";

// Setup Express
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Enable CORS with preflight support
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Handle preflight OPTIONS requests globally
app.options("*", (req, res) => {
  res.sendStatus(200);
});


app.use(express.json());

// Create an MCP server
const server = new McpServer({
  name: "Haloscan SEO",
  version: "1.0.0"
});

// Configure the server with Haloscan tools and prompts
configureHaloscanServer(server);

// Create transport map to track connections
const transports: {[sessionId: string]: SSEServerTransport} = {};

// Setup SSE endpoint
app.get("/sse", (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  
  res.on("close", () => {
    delete transports[transport.sessionId];
  });
  
  server.connect(transport);
});

// Setup message endpoint
app.post("/messages", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  
  if (transport) {
    transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No transport found for sessionId');
  }
});

// Simple health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send({
    status: "ok",
    server: "Haloscan MCP Server",
    version: "1.0.0"
  });
});

// Start the server
app.listen(PORT, () => {
  console.error(`Haloscan MCP Server running on http://localhost:${PORT}`);
  console.error(`Connect to /sse for SSE transport`);
});