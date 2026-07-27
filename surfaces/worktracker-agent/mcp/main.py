import asyncio
import os
from worktracker_agent.mcp.server import mcp

def main():
    transport = os.getenv("MCP_TRANSPORT", "http")
    host = os.getenv("MCP_HOST", "0.0.0.0")
    port = int(os.getenv("MCP_PORT", "8124"))

    run_kwargs = {"transport": transport}
    if transport == "sse" or transport == "http":
        run_kwargs["host"] = host
        run_kwargs["port"] = port

    asyncio.run(mcp.run_async(**run_kwargs))

if __name__ == "__main__":
    main()
