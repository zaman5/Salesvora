// Shared types for the Settings feature

export type CredentialForm = {
  phoneNumber: string;
  sipUsername: string;
  sipPassword: string;
  apiKey: string;
  sipHost: string;
  connectionId: string;
  enabled: boolean;
};

export const EMPTY_FORM: CredentialForm = {
  phoneNumber: "",
  sipUsername: "",
  sipPassword: "",
  apiKey: "",
  sipHost: "",
  connectionId: "",
  enabled: true,
};

export type TestState = "idle" | "loading" | "ok" | "error";

export type TestResult = {
  outgoing: TestState;
  incoming: TestState;
  outgoingMessage: string;
  incomingMessage: string;
};

export type DisplayEntry = {
  id: number;
  number: string;
  label?: string;
  status: "active" | "inactive";
  synthetic?: boolean;
};
