declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly NEXT_PUBLIC_HERMESPASS_E2E_ADAPTER?: string;
    }
  }
}

export {};
