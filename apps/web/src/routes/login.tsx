import { Button } from "@workspace/ui/components/button";
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import { useState } from "react";
import { useLogin } from "@/lib/rpc";

export function LoginPage({ error }: { error?: string }) {
  const login = useLogin();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <form
        className="flex w-84 flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          await login(password);
          setPending(false);
        }}
      >
        <h1 className="text-xl font-medium">Sign in to Otto</h1>
        <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoFocus
            value={password}
            aria-invalid={Boolean(error)}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
        <Button type="submit" disabled={!password || pending}>
          {pending && <Spinner />}
          Sign in
        </Button>
      </form>
    </main>
  );
}
