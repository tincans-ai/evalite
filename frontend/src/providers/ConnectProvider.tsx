import React, { createContext, ReactNode, useContext } from "react";
import { createPromiseClient, PromiseClient } from "@connectrpc/connect";
import { EvaluationService } from "@/lib/gen/eval/v1/eval_connect";
import { createConnectTransport } from "@connectrpc/connect-web";

type EvaluationClient = PromiseClient<typeof EvaluationService>;

const ConnectContext = createContext<EvaluationClient | null>(null);

interface ConnectProviderProps {
  children: ReactNode;
}

export const ConnectProvider: React.FC<ConnectProviderProps> = ({ children }) => {
  const transport = createConnectTransport({
    baseUrl: "http://localhost:8080",
  });

  const client: EvaluationClient = createPromiseClient(EvaluationService, transport);

  return (
    <ConnectContext.Provider value={client}>
      {children}
    </ConnectContext.Provider>
  );
};

export const useConnectClient = (): EvaluationClient => {
  const context = useContext(ConnectContext);
  if (context === null) {
    throw new Error("useConnectClient must be used within a ConnectProvider");
  }
  return context;
};