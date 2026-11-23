export type ActionBehavior = "smart" | "hold" | "toggle";

export type ActionShortcut = {
  shortcut: string;
  behavior: ActionBehavior;
  problem: string | null;
};

export type ActionInfo = {
  name: string;
  file: string;
  description: string | null;
  enabled: boolean;
  shortcuts: ActionShortcut[];
  phrases: string[];
  events: string[];
  show: "toast" | "insert";
  listen: boolean;
  problems: string[];
  last_failure: string | null;
};

export type ActionsList = {
  folder: string;
  actions: ActionInfo[];
};
