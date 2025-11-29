export enum ToolType {
  SELECT = 'SELECT',
  RECTANGLE = 'RECTANGLE',
  CIRCLE = 'CIRCLE',
  TEXT = 'TEXT',
  ARROW = 'ARROW',
  GROUP = 'GROUP'  // 分组/子图
}

export enum LineType {
  STRAIGHT = 'STRAIGHT',
  CURVE = 'CURVE',
  STEP = 'STEP'
}

export enum LineStyle {
  SOLID = 'SOLID',
  DASHED = 'DASHED',
  DOTTED = 'DOTTED'
}

export type PortDirection = 
  | 'top' | 'right' | 'bottom' | 'left'
  | 'top-start' | 'top-end'
  | 'right-start' | 'right-end'
  | 'bottom-start' | 'bottom-end'
  | 'left-start' | 'left-end'
  | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

export interface Point {
  x: number;
  y: number;
}

export interface DiagramElement {
  id: string;
  type: ToolType;
  x: number;
  y: number;
  width?: number; // For rect/circle
  height?: number; // For rect/circle
  
  // Connection Logic
  fromId?: string;
  toId?: string;
  fromPort?: PortDirection; // 记录连接的端口方向，实现吸附功能
  toPort?: PortDirection;   // 记录连接的端口方向，实现吸附功能
  endX?: number; // For arrow fallback
  endY?: number; // For arrow fallback
  offsetX?: number; // Manual offset for arrow position adjustment
  offsetY?: number; // Manual offset for arrow position adjustment
  
  // Style
  text?: string;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize?: number;
  icon?: string;
  
  // Line Specifics
  lineType?: LineType;
  lineStyle?: LineStyle;
  markerStart?: boolean;
  markerEnd?: boolean;
  labelPosition?: number; // 标签在线上的位置 0-1，默认 0.5（中点）
  
  // Group/Subgraph
  groupId?: string;  // 所属分组ID
}

export interface DiagramGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  fillColor?: string;
  strokeWidth?: number;
  strokeDasharray?: string;  // 虚线样式
}

export interface GenerationResponse {
  elements: {
    type: string;
    label?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    targetId?: string; 
  }[];
}

export interface GenerationHistory {
  id: string;
  prompt: string;
  image: string | null;
  timestamp: number;
}