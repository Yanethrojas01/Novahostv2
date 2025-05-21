// This file provides type definitions for noVNC (RFB) when loaded globally via a script tag (CDN).
// It declares the global `window.RFB` object.

// Basic type definitions for the RFB class exposed globally by noVNC's include files.
type RFBEventListener = (e: CustomEvent<any>) => void;


interface RFBInstance {
  disconnect(): void;
  addEventListener: (type: 'connect' | 'disconnect' | 'securityfailure' | string, listener: RFBEventListener) => void;
  // Add other methods/properties as needed, e.g.:
  // sendCredentials: (creds: { password?: string; username?: string; target?: string }) => void;
  // sendKey: (keysym: number, code: string, down: boolean) => void;
  // scaleViewport: boolean;
  // resizeSession: boolean;
}
interface RFBStatic {
  new (target: HTMLElement | null, url: string, options?: {
    credentials?: { password?: string; username?: string; target?: string };
    shared?: boolean;
    repeaterID?: string;
  }): RFBInstance;
}

declare global {
  interface Window {
    RFB?: RFBStatic; // noVNC RFB library loaded from CDN
  }
  }
}