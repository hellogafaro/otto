import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useSlowRpcAckRequests } from "../rpc/request-latency-state";

export function SlowRpcRequestToastCoordinator() {
  const hasSlowRequests = useSlowRpcAckRequests().length > 0;
  const toastIdRef = useRef<string | number | null>(null);

  useEffect(() => {
    if (!hasSlowRequests) {
      if (toastIdRef.current !== null) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }

      return;
    }

    toastIdRef.current ??= toast.warning("Some requests are taking longer than usual", {
      duration: Infinity,
    });
  }, [hasSlowRequests]);

  useEffect(
    () => () => {
      if (toastIdRef.current !== null) {
        toast.dismiss(toastIdRef.current);
      }
    },
    [],
  );

  return null;
}
