export type Point = [number, number];

export interface Label {
  text: string;
  fontSize?: number;
  fontFamily?: number;
  lineHeight?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  strokeColor?: string;
}

export interface Element extends Partial<Label> {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeWidth?: number;
  strokeStyle?: string;
  backgroundColor?: string;
  fillStyle?: string;
  roughness?: number;
  opacity?: number;
  seed?: number;
  roundness?: { type: number; value?: number } | null;
  isDeleted?: boolean;
  points?: Point[];
  scale?: Point;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
    naturalWidth: number;
    naturalHeight: number;
  } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  startBinding?: Binding | null;
  endBinding?: Binding | null;
  boundElements?: { id: string; type: string }[] | null;
  originalText?: string;
  frameId?: string | null;
  containerId?: string | null;
  fileId?: string;
  name?: string | null;
  [field: string]: unknown;
}

export interface Binding {
  elementId: string;
  focus: number;
  gap: number;
}

export interface Skeleton extends Partial<Element> {
  id: string;
  type: string;
  label?: Label;
  children?: string[];
  start?: { id: string };
  end?: { id: string };
}

export type Files = Record<string, { dataURL: string }>;

export interface Spec {
  background: string;
  elements: Skeleton[];
  files: Files;
}

export interface Scene {
  type: "excalidraw";
  version?: number;
  source?: string;
  elements: Element[];
  appState?: { viewBackgroundColor?: string };
  files?: Files;
}
