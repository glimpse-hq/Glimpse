declare module "howler" {
  export type HowlCallback = (id: number | string, error?: unknown) => void;

  export type HowlOptions = {
    src: string[];
    html5?: boolean;
    preload?: boolean | "metadata";
    onload?: () => void;
    onloaderror?: HowlCallback;
    onplayerror?: HowlCallback;
    onplay?: () => void;
    onpause?: () => void;
    onstop?: () => void;
    onend?: () => void;
    onseek?: () => void;
  };

  export class Howl {
    constructor(options: HowlOptions);
    play(id?: number | string): void;
    pause(id?: number | string): void;
    stop(id?: number | string): void;
    unload(): void;
    playing(id?: number | string): boolean;
    seek(seek?: number, id?: number | string): number | void;
    duration(id?: number | string): number;
    rate(rate: number, id?: number | string): number;
  }
}
