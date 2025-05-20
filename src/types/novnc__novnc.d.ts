declare module '@novnc/novnc/lib/rfb.js' {
  // This is a basic type definition. For a more complete one,
  // you might need to refer to the noVNC source or a more comprehensive .d.ts file if available.
  export default class RFB {
    constructor(target: HTMLCanvasElement, url: string, options?: Record<string, any>);

    disconnect(): void;

    addEventListener(event: 'connect', callback: () => void): void;
    addEventListener(event: 'disconnect', callback: (event: CustomEvent<{ clean: boolean }>) => void): void;
    addEventListener(event: 'securityfailure', callback: (event: CustomEvent<{ reason?: string }>) => void): void;
    // Add other events as needed, e.g., 'credentialsrequired', 'desktopname'

    removeEventListener(event: 'connect', callback: () => void): void;
    removeEventListener(event: 'disconnect', callback: (event: CustomEvent<{ clean: boolean }>) => void): void;
    removeEventListener(event: 'securityfailure', callback: (event: CustomEvent<{ reason?: string }>) => void): void;

    // Add other methods as needed, e.g., sendCredentials, sendKey, etc.
    sendCredentials(creds: Record<string, any>): void;
    sendKey(keysym: number, code: string, down: boolean): void;
    // focus(): void;
    // blur(): void;
  }
}