import { ApolloProvider } from "@apollo/client/react";
import { useMemo, type ReactNode } from "react";

import { studioApolloClient } from "./client";

export function StudioApolloProvider({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => studioApolloClient(),
    [],
  );

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
