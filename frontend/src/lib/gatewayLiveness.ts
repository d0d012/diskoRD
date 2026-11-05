export function createGatewayLiveness(reconnect: () => void, ackTimeoutMs = 5000) {
  let ackTimeout: ReturnType<typeof setTimeout> | null = null;

  function receivedMessage() {
    if (ackTimeout) clearTimeout(ackTimeout);
    ackTimeout = null;
  }

  return {
    probe(sendHeartbeat: () => void) {
      receivedMessage();
      sendHeartbeat();
      ackTimeout = setTimeout(() => {
        ackTimeout = null;
        reconnect();
      }, ackTimeoutMs);
    },
    receivedMessage,
    dispose() {
      receivedMessage();
    },
  };
}

export function hasSleepDrift(previous: number, current: number, periodMs: number, thresholdMs = 30_000) {
  return current - previous > Math.max(periodMs * 2, thresholdMs);
}

export function reconnectOnSleepDrift(
  previous: number,
  current: number,
  periodMs: number,
  replaceSocket: () => void,
) {
  if (!hasSleepDrift(previous, current, periodMs)) return false;
  replaceSocket();
  return true;
}

export function createOnlineHandler(reconnect: (force: boolean) => void) {
  return () => reconnect(true);
}
