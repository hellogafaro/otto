import type { RawMetricAttributes } from "./attributes.ts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Metric from "effect/Metric";
import * as Stream from "effect/Stream";

import { outcomeFromExit } from "./attributes.ts";
import { metricAttributes, rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./metrics.ts";

const RPC_SPAN_PREFIX = "ws.rpc";

const DEFAULT_RPC_SPAN_ATTRIBUTES = {
  "rpc.transport": "websocket",
  "rpc.system": "effect-rpc",
} as const;

const rpcSpanAttributes = (method: string, traceAttributes?: RawMetricAttributes) => ({
  ...DEFAULT_RPC_SPAN_ATTRIBUTES,
  "rpc.method": method,
  ...traceAttributes,
});

const withRpcEffectTracing = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: RawMetricAttributes,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.withSpan(`${RPC_SPAN_PREFIX}.${method}`, {
      attributes: rpcSpanAttributes(method, traceAttributes),
    }),
  );

const withRpcStreamTracing = <A, E, R>(
  method: string,
  stream: Stream.Stream<A, E, R>,
  traceAttributes?: RawMetricAttributes,
): Stream.Stream<A, E, R> =>
  stream.pipe(
    Stream.withSpan(`${RPC_SPAN_PREFIX}.${method}`, {
      attributes: rpcSpanAttributes(method, traceAttributes),
    }),
  );

const recordRpcStreamMetrics = <A, E>(
  method: string,
  startedAt: bigint,
  exit: Exit.Exit<A, E>,
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const endedAt = yield* Clock.currentTimeNanos;
    const elapsedNanos = endedAt > startedAt ? endedAt - startedAt : 0n;

    yield* Metric.update(
      Metric.withAttributes(rpcRequestDuration, metricAttributes({ method })),
      Duration.nanos(elapsedNanos),
    );
    yield* Metric.update(
      Metric.withAttributes(
        rpcRequestsTotal,
        metricAttributes({
          method,
          outcome: outcomeFromExit(exit),
        }),
      ),
      1,
    );
  });

export const observeRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: RawMetricAttributes,
): Effect.Effect<A, E, R> => {
  const instrumented = effect.pipe(
    withMetrics({
      counter: rpcRequestsTotal,
      timer: rpcRequestDuration,
      attributes: {
        method,
      },
    }),
  );

  return withRpcEffectTracing(method, instrumented, traceAttributes);
};

export const observeRpcStream = <A, E, R>(
  method: string,
  stream: Stream.Stream<A, E, R>,
  traceAttributes?: RawMetricAttributes,
): Stream.Stream<A, E, R> => {
  const instrumented = Stream.unwrap(
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeNanos;

      return stream.pipe(Stream.onExit((exit) => recordRpcStreamMetrics(method, startedAt, exit)));
    }),
  );

  return withRpcStreamTracing(method, instrumented, traceAttributes);
};

export const observeRpcStreamEffect = <A, StreamError, StreamContext, EffectError, EffectContext>(
  method: string,
  effect: Effect.Effect<Stream.Stream<A, StreamError, StreamContext>, EffectError, EffectContext>,
  traceAttributes?: RawMetricAttributes,
): Stream.Stream<A, StreamError | EffectError, StreamContext | EffectContext> => {
  const instrumented = Stream.unwrap(
    Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeNanos;
      const exit = yield* Effect.exit(effect);

      if (Exit.isFailure(exit)) {
        yield* recordRpcStreamMetrics(method, startedAt, exit);

        return yield* Effect.failCause(exit.cause);
      }

      return exit.value.pipe(
        Stream.onExit((streamExit) => recordRpcStreamMetrics(method, startedAt, streamExit)),
      );
    }),
  );

  return withRpcStreamTracing(method, instrumented, traceAttributes);
};
