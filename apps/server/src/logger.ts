import pino from "pino";
/** Operational metadata only. Never log request bodies, cookies or provider payloads. */
export function createLogger(destination?: pino.DestinationStream) {
  const options: pino.LoggerOptions = {
    level: "info",
    redact: {
      paths: [
        "password",
        "token",
        "secret",
        "authorization",
        "cookie",
        "accessToken",
        "refreshToken",
        "headers.authorization",
        "headers.cookie",
        "req.headers.authorization",
        "req.headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
