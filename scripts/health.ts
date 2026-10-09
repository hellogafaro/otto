/** Readiness probe; no authentication material is printed or needed. */
try {
  const port = Number(process.env.PORT ?? "43001");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  const response = await fetch(`http://127.0.0.1:${port}/ready`, {
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  await response.body?.cancel();
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}

export {};
