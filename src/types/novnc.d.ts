declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: { wsProtocols?: string[] });
    scaleViewport: boolean;
    resizeSession: boolean;
    focusOnClick: boolean;
    disconnect(): void;
    focus(): void;
    sendKey(keysym: number, code?: string, down?: boolean): void;
  }
}
