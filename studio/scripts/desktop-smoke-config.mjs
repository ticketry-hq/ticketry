const runtimeEndpointProtocols = {
  MUXED_DESKTOP_WORKTRACKER_API: "http:",
  MUXED_DESKTOP_AGENT_API: "http:",
  MUXED_DESKTOP_STATUS_API: "http:",
  MUXED_DESKTOP_STATUS_WEBSOCKET: "ws:",
  MUXED_DESKTOP_TERMINAL_WEBSOCKET: "ws:",
  MUXED_DESKTOP_CHAT_WEBSOCKET: "ws:",
};

export function buildDevelopmentSmokeConfiguration(port) {
  const portNumber = Number(port);
  if (!/^\d+$/.test(port) || portNumber < 1 || portNumber > 65_535) {
    throw new Error("MUXED_DESKTOP_SMOKE_PORT must be a valid TCP port");
  }

  const webviewUrl = `http://127.0.0.1:${port}`;
  const webSocketOrigin = `ws://127.0.0.1:${port}`;

  return {
    webviewUrl,
    runtimeEnvironment: {
      MUXED_DESKTOP_WORKTRACKER_API: `${webviewUrl}/api/work-tracker`,
      MUXED_DESKTOP_AGENT_API: `${webviewUrl}/api`,
      MUXED_DESKTOP_STATUS_API: `${webviewUrl}/api`,
      MUXED_DESKTOP_STATUS_WEBSOCKET: `${webSocketOrigin}/ws/status`,
      MUXED_DESKTOP_TERMINAL_WEBSOCKET: `${webSocketOrigin}/ws/terminal`,
      MUXED_DESKTOP_CHAT_WEBSOCKET: `${webSocketOrigin}/ws/chat`,
    },
  };
}

export function assertDevelopmentEndpointAgreement(webviewUrl, runtimeEnvironment) {
  const webview = new URL(webviewUrl);

  for (const [name, expectedProtocol] of Object.entries(runtimeEndpointProtocols)) {
    const value = runtimeEnvironment[name];
    if (typeof value !== "string") {
      throw new Error(`Desktop development smoke endpoint ${name} is missing`);
    }

    const endpoint = new URL(value);
    if (
      endpoint.protocol !== expectedProtocol ||
      endpoint.hostname !== webview.hostname ||
      endpoint.port !== webview.port
    ) {
      throw new Error(
        `Desktop development smoke endpoint ${name} does not match the webview at ${webviewUrl}`,
      );
    }
  }
}
