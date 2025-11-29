import React, { useRef, useState, useEffect, useMemo, useImperativeHandle } from 'react';
import { DiagramElement, DiagramGroup, ToolType, Point, LineType, LineStyle, PortDirection } from '../types';
import * as Icons from 'lucide-react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

// --- Helper: Icon Renderer ---
const IconRenderer = ({ name, color, size }: { name?: string, color: string, size: number }) => {
  if (!name) return null;
  const camelName = name.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
  const pascalName = camelName.charAt(0).toUpperCase() + camelName.slice(1);
  // @ts-ignore
  const IconComponent = Icons[pascalName] || Icons[camelName] || Icons['Box'];
  return <IconComponent color={color} size={size} />;
};

// --- Helper: Smart Path Generation ---
// Defines ports on a node: Top, Right, Bottom, Left
type PortDir = 'up' | 'down' | 'left' | 'right';
interface Port { x: number; y: number; dir: PortDir; id: PortDirection }

const getPorts = (el: DiagramElement): Port[] => {
  const x = el.x;
  const y = el.y;
  const w = el.width || 0;
  const h = el.height || 0;
  return [
    // Main Centers (Indices 0-3)
    { x: x + w / 2, y: y, dir: 'up', id: 'top' },          // Top
    { x: x + w, y: y + h / 2, dir: 'right', id: 'right' },   // Right
    { x: x + w / 2, y: y + h, dir: 'down', id: 'bottom' },    // Bottom
    { x: x, y: y + h / 2, dir: 'left', id: 'left' },        // Left
    
    // Side Subdivisions (Indices 4-11)
    { x: x + w / 4, y: y, dir: 'up', id: 'top-start' },          // Top-Start (25%)
    { x: x + 3 * w / 4, y: y, dir: 'up', id: 'top-end' },      // Top-End (75%)
    
    { x: x + w, y: y + h / 4, dir: 'right', id: 'right-start' },   // Right-Start (25%)
    { x: x + w, y: y + 3 * h / 4, dir: 'right', id: 'right-end' },// Right-End (75%)
    
    { x: x + w / 4, y: y + h, dir: 'down', id: 'bottom-start' },    // Bottom-Start (25%)
    { x: x + 3 * w / 4, y: y + h, dir: 'down', id: 'bottom-end' },// Bottom-End (75%)
    
    { x: x, y: y + h / 4, dir: 'left', id: 'left-start' },        // Left-Start (25%)
    { x: x, y: y + 3 * h / 4, dir: 'left', id: 'left-end' },    // Left-End (75%)
    
    // Corners (Indices 12-15)
    { x: x, y: y, dir: 'up', id: 'top-left' },                  // Top-Left
    { x: x + w, y: y, dir: 'up', id: 'top-right' },              // Top-Right
    { x: x + w, y: y + h, dir: 'down', id: 'bottom-right' },        // Bottom-Right
    { x: x, y: y + h, dir: 'down', id: 'bottom-left' }             // Bottom-Left
  ];
};

// Apply offset to path data based on line type (for manual arrow position adjustment)
const applyOffsetToPath = (pathData: string, offsetX: number, offsetY: number, lineType: LineType): string => {
  if (!offsetX && !offsetY) return pathData;
  
  // For STRAIGHT lines: translate entire line without changing shape
  // offsetX and offsetY are already constrained to perpendicular direction in drag handler
  if (lineType === LineType.STRAIGHT) {
    const lineMatch = pathData.match(/M\s+([\d.-]+)\s+([\d.-]+)\s+L\s+([\d.-]+)\s+([\d.-]+)/);
    if (lineMatch) {
      const [, x1, y1, x2, y2] = lineMatch.map(Number);
      // Simply translate both points by the offset (which is already perpendicular)
      return `M ${x1 + offsetX} ${y1 + offsetY} L ${x2 + offsetX} ${y2 + offsetY}`;
    }
    return pathData;
  }
  
  // For STEP lines: regenerate with custom midX and midY offset
  if (lineType === LineType.STEP) {
    // Try to extract start and end points from path
    const parts = pathData.split(/\s+/);
    const startX = parseFloat(parts[1]);
    const startY = parseFloat(parts[2]);
    // Find last L command for end point
    const lastLIndex = pathData.lastIndexOf('L');
    let endX = 0, endY = 0;
    if (lastLIndex !== -1) {
      const afterL = pathData.substring(lastLIndex + 1).trim().split(/\s+/);
      endX = parseFloat(afterL[0]);
      endY = parseFloat(afterL[1]);
    } else {
      return pathData;
    }
    
    // For STEP lines:
    // - offsetX: moves the vertical segment horizontally (midX offset)
    // - offsetY: moves horizontal segments vertically (creates bend point)
    return getRoundedStepPathWithOffset(startX, startY, endX, endY, offsetX || 0, offsetY || 0);
  }
  
  // For CURVE lines: apply offset to control points
  if (lineType === LineType.CURVE) {
    const curveMatch = pathData.match(/M\s+([\d.-]+)\s+([\d.-]+)\s+C\s+([\d.-]+)\s+([\d.-]+),\s+([\d.-]+)\s+([\d.-]+),\s+([\d.-]+)\s+([\d.-]+)/);
    if (curveMatch) {
      const [, x1, y1, cp1x, cp1y, cp2x, cp2y, x2, y2] = curveMatch.map(Number);
      // Apply offset to control points only, keep start and end points fixed
      return `M ${x1} ${y1} C ${cp1x + offsetX} ${cp1y + offsetY}, ${cp2x + offsetX} ${cp2y + offsetY}, ${x2} ${y2}`;
    }
    return pathData;
  }
  
  return pathData;
};

// Helper function to generate rounded step line path with custom midX and midY offset
// 智能版：根据布局方向选择最佳路径模式
// Helper for single corner rounded path (L-shape)
const getRoundedLPath = (x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, radius: number): string => {
  const d1 = Math.sqrt(Math.pow(cx - x1, 2) + Math.pow(cy - y1, 2));
  const d2 = Math.sqrt(Math.pow(x2 - cx, 2) + Math.pow(y2 - cy, 2));
  
  const r = Math.min(radius, d1 * 0.45, d2 * 0.45);
  
  if (r < 3) return `M ${x1} ${y1} L ${cx} ${cy} L ${x2} ${y2}`;

  // Calculate start point of arc (on incoming segment)
  const dx1 = (x1 - cx) / d1;
  const dy1 = (y1 - cy) / d1;
  const ax = cx + dx1 * r;
  const ay = cy + dy1 * r;

  // Calculate end point of arc (on outgoing segment)
  const dx2 = (x2 - cx) / d2;
  const dy2 = (y2 - cy) / d2;
  const bx = cx + dx2 * r;
  const by = cy + dy2 * r;

  // Determine sweep flag
  // Vector 1 (incoming): (cx-x1, cy-y1)
  // Vector 2 (outgoing): (x2-cx, y2-cy)
  // Cross product z-component: (cx-x1)*(y2-cy) - (cy-y1)*(x2-cx)
  const cross = (cx - x1) * (y2 - cy) - (cy - y1) * (x2 - cx);
  const sweep = cross > 0 ? 1 : 0;

  return `M ${x1} ${y1} L ${ax} ${ay} A ${r} ${r} 0 0 ${sweep} ${bx} ${by} L ${x2} ${y2}`;
};

// Helper to determine port orientation
const isVerticalPort = (dir?: PortDirection): boolean => {
  if (!dir) return false;
  return dir.startsWith('top') || dir.startsWith('bottom');
};

const isHorizontalPort = (dir?: PortDirection): boolean => {
  if (!dir) return false;
  return dir.startsWith('left') || dir.startsWith('right');
};

const getRoundedStepPathWithOffset = (
  startX: number, startY: number, 
  endX: number, endY: number, 
  midXOffset: number = 0, midYOffset: number = 0, 
  disableSnap: boolean = false,
  startDir?: PortDirection,
  endDir?: PortDirection
): string => {
  // Ensure all inputs are valid numbers
  if (isNaN(startX) || isNaN(startY) || isNaN(endX) || isNaN(endY)) {
    return `M 0 0 L 0 0`;
  }
  
  let finalMidXOffset = midXOffset || 0;
  let finalMidYOffset = midYOffset || 0;

  const dx = endX - startX;
  const dy = endY - startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const radius = 10;
  const snapThreshold = 10;

  // 如果起点终点非常接近，直接直线
  if (absDx < 5 && absDy < 5) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  // Determine layout mode
  let isVerticalLayout = absDy > absDx;
  
  const startIsVert = startDir ? isVerticalPort(startDir) : null;
  const endIsVert = endDir ? isVerticalPort(endDir) : null;
  const startIsHoriz = startDir ? isHorizontalPort(startDir) : null;
  const endIsHoriz = endDir ? isHorizontalPort(endDir) : null;
  
  // Sticky mode based on offset usage (用户意图优先)
  if (Math.abs(finalMidYOffset) > 5 && Math.abs(finalMidXOffset) < 5) {
    isVerticalLayout = true; // Force VHV
  }
  else if (Math.abs(finalMidXOffset) > 5 && Math.abs(finalMidYOffset) < 5) {
    isVerticalLayout = false; // Force HVH
  }
  // Priority: Port Directions (if offsets are small/zero)
  // Logic improvement: Determine layout based on start/end directions more strictly
  else if (startIsVert !== null || endIsVert !== null) {
     // Default decisions
     if (startIsVert && endIsVert) {
        // Vertical -> Vertical: Prefer VHV (Horizontal middle segment)
        // Usually requires 3 segments: V -> H -> V
        // Current VHV logic: Start -> (v1_X, startY) -> ... is actually H-V-H-V-V... wait.
        // Let's look at VHV implementation:
        // Points: Start(startX, startY) -> (v1_X, startY) -> ...
        // The first segment (startX, startY) -> (v1_X, startY) is HORIZONTAL.
        // This is WRONG for Vertical Start.
        
        // Correct Logic:
        // If Start is Vertical, we need the first segment to be Vertical.
        // If Start is Horizontal, we need the first segment to be Horizontal.
        
        // Our current implementations:
        // "VHV" (isVerticalLayout=true):  Start -> (v1_X, startY) [Horizontal] ...  => Horizontal Start
        // "HVH" (isVerticalLayout=false): Start -> (startX, h1_Y) [Vertical] ...    => Vertical Start
        
        // So:
        // isVerticalLayout = true  => Horizontal First Segment
        // isVerticalLayout = false => Vertical First Segment
        
        // Mapping to desired behavior:
        // Start=Vertical   => Need Vertical First Segment   => use HVH (false)
        // Start=Horizontal => Need Horizontal First Segment => use VHV (true)
        
        // But wait, we also need to consider End direction.
        // End=Vertical   => Need Vertical Last Segment
        // End=Horizontal => Need Horizontal Last Segment
        
        // Let's check last segments:
        // VHV: ... -> (endX, endY) [Vertical]   => Vertical End
        // HVH: ... -> (endX, endY) [Horizontal] => Horizontal End
        
        // Conflict Resolution:
        // Case 1: Start=Vertical, End=Vertical
        //   Need: Vert Start, Vert End.
        //   HVH gives Vert Start, Horiz End. (Bad End)
        //   VHV gives Horiz Start, Vert End. (Bad Start)
        //   Solution: We need a specialized path or offset adjustment.
        //   If we use HVH, we get V-H-V-H. (Last seg is Horiz). 
        //   If we use VHV, we get H-V-H-V. (Last seg is Vert).
        
        //   Actually, let's look closer at HVH implementation:
        //   HVH: Start -> (startX, h1_Y) -> (midX, h1_Y) -> (midX, endY) -> (endX, endY)
        //   Seg 1: Vert
        //   Seg 2: Horiz
        //   Seg 3: Vert
        //   Seg 4: Horiz
        //   So HVH ends Horizontal.
        
        //   VHV: Start -> (v1_X, startY) -> (v1_X, midY) -> (endX, midY) -> (endX, endY)
        //   Seg 1: Horiz
        //   Seg 2: Vert
        //   Seg 3: Horiz
        //   Seg 4: Vert
        //   So VHV ends Vertical.
        
        // Case: Start=Vertical, End=Vertical
        // We want V-...-V.
        // Neither standard logic fits perfectly without offsets.
        // But usually V-H-V is preferred.
        // V-H-V implies: Start -> (startX, midY) -> (endX, midY) -> (endX, endY)
        // This matches HVH structure if midX = endX? No.
        // This matches HVH structure if we skip the last horizontal segment?
        // Actually, HVH with midX=endX gives: Start -> (startX, h1_Y) -> (endX, h1_Y) -> (endX, endY) -> (endX, endY)
        // = Start -> (startX, midY) -> (endX, midY) -> (endX, endY). 
        // This is exactly V-H-V!
        // So for Vert->Vert, we want HVH mode, but with midX forced to endX (or startX).
        
        isVerticalLayout = false; // Use HVH logic (starts Vertical)
        if (Math.abs(finalMidXOffset) < 1) {
           // Force midX to align with endX to create V-H-V look
           // We need midX to be endX?
           // HVH uses midX. 
           // If we set finalMidXOffset such that midX = endX...
           // midX = (startX + endX)/2 + off.  => off = endX - (startX+endX)/2 = (endX-startX)/2
           finalMidXOffset = dx / 2; 
        }
     }
     else if (startIsHoriz && endIsHoriz) {
        // Horizontal -> Horizontal: Prefer H-V-H
        // Need Horizontal Start (VHV mode)
        // Need Horizontal End (HVH mode)
        
        // VHV: H-V-H-V (Ends Vertical) - Bad
        // HVH: V-H-V-H (Starts Vertical) - Bad
        
        // We want H-V-H: Start -> (midX, startY) -> (midX, endY) -> (endX, endY)
        // This matches VHV if midY = endY?
        // VHV: Start -> (v1_X, startY) -> (v1_X, midY) -> (endX, midY) -> (endX, endY)
        // If midY = endY, then (endX, midY) is (endX, endY). Last segment length 0.
        // It becomes: Start -> (v1_X, startY) -> (v1_X, endY) -> (endX, endY).
        // This is H-V-H.
        // So for Horiz->Horiz, we want VHV mode, but with midY forced to endY.
        
        isVerticalLayout = true; // Use VHV logic (starts Horizontal)
        
        // Ensure midX is centered if not manually offset
        if (Math.abs(finalMidXOffset) < 1) {
            finalMidXOffset = dx / 2;
        }

        if (Math.abs(finalMidYOffset) < 1) {
           finalMidYOffset = dy / 2;
        }
     }
     else if (startIsVert && endIsHoriz) {
        // Vertical -> Horizontal
        // Need Vertical Start (HVH)
        // Need Horizontal End (HVH)
        // HVH matches perfectly: V-H-V-H.
        isVerticalLayout = false;
     }
     else if (startIsHoriz && endIsVert) {
        // Horizontal -> Vertical
        // Need Horizontal Start (VHV)
        // Need Vertical End (VHV)
        // VHV matches perfectly: H-V-H-V.
        isVerticalLayout = true;
     }
  }
  
  // Ensure minimum stub length to avoid "hugging" the edge
  const MIN_TARGET_STUB = 30;
  
  // For VHV (Horizontal start), we need min horizontal stub
  if (isVerticalLayout) { // VHV
     // If detected start direction is horizontal (or auto), ensure we move out horizontally first
     if (Math.abs(finalMidXOffset) < 20 && (!startIsVert)) {
        const isRight = startDir?.includes('right');
        const isLeft = startDir?.includes('left');
        // Determine direction based on target or port
        let dir = 1;
        if (isRight) dir = 1;
        else if (isLeft) dir = -1;
        else dir = (endX > startX) ? 1 : -1;
        
        finalMidXOffset = 20 * dir;
     }
     
     // Fix for Target Hugging in H-V-H mode (Horizontal End)
     // Check if we end effectively at the target Y (H-V-H structure)
     const tempMidY = (startY + endY) / 2 + finalMidYOffset;
     if (Math.abs(tempMidY - endY) < 1 || (startDir && endDir && !startIsVert && !endIsVert)) { 
        const v1_X = startX + finalMidXOffset;
        if (Math.abs(endX - v1_X) < MIN_TARGET_STUB) {
           finalMidXOffset = dx / 2;
        }
     }
  } 
  // For HVH (Vertical start), we need min vertical stub
  else { // HVH
     if (Math.abs(finalMidYOffset) < 20 && (!startIsHoriz)) {
        const isBottom = startDir?.includes('bottom');
        const isTop = startDir?.includes('top');
        
        let dir = 1;
        if (isBottom) dir = 1;
        else if (isTop) dir = -1;
        else dir = (endY > startY) ? 1 : -1;
        
        finalMidYOffset = 20 * dir;
     }
     
     // Fix for Target Hugging in HVH (Vertical Segment hugging Target Vertical Edge)
     // Path involves vertical segment at x = midX
     const midX = (startX + endX) / 2 + finalMidXOffset;
     if (Math.abs(midX - endX) < MIN_TARGET_STUB) {
        // Too close to target vertical edge.
        if (Math.abs(dx) > MIN_TARGET_STUB * 2.5) {
             finalMidXOffset = 0; // Force exact middle
        } else if (Math.abs(finalMidXOffset) < 1) {
             // Force detour if space is tight but overlapping
             // E.g. Top -> Left, but Top is directly above Left.
             finalMidXOffset = (dx >= 0) ? -50 : 50; 
        }
     }
  }

  if (isVerticalLayout) {
    // VHV mode with 5-segment support
    const midY = (startY + endY) / 2 + finalMidYOffset;
    const v1_X = startX + finalMidXOffset;
    
    // Points: Start(startX, startY) -> (v1_X, startY) -> (v1_X, midY) -> (endX, midY) -> (endX, endY)
    // Snap checks
    if (!disableSnap) {
       if (Math.abs(midY - endY) < snapThreshold) return getRoundedLPath(startX, startY, startX, endY, endX, endY, radius);
       if (Math.abs(midY - startY) < snapThreshold) return getRoundedLPath(startX, startY, endX, startY, endX, endY, radius);
    }
    
    // Calculate segments and arcs manually
    // Segment 1: (startX, startY) -> (v1_X, startY) [Horizontal]
    // Corner 1: Turn from H to V
    // Segment 2: (v1_X, startY) -> (v1_X, midY) [Vertical]
    // Corner 2: Turn from V to H
    // Segment 3: (v1_X, midY) -> (endX, midY) [Horizontal]
    // Corner 3: Turn from H to V
    // Segment 4: (endX, midY) -> (endX, endY) [Vertical]
    
    const seg1_len = Math.abs(v1_X - startX);
    const seg2_len = Math.abs(midY - startY);
    const seg3_len = Math.abs(endX - v1_X);
    const seg4_len = Math.abs(endY - midY);
    
    const actualRadius = Math.min(radius, seg1_len * 0.45, seg2_len * 0.45, seg3_len * 0.45, seg4_len * 0.45);
    
    if (actualRadius < 3) {
      // No arcs, straight corners
      return `M ${startX} ${startY} L ${v1_X} ${startY} L ${v1_X} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
    }
    
    // With arcs
    const goingRight1 = v1_X > startX;
    const goingDown2 = midY > startY;
    const goingRight3 = endX > v1_X;
    const goingDown4 = endY > midY;
    
    // Corner 1: H->V at (v1_X, startY)
    const c1_hEnd = goingRight1 ? v1_X - actualRadius : v1_X + actualRadius;
    const c1_vStart = goingDown2 ? startY + actualRadius : startY - actualRadius;
    const sweep1 = (goingRight1 === goingDown2) ? 1 : 0;
    
    // Corner 2: V->H at (v1_X, midY)
    const c2_vEnd = goingDown2 ? midY - actualRadius : midY + actualRadius;
    const c2_hStart = goingRight3 ? v1_X + actualRadius : v1_X - actualRadius;
    const sweep2 = (goingDown2 === goingRight3) ? 0 : 1;
    
    // Corner 3: H->V at (endX, midY)
    const c3_hEnd = goingRight3 ? endX - actualRadius : endX + actualRadius;
    const c3_vStart = goingDown4 ? midY + actualRadius : midY - actualRadius;
    const sweep3 = (goingRight3 === goingDown4) ? 1 : 0;
    
    return `M ${startX} ${startY} L ${c1_hEnd} ${startY} A ${actualRadius} ${actualRadius} 0 0 ${sweep1} ${v1_X} ${c1_vStart} L ${v1_X} ${c2_vEnd} A ${actualRadius} ${actualRadius} 0 0 ${sweep2} ${c2_hStart} ${midY} L ${c3_hEnd} ${midY} A ${actualRadius} ${actualRadius} 0 0 ${sweep3} ${endX} ${c3_vStart} L ${endX} ${endY}`;
    
  } else {
    // HVH mode with 5-segment support
    const midX = (startX + endX) / 2 + finalMidXOffset;
    const h1_Y = startY + finalMidYOffset;
    
    // Points: Start(startX, startY) -> (startX, h1_Y) -> (midX, h1_Y) -> (midX, endY) -> (endX, endY)
    // Snap checks
    if (!disableSnap) {
       if (Math.abs(midX - endX) < snapThreshold) return getRoundedLPath(startX, startY, endX, startY, endX, endY, radius);
       if (Math.abs(midX - startX) < snapThreshold) return getRoundedLPath(startX, startY, startX, endY, endX, endY, radius);
    }
    
    const seg1_len = Math.abs(h1_Y - startY);
    const seg2_len = Math.abs(midX - startX);
    const seg3_len = Math.abs(endY - h1_Y);
    const seg4_len = Math.abs(endX - midX);
    
    const actualRadius = Math.min(radius, seg1_len * 0.45, seg2_len * 0.45, seg3_len * 0.45, seg4_len * 0.45);
    
    if (actualRadius < 3) {
      return `M ${startX} ${startY} L ${startX} ${h1_Y} L ${midX} ${h1_Y} L ${midX} ${endY} L ${endX} ${endY}`;
    }
    
    const goingDown1 = h1_Y > startY;
    const goingRight2 = midX > startX;
    const goingDown3 = endY > h1_Y;
    const goingRight4 = endX > midX;
    
    // Corner 1: V->H at (startX, h1_Y)
    const c1_vEnd = goingDown1 ? h1_Y - actualRadius : h1_Y + actualRadius;
    const c1_hStart = goingRight2 ? startX + actualRadius : startX - actualRadius;
    const sweep1 = (goingDown1 === goingRight2) ? 0 : 1;
    
    // Corner 2: H->V at (midX, h1_Y)
    const c2_hEnd = goingRight2 ? midX - actualRadius : midX + actualRadius;
    const c2_vStart = goingDown3 ? h1_Y + actualRadius : h1_Y - actualRadius;
    const sweep2 = (goingRight2 === goingDown3) ? 1 : 0;
    
    // Corner 3: V->H at (midX, endY)
    const c3_vEnd = goingDown3 ? endY - actualRadius : endY + actualRadius;
    const c3_hStart = goingRight4 ? midX + actualRadius : midX - actualRadius;
    const sweep3 = (goingDown3 === goingRight4) ? 0 : 1;
    
    return `M ${startX} ${startY} L ${startX} ${c1_vEnd} A ${actualRadius} ${actualRadius} 0 0 ${sweep1} ${c1_hStart} ${h1_Y} L ${c2_hEnd} ${h1_Y} A ${actualRadius} ${actualRadius} 0 0 ${sweep2} ${midX} ${c2_vStart} L ${midX} ${c3_vEnd} A ${actualRadius} ${actualRadius} 0 0 ${sweep3} ${c3_hStart} ${endY} L ${endX} ${endY}`;
  }
};

// Helper function to generate rounded step line path (飞书风格 - 外凸圆角)
const getRoundedStepPath = (startX: number, startY: number, endX: number, endY: number, startDir?: PortDirection, endDir?: PortDirection): string => {
  return getRoundedStepPathWithOffset(startX, startY, endX, endY, 0, 0, false, startDir, endDir);
};

// Helper function to select best port pair based on layout
const selectBestPorts = (from: DiagramElement, to: DiagramElement): { fromPort: Port; toPort: Port } => {
  const fromPorts = getPorts(from);
  const toPorts = getPorts(to);

  // Calculate element centers for direction detection
  const fromCenterX = from.x + (from.width || 0) / 2;
  const fromCenterY = from.y + (from.height || 0) / 2;
  const toCenterX = to.x + (to.width || 0) / 2;
  const toCenterY = to.y + (to.height || 0) / 2;
  
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;
  
  // Determine primary direction based on layout
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  
  // Default fallback ports (usually middle-bottom to middle-top)
  let fromPort: Port = fromPorts[2]; // bottom
  let toPort: Port = toPorts[0];     // top
  
  // Smart heuristic for primary direction
  if (absDy > absDx) {
    // Vertical layout
    if (dy > 0) { // from above to
      fromPort = fromPorts[2]; // bottom
      toPort = toPorts[0];     // top
    } else { // from below to
      fromPort = fromPorts[0]; // top
      toPort = toPorts[2];     // bottom
    }
  } else {
    // Horizontal layout
    if (dx > 0) { // from left to right
      fromPort = fromPorts[1]; // right
      toPort = toPorts[3];     // left
    } else { // from right to left
      fromPort = fromPorts[3]; // left
      toPort = toPorts[1];     // right
    }
  }
  
  // Optimization: Find the closest pair, but prioritize edge centers
  // Indices 0-3: Main Centers (Priority 1)
  // Indices 4-11: Side Subdivisions (Priority 2)
  // Indices 12-15: Corners (Priority 3 - Avoid if possible)
  
  let minDist = Infinity;
  let bestFromPort = fromPort;
  let bestToPort = toPort;
  
  // Heuristic baseline distance
  const heuristicDist = Math.sqrt(Math.pow(fromPort.x - toPort.x, 2) + Math.pow(fromPort.y - toPort.y, 2));
  minDist = heuristicDist;

  // Iterate all combinations to find a significantly better path
  // We apply penalties to lower priority ports to discourage their use unless necessary
  for (let i = 0; i < fromPorts.length; i++) {
    // Skip corners (12-15) unless absolutely necessary (e.g. very close nodes)
    if (i >= 12) continue; 
    
    for (let j = 0; j < toPorts.length; j++) {
      if (j >= 12) continue;

      const fp = fromPorts[i];
      const tp = toPorts[j];
      
      let dist = Math.sqrt(Math.pow(fp.x - tp.x, 2) + Math.pow(fp.y - tp.y, 2));
      
      // Apply penalties
      // Priority 1 (0-3): No penalty
      // Priority 2 (4-11): Small penalty (+20px effective distance)
      if (i >= 4) dist += 20;
      if (j >= 4) dist += 20;
      
      // If this port pair is significantly better (shorter) than current best, pick it
      if (dist < minDist) {
        minDist = dist;
        bestFromPort = fp;
        bestToPort = tp;
      }
    }
  }
  
  return { fromPort: bestFromPort, toPort: bestToPort };
};

// Helper to get point on line based on t (0-1)
// Improved: Find the center of the longest segment for STEP lines
const getPointOnLine = (
  from: Point, 
  to: Point, 
  t: number, 
  type: LineType = LineType.STRAIGHT, 
  offset: Point = { x: 0, y: 0 }
): Point => {
  // Default straight line interpolation
  if (type === LineType.STRAIGHT) {
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t
    };
  }

  if (type === LineType.STEP) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    // Handle straight line case (when aligned)
    if (absDx < 5 || absDy < 5) {
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t
      };
    }

    const isVerticalLayout = absDy > absDx; // Simplistic check, real logic handles offsets
    // Note: To perfectly match the rendered path, we should duplicate the layout logic from getRoundedStepPathWithOffset.
    // For now, we use a heuristic: find longest segment from standard VHV/HVH.
    
    let segments: {start: Point, end: Point, len: number}[] = [];
    
    // Try to reconstruct segments based on offsets
    // This is a simplified reconstruction
    if (Math.abs(offset.y) > 5 && Math.abs(offset.x) < 5) {
       // VHV-like (Vertical mid segment) -> actually this implies HVH structure in our code logic?
       // Let's check Canvas logic:
       // if (Math.abs(midYOffset) > 5 && Math.abs(midXOffset) < 5) isVerticalLayout = true;
       // Wait, isVerticalLayout=true is VHV (H-V-H-V).
       // And VHV uses midY? No, VHV uses midY and v1_X.
       // v1_X = startX + midXOffset. midY = (sY+eY)/2 + midYOffset.
       // Segments: (sX,sY)->(v1X,sY)->(v1X,midY)->(eX,midY)->(eX,eY)
       const midY = (from.y + to.y) / 2 + offset.y;
       const v1X = from.x + offset.x;
       segments = [
         { start: from, end: { x: v1X, y: from.y }, len: Math.abs(v1X - from.x) },
         { start: { x: v1X, y: from.y }, end: { x: v1X, y: midY }, len: Math.abs(midY - from.y) },
         { start: { x: v1X, y: midY }, end: { x: to.x, y: midY }, len: Math.abs(to.x - v1X) },
         { start: { x: to.x, y: midY }, end: { x: to.x, y: to.y }, len: Math.abs(to.y - midY) }
       ];
    } else {
       // Default or HVH
       // HVH: (sX,sY)->(sX,h1Y)->(midX,h1Y)->(midX,eY)->(eX,eY)
       const midX = (from.x + to.x) / 2 + offset.x;
       const h1Y = from.y + offset.y;
       segments = [
         { start: from, end: { x: from.x, y: h1Y }, len: Math.abs(h1Y - from.y) },
         { start: { x: from.x, y: h1Y }, end: { x: midX, y: h1Y }, len: Math.abs(midX - from.x) },
         { start: { x: midX, y: h1Y }, end: { x: midX, y: to.y }, len: Math.abs(to.y - h1Y) },
         { start: { x: midX, y: to.y }, end: { x: to.x, y: to.y }, len: Math.abs(to.x - midX) }
       ];
    }
    
    // Find longest segment
    let maxLen = -1;
    let longestSeg = segments[0];
    for (const seg of segments) {
        if (seg.len > maxLen) {
            maxLen = seg.len;
            longestSeg = seg;
        }
    }
    
    // Return midpoint of longest segment
    return {
        x: (longestSeg.start.x + longestSeg.end.x) / 2,
        y: (longestSeg.start.y + longestSeg.end.y) / 2
    };
  }
  
  // CURVE fallback
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t
  };
};

// Helper to calculate t on line nearest to point
const getTOnLine = (
  point: Point,
  from: Point, 
  to: Point, 
  type: LineType = LineType.STRAIGHT, 
  offset: Point = { x: 0, y: 0 }
): number => {
  // Helper for point to segment distance and t
  const projectToSegment = (p: Point, s1: Point, s2: Point) => {
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { distSq: (p.x-s1.x)**2 + (p.y-s1.y)**2, t: 0 };
    
    let t = ((p.x - s1.x) * dx + (p.y - s1.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    
    const projX = s1.x + t * dx;
    const projY = s1.y + t * dy;
    return {
      distSq: (p.x - projX)**2 + (p.y - projY)**2,
      t,
      proj: { x: projX, y: projY }
    };
  };

  if (type === LineType.STEP) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    // Handle straight line case
    if (absDx < 5 || absDy < 5) {
      return projectToSegment(point, from, to).t;
    }

    const isVerticalLayout = absDy > absDx;
    let segments: { start: Point, end: Point, len: number }[] = [];
    
    if (isVerticalLayout) {
      const midY = (from.y + to.y) / 2 + offset.y;
      segments = [
        { start: from, end: { x: from.x, y: midY }, len: Math.abs(midY - from.y) },
        { start: { x: from.x, y: midY }, end: { x: to.x, y: midY }, len: Math.abs(to.x - from.x) },
        { start: { x: to.x, y: midY }, end: { x: to.x, y: to.y }, len: Math.abs(to.y - midY) }
      ];
    } else {
      const midX = (from.x + to.x) / 2 + offset.x;
      segments = [
        { start: from, end: { x: midX, y: from.y }, len: Math.abs(midX - from.x) },
        { start: { x: midX, y: from.y }, end: { x: midX, y: to.y }, len: Math.abs(to.y - from.y) },
        { start: { x: midX, y: to.y }, end: { x: to.x, y: to.y }, len: Math.abs(to.x - midX) }
      ];
    }
    
    const totalLen = segments.reduce((sum, s) => sum + s.len, 0);
    if (totalLen === 0) return 0;

    let minDistSq = Infinity;
    let bestGlobalT = 0;
    let currentLen = 0;

    for (const seg of segments) {
      const { distSq, t: localT } = projectToSegment(point, seg.start, seg.end);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        bestGlobalT = (currentLen + localT * seg.len) / totalLen;
      }
      currentLen += seg.len;
    }
    return bestGlobalT;
  }
  
  // Straight line fallback
  return projectToSegment(point, from, to).t;
};

const getSmartPath = (
  from: DiagramElement, 
  to: DiagramElement, 
  lineType: LineType
): string => {
  const { fromPort: start, toPort: end } = selectBestPorts(from, to);

  if (lineType === LineType.STRAIGHT) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  if (lineType === LineType.STEP) {
    return getRoundedStepPath(start.x, start.y, end.x, end.y);
  }

  // CURVE (Bezier)
  // Calculate control points based on direction
  const dist = Math.sqrt(Math.pow(start.x - end.x, 2) + Math.pow(start.y - end.y, 2));
  const controlDist = Math.min(dist * 0.5, 150); // Cap curvature

  const getControlPoint = (p: Port, dist: number) => {
    switch (p.dir) {
      case 'up': return { x: p.x, y: p.y - dist };
      case 'down': return { x: p.x, y: p.y + dist };
      case 'left': return { x: p.x - dist, y: p.y };
      case 'right': return { x: p.x + dist, y: p.y };
    }
  };

  const cp1 = getControlPoint(start, controlDist);
  const cp2 = getControlPoint(end, controlDist);

  return `M ${start.x} ${start.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${end.x} ${end.y}`;
};


interface CanvasProps {
  elements: DiagramElement[];
  setElements: React.Dispatch<React.SetStateAction<DiagramElement[]>>;
  selectedTool: ToolType;
  setSelectedTool: (t: ToolType) => void;
  selectedElementIds: string[];
  setSelectedElementIds: (ids: string[]) => void;
  onHistorySave: () => void;
}

export interface CanvasRef {
  fitView: () => void;
}

export const Canvas = React.forwardRef<CanvasRef, CanvasProps>(({
  elements,
  setElements,
  selectedTool,
  setSelectedTool,
  selectedElementIds,
  setSelectedElementIds,
  onHistorySave
}, ref) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useImperativeHandle(ref, () => ({
    fitView: (elementsOverride) => {
      const els = elementsOverride || elements;
      if (els.length === 0) return;
      
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      els.forEach(el => {
        minX = Math.min(minX, el.x);
        minY = Math.min(minY, el.y);
        maxX = Math.max(maxX, el.x + (el.width || 0));
        maxY = Math.max(maxY, el.y + (el.height || 0));
        if (el.type === ToolType.ARROW) {
           maxX = Math.max(maxX, el.endX || el.x);
           maxY = Math.max(maxY, el.endY || el.y);
        }
      });
      
      if (!isFinite(minX)) return;

      const padding = 150; // Increased padding
      const width = maxX - minX + padding * 2;
      const height = maxY - minY + padding * 2;
      
      const container = svgRef.current?.parentElement;
      if (!container) return;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      
      if (containerWidth === 0 || containerHeight === 0) return;

      const scaleX = containerWidth / width;
      const scaleY = containerHeight / height;
      
      // User feedback: "Show at 100%, don't shrink". 
      // We prioritize 100% scale and just center the content.
      // Only shrink if it's EXTREMELY large (e.g. < 50% visible), or maybe not even then?
      // The user explicitly complained about 48%. 
      // Let's try to keep it at 1.0 unless it's absolutely massive, or strictly 1.0.
      
      // Strict 1.0 approach as requested:
      let newScale = 1.0;
      
      // Optional: if it's really small, we could fit it? No, user wants 100%.
      
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      
      const newPanX = containerWidth / 2 - centerX * newScale;
      const newPanY = containerHeight / 2 - centerY * newScale;
      
      setScale(newScale);
      setPan({ x: newPanX, y: newPanY });
    }
  }), [elements]);
  
  // State for interactions
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [currentElementId, setCurrentElementId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point | null>(null);
  const [hasMoved, setHasMoved] = useState(false);
  
  // Connection point dragging
  const [draggingConnectionPoint, setDraggingConnectionPoint] = useState<'from' | 'to' | null>(null);
  const [tempConnectionPoint, setTempConnectionPoint] = useState<Point | null>(null);
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  
  // Group dragging
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [groupDragOffset, setGroupDragOffset] = useState<Point | null>(null);
  
  // Resize handles
  const [resizingHandle, setResizingHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const [resizeStartSize, setResizeStartSize] = useState<{ width: number; height: number; x: number; y: number } | null>(null);
  
  // Creating arrow from connection point
  const [creatingArrowFrom, setCreatingArrowFrom] = useState<{ elementId: string; port: 'top' | 'right' | 'bottom' | 'left'; point: Point } | null>(null);
  const [tempArrowEnd, setTempArrowEnd] = useState<Point | null>(null);
  
  // Track which segment of step line is being dragged
  const [draggingStepSegment, setDraggingStepSegment] = useState<'horizontal' | 'vertical' | null>(null);
  // Ref to store drag state for smoother interactions (avoids async state issues)
  const dragStateRef = useRef<{ startPos: Point; initialOffsetX: number; initialOffsetY: number } | null>(null);
  
  // Track label dragging on arrow
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null);
  
  // Viewport State
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState<Point | null>(null);
  const [showGrid, setShowGrid] = useState(true);

  // Helper to get mouse position in SVG coordinates
  const getMousePos = (e: React.MouseEvent): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    // We must account for scale and pan manually because we are untransforming the client coordinates
    // relative to the DOM element, not using CTM which might get complex with nested transforms.
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - pan.x) / scale,
      y: (e.clientY - rect.top - pan.y) / scale,
    };
  };

  // --- Zoom Handlers ---
  const handleWheel = (e: WheelEvent) => {
    // Prevent default browser zoom behavior if ctrl is pressed
    if (e.ctrlKey) {
      e.preventDefault();
      const zoomSensitivity = 0.001;
      const delta = -e.deltaY * zoomSensitivity;
      const newScale = Math.min(Math.max(0.1, scale + delta), 5);
      
      // Zoom towards pointer logic could go here, but center zoom is safer for now
      // Simple zoom
      setScale(newScale);
    } else {
      // Pan
      setPan(prev => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
    }
  };

  // Add non-passive listener for wheel to prevent default pinch-zoom behavior on trackpads
  useEffect(() => {
    const el = svgRef.current;
    if (el) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, [scale, pan]);

  const handleZoomIn = () => setScale(s => Math.min(s * 1.2, 5));
  const handleZoomOut = () => setScale(s => Math.max(s / 1.2, 0.1));
  const handleResetZoom = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };


  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    const pos = getMousePos(e); 
    const clientPos = { x: e.clientX, y: e.clientY }; 

    // Middle click or Spacebar (handled by caller usually) or just Select tool on bg
    if (selectedTool === ToolType.SELECT || e.button === 1) {
       setSelectedElementIds([]);
       setIsPanning(true);
       setLastMousePos(clientPos);
    } else {
       onHistorySave();
       setIsDrawing(true);
       setHasMoved(true);
       setDragStart(pos);
       const newId = `el_${Date.now()}`;
       setCurrentElementId(newId);

       const newElement: DiagramElement = {
         id: newId,
         type: selectedTool,
         x: pos.x,
         y: pos.y,
         width: 0,
         height: 0,
         strokeColor: '#000000',
         fillColor: selectedTool === ToolType.TEXT || selectedTool === ToolType.ARROW ? 'transparent' : '#ffffff',
         strokeWidth: 2,
         text: selectedTool === ToolType.TEXT ? 'Text' : '',
         fontSize: 16,
         endX: pos.x,
         endY: pos.y,
         lineType: LineType.STRAIGHT, // Default to straight for consistency
         lineStyle: LineStyle.SOLID,
         markerEnd: true
       };

       setElements(prev => [...prev, newElement]);
    }
  };

  // Helper to find group at a given point (for drag-and-drop into group)
  const findGroupAtPoint = (pos: Point, excludeGroupIds: string[] = []): string | null => {
    const groups = elements.filter(el => el.type === ToolType.GROUP && !excludeGroupIds.includes(el.id));
    
    for (const group of groups) {
      if (pos.x >= group.x && pos.x <= group.x + (group.width || 0) &&
          pos.y >= group.y && pos.y <= group.y + (group.height || 0)) {
        return group.id;
      }
    }
    return null;
  };

  // Check if point is near an element (for connection snapping)
  const findNearestElement = (pos: Point, useExactPosition: boolean = false): { id: string; point: Point; port?: PortDirection } | null => {
    let nearest: { id: string; point: Point; dist: number; port?: PortDirection } | null = null;
    const snapDistance = 50;
    const exactSnapDistance = 30; // Increased from 15 to 30 for easier edge detection
    const portDirections: PortDirection[] = [
      'top', 'right', 'bottom', 'left',
      'top-start', 'top-end',
      'right-start', 'right-end',
      'bottom-start', 'bottom-end',
      'left-start', 'left-end',
      'top-left', 'top-right', 'bottom-right', 'bottom-left'
    ];

    elements.forEach(el => {
      if (el.type === ToolType.ARROW || selectedElementIds.includes(el.id)) return;
      
      // Check if point is inside element bounds
      const w = el.width || 0;
      const h = el.height || 0;
      const isInside = pos.x >= el.x && pos.x <= el.x + w && pos.y >= el.y && pos.y <= el.y + h;
      
      // For exact positioning, also check if near the element (expanded boundary)
      const margin = 30; // Extra margin around element for detection
      const isNearElement = pos.x >= el.x - margin && pos.x <= el.x + w + margin && 
                           pos.y >= el.y - margin && pos.y <= el.y + h + margin;
      
      if (isInside || isNearElement || !useExactPosition) {
        const ports = getPorts(el);
        ports.forEach((port, index) => {
          const dist = Math.sqrt(Math.pow(pos.x - port.x, 2) + Math.pow(pos.y - port.y, 2));
          const threshold = useExactPosition ? exactSnapDistance : snapDistance;
          if (dist < threshold && (!nearest || dist < nearest.dist)) {
            nearest = { id: el.id, point: port, dist, port: portDirections[index] };
          }
        });
        
        // If inside element but not close to any port, find the nearest port
        if (isInside && !nearest && useExactPosition) {
          const ports = getPorts(el);
          let minDist = Infinity;
          let nearestPortIndex = 0;
          ports.forEach((port, index) => {
            const dist = Math.sqrt(Math.pow(pos.x - port.x, 2) + Math.pow(pos.y - port.y, 2));
            if (dist < minDist) {
              minDist = dist;
              nearestPortIndex = index;
            }
          });
          nearest = { id: el.id, point: ports[nearestPortIndex], dist: minDist, port: portDirections[nearestPortIndex] };
        }
      }
    });

    return nearest ? { id: nearest.id, point: nearest.point, port: nearest.port } : null;
  };

  const handleElementMouseDown = (e: React.MouseEvent, elementId: string) => {
    if (selectedTool !== ToolType.SELECT) return; 

    e.stopPropagation(); 
    
    const pos = getMousePos(e);
    const element = elements.find(el => el.id === elementId);
    
    if (!element) return;

    // Check if clicking on connection point of selected arrow
    if (element.type === ToolType.ARROW && selectedElementIds.includes(elementId)) {
      const fromNode = element.fromId ? nodeMap.get(element.fromId) : null;
      const toNode = element.toId ? nodeMap.get(element.toId) : null;
      
      // Calculate connection points
      let fromPoint: Point | null = null;
      let toPoint: Point | null = null;
      
      if (fromNode && toNode) {
        const fromPorts = getPorts(fromNode as DiagramElement);
        const toPorts = getPorts(toNode as DiagramElement);
        // Find closest port pair (simplified)
        fromPoint = fromPorts[2]; // bottom
        toPoint = toPorts[0]; // top
      } else {
        fromPoint = { x: element.x, y: element.y };
        toPoint = { x: element.endX || element.x, y: element.endY || element.y };
      }

      // Check if clicking near connection points
      const fromDist = fromPoint ? Math.sqrt(Math.pow(pos.x - fromPoint.x, 2) + Math.pow(pos.y - fromPoint.y, 2)) : Infinity;
      const toDist = toPoint ? Math.sqrt(Math.pow(pos.x - toPoint.x, 2) + Math.pow(pos.y - toPoint.y, 2)) : Infinity;
      const handleRadius = 15;

      if (fromDist < handleRadius) {
        setDraggingConnectionPoint('from');
        setTempConnectionPoint(pos);
        setIsDrawing(true);
        setDraggingStepSegment(null);
        return;
      } else if (toDist < handleRadius) {
        setDraggingConnectionPoint('to');
        setTempConnectionPoint(pos);
        setIsDrawing(true);
        setDraggingStepSegment(null);
        return;
      }
      
      // For step lines, detect which segment is clicked
      if (element.lineType === LineType.STEP && fromPoint && toPoint) {
        const dx = toPoint.x - fromPoint.x;
        const dy = toPoint.y - fromPoint.y;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        
        // Determine layout mode (must match rendering logic)
        let isVerticalLayout = absDy > absDx;
        if (Math.abs(element.offsetX || 0) > 1 && Math.abs(element.offsetY || 0) < 1) {
          isVerticalLayout = false;
        } else if (Math.abs(element.offsetY || 0) > 1 && Math.abs(element.offsetX || 0) < 1) {
          isVerticalLayout = true;
        }
        
        if (isVerticalLayout) {
          // VHV: Start -> V -> H -> V -> End
          // Middle Horizontal Segment
          const midY = (fromPoint.y + toPoint.y) / 2 + (element.offsetY || 0);
          const distToMidHoriz = Math.abs(pos.y - midY);
          const isOnMidHoriz = pos.x >= Math.min(fromPoint.x, toPoint.x) - 10 && 
                              pos.x <= Math.max(fromPoint.x, toPoint.x) + 10 && 
                              distToMidHoriz < 20;
          
          // Vertical Segments (approximate)
          const isOnFirstVert = Math.abs(pos.x - fromPoint.x) < 20 && 
                               pos.y >= Math.min(fromPoint.y, midY) - 10 && 
                               pos.y <= Math.max(fromPoint.y, midY) + 10;
                               
          const isOnSecondVert = Math.abs(pos.x - toPoint.x) < 20 && 
                                pos.y >= Math.min(midY, toPoint.y) - 10 && 
                                pos.y <= Math.max(midY, toPoint.y) + 10;
                                
          if (isOnMidHoriz) {
            setDraggingStepSegment('horizontal');
            setDragStart(pos);
          } else if (isOnFirstVert || isOnSecondVert) {
            setDraggingStepSegment('vertical'); // This allows switching to HVH by dragging verticals
            setDragStart(pos);
          } else {
            setDraggingStepSegment(null);
          }
        } else {
          // HVH: Start -> H -> V -> H -> End
          // Middle Vertical Segment
          const midX = (fromPoint.x + toPoint.x) / 2 + (element.offsetX || 0);
          const distToMidVert = Math.abs(pos.x - midX);
          const isOnMidVert = pos.y >= Math.min(fromPoint.y, toPoint.y) - 10 && 
                             pos.y <= Math.max(fromPoint.y, toPoint.y) + 10 && 
                             distToMidVert < 20;
                             
          // Horizontal Segments (approximate)
          const isOnFirstHoriz = Math.abs(pos.y - fromPoint.y) < 20 && 
                                pos.x >= Math.min(fromPoint.x, midX) - 10 && 
                                pos.x <= Math.max(fromPoint.x, midX) + 10;
                                
          const isOnSecondHoriz = Math.abs(pos.y - toPoint.y) < 20 && 
                                 pos.x >= Math.min(midX, toPoint.x) - 10 && 
                                 pos.x <= Math.max(midX, toPoint.x) + 10;
                                 
          if (isOnMidVert) {
            setDraggingStepSegment('vertical');
            setDragStart(pos);
          } else if (isOnFirstHoriz || isOnSecondHoriz) {
            setDraggingStepSegment('horizontal'); // This allows switching to VHV by dragging horizontals
            setDragStart(pos);
          } else {
            setDraggingStepSegment(null);
          }
        }
      } else {
        setDraggingStepSegment(null);
      }
    }
    
    // Check if clicking on resize handle or connection point
    const isElementSelected = selectedElementIds.includes(elementId);
    if (isElementSelected && element.type !== ToolType.ARROW && element.type !== ToolType.TEXT) {
      const w = element.width || 0;
      const h = element.height || 0;
      const threshold = 15; // Click detection area
      
      // Calculate corner positions for resize
      const corners = {
        nw: { x: element.x, y: element.y },
        ne: { x: element.x + w, y: element.y },
        sw: { x: element.x, y: element.y + h },
        se: { x: element.x + w, y: element.y + h }
      };
      
      // Check which corner is clicked (resize handles have priority)
      for (const [corner, cornerPos] of Object.entries(corners)) {
        const dist = Math.sqrt(Math.pow(pos.x - cornerPos.x, 2) + Math.pow(pos.y - cornerPos.y, 2));
        if (dist < threshold) {
          e.stopPropagation();
          setResizingHandle(corner as 'nw' | 'ne' | 'sw' | 'se');
          setResizeStartSize({ width: w, height: h, x: element.x, y: element.y });
          setDragStart(pos);
          setIsDrawing(true);
          setHasMoved(false);
          onHistorySave();
          return;
        }
      }
      
      // Check connection points (midpoints of edges)
      const connectionPoints = {
        top: { x: element.x + w / 2, y: element.y },
        right: { x: element.x + w, y: element.y + h / 2 },
        bottom: { x: element.x + w / 2, y: element.y + h },
        left: { x: element.x, y: element.y + h / 2 }
      };
      
      for (const [port, portPos] of Object.entries(connectionPoints)) {
        const dist = Math.sqrt(Math.pow(pos.x - portPos.x, 2) + Math.pow(pos.y - portPos.y, 2));
        if (dist < threshold) {
          e.stopPropagation();
          setCreatingArrowFrom({ 
            elementId: elementId, 
            port: port as 'top' | 'right' | 'bottom' | 'left',
            point: portPos
          });
          setTempArrowEnd(portPos);
          setDragStart(portPos);
          setIsDrawing(true);
          setHasMoved(false);
          onHistorySave();
          return;
        }
      }
    }
    
    // Normal element selection/dragging
    // Multi-selection support: Cmd/Ctrl click toggles selection
    if (e.metaKey || e.ctrlKey) {
      if (selectedElementIds.includes(elementId)) {
        // Deselect
        setSelectedElementIds(selectedElementIds.filter(id => id !== elementId));
      } else {
        // Add to selection
        setSelectedElementIds([...selectedElementIds, elementId]);
      }
      return; // Don't start dragging on multi-select toggle
    } else {
      // Single selection: only reset if clicking on unselected element
      // If clicking on already selected element in multi-selection, keep all selected
      if (!selectedElementIds.includes(elementId)) {
        setSelectedElementIds([elementId]);
      }
      // Otherwise, keep current selection (allows dragging multiple selected elements)
    }
    setDragStart(pos);
    
    // For arrows connected to elements, calculate offset from center of arrow
    if (element.type === ToolType.ARROW && (element.fromId || element.toId)) {
      // Calculate arrow center point
      let centerX = 0, centerY = 0;
      if (element.fromId && element.toId) {
        const fromNode = nodeMap.get(element.fromId);
        const toNode = nodeMap.get(element.toId);
        if (fromNode && toNode) {
          const { fromPort: bestFrom, toPort: bestTo } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
          centerX = (bestFrom.x + bestTo.x) / 2;
          centerY = (bestFrom.y + bestTo.y) / 2;
        }
      } else {
        centerX = (element.x + (element.endX || element.x)) / 2;
        centerY = (element.y + (element.endY || element.y)) / 2;
      }
      
      // Calculate offset from current position
      const currentOffsetX = element.offsetX || 0;
      const currentOffsetY = element.offsetY || 0;
      setDragOffset({ 
        x: pos.x - (centerX + currentOffsetX), 
        y: pos.y - (centerY + currentOffsetY) 
      });
    } else {
      setDragOffset({ x: pos.x - element.x, y: pos.y - element.y });
    }
    
    setIsDrawing(true);
    setHasMoved(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getMousePos(e);
    const clientPos = { x: e.clientX, y: e.clientY };

    if (isPanning && lastMousePos) {
      const dx = clientPos.x - lastMousePos.x;
      const dy = clientPos.y - lastMousePos.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastMousePos(clientPos);
      return;
    }

    // Handle creating arrow from connection point
    if (creatingArrowFrom) {
      setTempArrowEnd(pos);
      
      // Check for snapping to nearby elements - use exact positioning for better detection
      const nearest = findNearestElement(pos, true);
      setHoveredElementId(nearest?.id || null);
      
      return;
    }

    // Handle connection point dragging
    if (draggingConnectionPoint && selectedElementIds.length > 0) {
      const selectedElementId = selectedElementIds[0];
      setTempConnectionPoint(pos);
      
      // Check for snapping to nearby elements - use exact positioning for better detection
      const nearest = findNearestElement(pos, true);
      setHoveredElementId(nearest?.id || null);
      
      return;
    }

    // Handle resize
    if (resizingHandle && resizeStartSize && selectedElementIds.length > 0) {
      const selectedElementId = selectedElementIds[0];
      const element = elements.find(el => el.id === selectedElementId);
      if (element && (element.type === ToolType.RECTANGLE || element.type === ToolType.CIRCLE)) {
        const dx = pos.x - dragStart.x;
        const dy = pos.y - dragStart.y;
        
        let newX = resizeStartSize.x;
        let newY = resizeStartSize.y;
        let newWidth = resizeStartSize.width;
        let newHeight = resizeStartSize.height;
        
        switch (resizingHandle) {
          case 'nw': // Top-left
            newX = resizeStartSize.x + dx;
            newY = resizeStartSize.y + dy;
            newWidth = resizeStartSize.width - dx;
            newHeight = resizeStartSize.height - dy;
            break;
          case 'ne': // Top-right
            newY = resizeStartSize.y + dy;
            newWidth = resizeStartSize.width + dx;
            newHeight = resizeStartSize.height - dy;
            break;
          case 'sw': // Bottom-left
            newX = resizeStartSize.x + dx;
            newWidth = resizeStartSize.width - dx;
            newHeight = resizeStartSize.height + dy;
            break;
          case 'se': // Bottom-right
            newWidth = resizeStartSize.width + dx;
            newHeight = resizeStartSize.height + dy;
            break;
        }
        
        // Ensure minimum size
        if (newWidth < 20) {
          if (resizingHandle === 'nw' || resizingHandle === 'sw') {
            newX = resizeStartSize.x + resizeStartSize.width - 20;
          }
          newWidth = 20;
        }
        if (newHeight < 20) {
          if (resizingHandle === 'nw' || resizingHandle === 'ne') {
            newY = resizeStartSize.y + resizeStartSize.height - 20;
          }
          newHeight = 20;
        }
        
        setElements(prev => prev.map(el => 
          el.id === selectedElementId 
            ? { ...el, x: newX, y: newY, width: newWidth, height: newHeight }
            : el
        ));
      }
      return;
    }


    if (!isDrawing || !dragStart) return;

    if (!hasMoved && (Math.abs(pos.x - dragStart.x) > 2 || Math.abs(pos.y - dragStart.y) > 2)) {
      if (selectedTool === ToolType.SELECT && selectedElementIds.length > 0) {
         onHistorySave();
      }
      setHasMoved(true);
    }

    // Handle label dragging on arrow
    if (draggingLabel) {
      const arrowElement = elements.find(el => el.id === draggingLabel);
      if (arrowElement && arrowElement.type === ToolType.ARROW) {
        // 计算起点和终点
        let fromPoint = { x: arrowElement.x, y: arrowElement.y };
        let toPoint = { x: arrowElement.endX || arrowElement.x, y: arrowElement.endY || arrowElement.y };
        
        if (arrowElement.fromId) {
          const fromNode = nodeMap.get(arrowElement.fromId);
          if (fromNode) {
            const fromPorts = getPorts(fromNode as DiagramElement);
            const portIndexMap: Record<PortDirection, number> = { 
                    top: 0, right: 1, bottom: 2, left: 3,
                    'top-start': 4, 'top-end': 5,
                    'right-start': 6, 'right-end': 7,
                    'bottom-start': 8, 'bottom-end': 9,
                    'left-start': 10, 'left-end': 11,
                    'top-left': 12, 'top-right': 13, 'bottom-right': 14, 'bottom-left': 15
                   };
            if (arrowElement.fromPort) {
              fromPoint = fromPorts[portIndexMap[arrowElement.fromPort]];
            } else if (arrowElement.toId) {
               const toNode = nodeMap.get(arrowElement.toId);
               if (toNode) {
                 const { fromPort } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
                 fromPoint = fromPort;
               }
            }
          }
        }
        
        if (arrowElement.toId) {
          const toNode = nodeMap.get(arrowElement.toId);
          if (toNode) {
            const toPorts = getPorts(toNode as DiagramElement);
            const portIndexMap: Record<PortDirection, number> = { 
                    top: 0, right: 1, bottom: 2, left: 3,
                    'top-start': 4, 'top-end': 5,
                    'right-start': 6, 'right-end': 7,
                    'bottom-start': 8, 'bottom-end': 9,
                    'left-start': 10, 'left-end': 11,
                    'top-left': 12, 'top-right': 13, 'bottom-right': 14, 'bottom-left': 15
                   };
            if (arrowElement.toPort) {
              toPoint = toPorts[portIndexMap[arrowElement.toPort]];
            } else if (arrowElement.fromId) {
               const fromNode = nodeMap.get(arrowElement.fromId);
               if (fromNode) {
                 const { toPort } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
                 toPoint = toPort;
               }
            }
          }
        }

        // Calculate t based on line type
        const t = getTOnLine(
          pos, 
          fromPoint, 
          toPoint, 
          arrowElement.lineType, 
          { x: arrowElement.offsetX || 0, y: arrowElement.offsetY || 0 }
        );
        
        setElements(prev => prev.map(el => 
          el.id === draggingLabel 
            ? { ...el, labelPosition: t }
            : el
        ));
      }
      return;
    }

    if (selectedTool === ToolType.SELECT && selectedElementIds.length > 0 && !resizingHandle && !draggingConnectionPoint) {
      // Multi-element dragging: calculate delta and apply to all selected elements
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;
      
      // Check if any selected element is a GROUP
      const selectedGroupIds = selectedElementIds.filter(id => {
        const el = elements.find(e => e.id === id);
        return el && el.type === ToolType.GROUP;
      });
      
      setElements(prev => prev.map(el => {
        // Move if directly selected
        const isDirectlySelected = selectedElementIds.includes(el.id);
        // Move if child of a selected GROUP
        const isChildOfSelectedGroup = selectedGroupIds.some(groupId => el.groupId === groupId);
        
        if (isDirectlySelected || isChildOfSelectedGroup) {
          const updates: Partial<DiagramElement> = {};
          
          // For GROUP children, always use simple delta movement
          if (isChildOfSelectedGroup && !isDirectlySelected) {
            updates.x = el.x + dx;
            updates.y = el.y + dy;
            return { ...el, ...updates };
          }
          
          if (el.type === ToolType.ARROW) {
            // Handle arrow dragging - either connected arrows with offset or segment dragging
            if ((el.fromId || el.toId) && (dragOffset || draggingStepSegment)) {
              // Calculate arrow center point and direction
              let centerX = 0, centerY = 0;
              let fromPoint: Point | null = null;
              let toPoint: Point | null = null;
              
              if (el.fromId && el.toId) {
                const fromNode = nodeMap.get(el.fromId);
                const toNode = nodeMap.get(el.toId);
                if (fromNode && toNode) {
                  const { fromPort: bestFrom, toPort: bestTo } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
                  fromPoint = bestFrom;
                  toPoint = bestTo;
                  centerX = (bestFrom.x + bestTo.x) / 2;
                  centerY = (bestFrom.y + bestTo.y) / 2;
                }
              } else {
                fromPoint = { x: el.x, y: el.y };
                toPoint = { x: el.endX || el.x, y: el.endY || el.y };
                centerX = (el.x + (el.endX || el.x)) / 2;
                centerY = (el.y + (el.endY || el.y)) / 2;
              }
              
              // Apply constraints based on line type
              const lineType = el.lineType || LineType.STRAIGHT;
              
              // For step lines with segment dragging, use incremental offset
              if (lineType === LineType.STEP && draggingStepSegment) {
                // ... (keep segment dragging logic) ...
                // dragStart should be set when segment dragging starts
                if (!dragStart) {
                  // Fallback: initialize if somehow not set
                  setDragStart(pos);
                  return { ...el, ...updates };
                }
                
                const startPos = dragStart;
                
                if (draggingStepSegment === 'horizontal') {
                  // Dragging horizontal segment: allow vertical movement
                  // Reset offsetX to 0 to force VHV mode priority (since we don't support 5-segment lines yet)
                  const deltaY = pos.y - startPos.y;
                  const currentOffsetY = el.offsetY || 0;
                  updates.offsetX = 0; 
                  updates.offsetY = currentOffsetY + deltaY;
                  // Update dragStart for next frame (incremental delta)
                  setDragStart(pos);
                } else if (draggingStepSegment === 'vertical') {
                  // Dragging vertical segment: only allow horizontal movement
                  // Reset offsetY to 0 to force HVH mode priority
                  const deltaX = pos.x - startPos.x;
                  const currentOffsetX = el.offsetX || 0;
                  updates.offsetX = currentOffsetX + deltaX;
                  updates.offsetY = 0; 
                  // Update dragStart for next frame (incremental delta)
                  setDragStart(pos);
                }
              } else if (dragOffset) {
                // Check if connected nodes are also being dragged
                const isFromNodeSelected = el.fromId && selectedElementIds.includes(el.fromId);
                const isToNodeSelected = el.toId && selectedElementIds.includes(el.toId);
                
                // If both connected nodes are selected, don't update offset (arrow moves with nodes)
                if (isFromNodeSelected && isToNodeSelected) {
                   // Do nothing to offset, let it maintain relative position
                } else {
                    // Calculate raw offset for other drag operations
                    const rawOffsetX = pos.x - centerX - dragOffset.x;
                    const rawOffsetY = pos.y - centerY - dragOffset.y;
                    
                    if (lineType === LineType.STRAIGHT && fromPoint && toPoint) {
                      // For straight lines: only allow perpendicular movement
                      const dx = toPoint.x - fromPoint.x;
                      const dy = toPoint.y - fromPoint.y;
                      const len = Math.sqrt(dx * dx + dy * dy);
                      if (len > 0) {
                        // Perpendicular direction
                        const perpX = -dy / len;
                        const perpY = dx / len;
                        // Project offset onto perpendicular direction
                        const projOffset = rawOffsetX * perpX + rawOffsetY * perpY;
                        updates.offsetX = perpX * projOffset;
                        updates.offsetY = perpY * projOffset;
                      } else {
                        updates.offsetX = rawOffsetX;
                        updates.offsetY = rawOffsetY;
                      }
                    } else {
                      // For STEP and CURVE: allow free movement (update offset)
                      updates.offsetX = rawOffsetX;
                      updates.offsetY = rawOffsetY;
                    }
                }
              }
            } else {
              // For unconnected arrows, update position normally
              const dx = pos.x - dragStart.x;
              const dy = pos.y - dragStart.y;
              updates.x = el.x + dx;
              updates.y = el.y + dy;
              updates.endX = (el.endX || 0) + dx;
              updates.endY = (el.endY || 0) + dy;
            }
          } else {
            // Normal element dragging
            updates.x = el.x + dx;
            updates.y = el.y + dy;
            
            // Auto-assign to group if dragged into group area (only for non-arrow, non-group elements)
            // Only if dragged directly (not because parent group moved)
            if (!isChildOfSelectedGroup && el.type !== ToolType.ARROW && el.type !== ToolType.GROUP) {
              // Calculate center of the element
              const centerX = updates.x! + (el.width || 0) / 2;
              const centerY = updates.y! + (el.height || 0) / 2;
              
              // Find group at this position (exclude selected groups to avoid self-containment issues)
              const targetGroupId = findGroupAtPoint({ x: centerX, y: centerY }, selectedGroupIds);
              
              if (targetGroupId) {
                // If dragged into a group, update groupId
                updates.groupId = targetGroupId;
              } else if (el.groupId) {
                // If dragged out of group (and not into another), clear groupId
                // But we need to be careful: if it's still inside its current group, don't clear.
                // findGroupAtPoint returns the top-most group. 
                // If we are inside the current group, findGroupAtPoint should return it (unless overlapping groups hide it)
                // Since we exclude selected groups, if the current group is NOT selected, findGroupAtPoint should return it.
                // So if targetGroupId is null, we are outside any valid group.
                updates.groupId = undefined;
              }
            }
          }
          
          return { ...el, ...updates };
        }
        return el;
      }));
      
      // Always update dragStart to current position for next delta calculation
      setDragStart(pos);
      return;
    }

    if (currentElementId) {
      setElements(prev => prev.map(el => {
        if (el.id === currentElementId) {
          if (el.type === ToolType.ARROW) {
            return { ...el, endX: pos.x, endY: pos.y };
          }
          const w = pos.x - dragStart.x;
          const h = pos.y - dragStart.y;
          return {
            ...el,
            x: w < 0 ? pos.x : dragStart.x,
            y: h < 0 ? pos.y : dragStart.y,
            width: Math.abs(w),
            height: Math.abs(h)
          };
        }
        return el;
      }));
    }
  };

  const handleMouseUp = () => {
    // Handle creating arrow from connection point
    if (creatingArrowFrom && tempArrowEnd) {
      const fromElement = elements.find(el => el.id === creatingArrowFrom.elementId);
      if (fromElement) {
        // Calculate distance between start and end points
        const dx = tempArrowEnd.x - creatingArrowFrom.point.x;
        const dy = tempArrowEnd.y - creatingArrowFrom.point.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Minimum distance threshold: at least 20 pixels
        const MIN_ARROW_DISTANCE = 20;
        
        if (distance < MIN_ARROW_DISTANCE) {
          // Distance too short, cancel arrow creation
          setCreatingArrowFrom(null);
          setTempArrowEnd(null);
          setHoveredElementId(null);
          return;
        }
        
        // Check if user dragged to an element (within bounds or very close to port)
        const nearest = findNearestElement(tempArrowEnd, true);
        
        // Don't connect to the same element
        const toId = nearest && nearest.id !== creatingArrowFrom.elementId ? nearest.id : undefined;
        const toPort = toId ? nearest?.port : undefined;
        
        // If connected to an element (toId exists), don't set endX/endY - use smart anchors
        // If not connected, use manual coordinates
        const newArrow: DiagramElement = {
          id: `el_${Date.now()}`,
          type: ToolType.ARROW,
          x: creatingArrowFrom.point.x,
          y: creatingArrowFrom.point.y,
          endX: toId ? undefined : tempArrowEnd.x, // Only set if not connected to element
          endY: toId ? undefined : tempArrowEnd.y, // Only set if not connected to element
          fromId: creatingArrowFrom.elementId,
          fromPort: creatingArrowFrom.port as PortDirection, // 记录起始端口，实现吸附
          toId: toId, // Set toId if dragged to an element
          toPort: toPort, // 记录目标端口，实现吸附
          strokeColor: '#94a3b8',
          fillColor: 'transparent',
          strokeWidth: 2.5,
          lineType: LineType.STEP, // 默认使用 STEP 类型
          lineStyle: LineStyle.SOLID,
          markerEnd: true
        };
        
        setElements(prev => [...prev, newArrow]);
        setSelectedElementIds([newArrow.id]);
      }
      
      setCreatingArrowFrom(null);
      setTempArrowEnd(null);
      setHoveredElementId(null);
    }
    
    // Handle connection point drag end
    if (draggingConnectionPoint && selectedElementIds.length > 0 && tempConnectionPoint) {
      const selectedElementId = selectedElementIds[0];
      const arrowElement = elements.find(el => el.id === selectedElementId);
      if (arrowElement && arrowElement.type === ToolType.ARROW) {
        const nearest = findNearestElement(tempConnectionPoint, true);
        
        if (draggingConnectionPoint === 'from') {
          // First check if dragging to the same element (by checking bounds)
          let isSameElement = false;
          if (arrowElement.fromId) {
            const fromNode = nodeMap.get(arrowElement.fromId) as DiagramElement | undefined;
            if (fromNode) {
              const w = fromNode.width || 0;
              const h = fromNode.height || 0;
              const isInside = tempConnectionPoint!.x >= fromNode.x && 
                               tempConnectionPoint!.x <= fromNode.x + w && 
                               tempConnectionPoint!.y >= fromNode.y && 
                               tempConnectionPoint!.y <= fromNode.y + h;
              isSameElement = isInside;
            }
          }
          
          if (isSameElement && arrowElement.fromId) {
            // Dragging to same element - find nearest port for snapping
            const fromNode = nodeMap.get(arrowElement.fromId) as DiagramElement | undefined;
            if (fromNode) {
              const ports = getPorts(fromNode);
              const portDirs: PortDirection[] = [
                'top', 'right', 'bottom', 'left',
                'top-start', 'top-end',
                'right-start', 'right-end',
                'bottom-start', 'bottom-end',
                'left-start', 'left-end',
                'top-left', 'top-right', 'bottom-right', 'bottom-left'
              ];
              let minDist = Infinity;
              let selectedPortIndex = 0;
              ports.forEach((port, index) => {
                const dist = Math.sqrt(Math.pow(tempConnectionPoint!.x - port.x, 2) + Math.pow(tempConnectionPoint!.y - port.y, 2));
                if (dist < minDist) {
                  minDist = dist;
                  selectedPortIndex = index;
                }
              });
                onHistorySave();
                setElements(prev => prev.map(el => 
                  el.id === selectedElementId 
                  ? { ...el, fromId: arrowElement.fromId, fromPort: portDirs[selectedPortIndex], x: undefined, y: undefined }
                    : el
                ));
              }
          } else if (nearest) {
            // Dragging to different element - use nearest port
              onHistorySave();
              setElements(prev => prev.map(el => 
                el.id === selectedElementId 
                ? { ...el, fromId: nearest.id, fromPort: nearest.port, x: undefined, y: undefined }
                  : el
              ));
          } else {
            // Use manual coordinates - clear fromId and fromPort
            onHistorySave();
            setElements(prev => prev.map(el => 
              el.id === selectedElementId 
                ? { ...el, x: tempConnectionPoint!.x, y: tempConnectionPoint!.y, fromId: undefined, fromPort: undefined }
                : el
            ));
          }
        } else {
          // Dragging 'to' connection point
          // First check if dragging to the same element (by checking bounds)
          let isSameElement = false;
          if (arrowElement.toId) {
            const toNode = nodeMap.get(arrowElement.toId) as DiagramElement | undefined;
            if (toNode) {
              const w = toNode.width || 0;
              const h = toNode.height || 0;
              const isInside = tempConnectionPoint!.x >= toNode.x && 
                               tempConnectionPoint!.x <= toNode.x + w && 
                               tempConnectionPoint!.y >= toNode.y && 
                               tempConnectionPoint!.y <= toNode.y + h;
              isSameElement = isInside;
            }
          }
          
          if (isSameElement && arrowElement.toId) {
            // Dragging to same element - find nearest port for snapping
            const toNode = nodeMap.get(arrowElement.toId) as DiagramElement | undefined;
            if (toNode) {
              const ports = getPorts(toNode);
              const portDirs: PortDirection[] = [
                'top', 'right', 'bottom', 'left',
                'top-start', 'top-end',
                'right-start', 'right-end',
                'bottom-start', 'bottom-end',
                'left-start', 'left-end',
                'top-left', 'top-right', 'bottom-right', 'bottom-left'
              ];
              let minDist = Infinity;
              let selectedPortIndex = 0;
              ports.forEach((port, index) => {
                const dist = Math.sqrt(Math.pow(tempConnectionPoint!.x - port.x, 2) + Math.pow(tempConnectionPoint!.y - port.y, 2));
                if (dist < minDist) {
                  minDist = dist;
                  selectedPortIndex = index;
                }
              });
                onHistorySave();
                setElements(prev => prev.map(el => 
                  el.id === selectedElementId 
                  ? { ...el, toId: arrowElement.toId, toPort: portDirs[selectedPortIndex], endX: undefined, endY: undefined }
                    : el
                ));
              }
          } else if (nearest) {
            // Dragging to different element - use nearest port
              onHistorySave();
              setElements(prev => prev.map(el => 
                el.id === selectedElementId 
                ? { ...el, toId: nearest.id, toPort: nearest.port, endX: undefined, endY: undefined }
                  : el
              ));
          } else {
            // Use manual coordinates - clear toId and toPort
            onHistorySave();
            setElements(prev => prev.map(el => 
              el.id === selectedElementId 
                ? { ...el, endX: tempConnectionPoint!.x, endY: tempConnectionPoint!.y, toId: undefined, toPort: undefined }
                : el
            ));
          }
        }
      }
      
      setDraggingConnectionPoint(null);
      setTempConnectionPoint(null);
      setHoveredElementId(null);
    }
    
    // Handle resize end
    if (resizingHandle) {
      setResizingHandle(null);
      setResizeStartSize(null);
    }
    
    // Handle group drag end
    if (draggingGroup) {
      setDraggingGroup(null);
      setGroupDragOffset(null);
    }
    
    setIsDrawing(false);
    setIsPanning(false);
    setDragStart(null);
    setLastMousePos(null);
    setCurrentElementId(null);
    setHasMoved(false);
    setDraggingStepSegment(null);
    setDraggingLabel(null);
    
    if (selectedTool !== ToolType.SELECT) {
      setSelectedTool(ToolType.SELECT);
      if(currentElementId) setSelectedElementIds([currentElementId]);
    }
  };

  const nodeMap = new Map(elements.map(el => [el.id, el]));
  
  // Sort: GROUP elements first (bottom), then other elements, then ARROWs last (top)
  const sortedElements = [...elements].sort((a, b) => {
    // GROUP elements at bottom
    if (a.type === ToolType.GROUP && b.type !== ToolType.GROUP) return -1;
    if (a.type !== ToolType.GROUP && b.type === ToolType.GROUP) return 1;
    // ARROW elements at top
    if (a.type === ToolType.ARROW && b.type !== ToolType.ARROW) return 1;
    if (a.type !== ToolType.ARROW && b.type === ToolType.ARROW) return -1;
    return 0;
  });

  return (
    <div 
      className={`flex-1 h-full bg-gray-50 overflow-hidden relative ${showGrid ? 'bg-grid-pattern' : ''}`}
      style={{ 
        cursor: isPanning ? 'grabbing' : selectedTool === ToolType.SELECT ? 'default' : 'crosshair',
        // Background pattern should move with pan/scale logic if we wanted perfect sync, 
        // but simple pan sync is usually enough for bg.
        backgroundPosition: showGrid ? `${pan.x}px ${pan.y}px` : '0 0',
        backgroundSize: showGrid ? `${20 * scale}px ${20 * scale}px` : 'auto'
      }}
    >
      <svg
        id="paperplot-canvas"
        ref={svgRef}
        className="w-full h-full block touch-none" // touch-none for better gesture handling
        onMouseDown={handleBackgroundMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <marker id="arrow-end" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />
          </marker>
           <marker id="arrow-start" markerWidth="10" markerHeight="10" refX="0" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M9,0 L9,6 L0,3 z" fill="#94a3b8" />
          </marker>
           <marker id="arrow-end-selected" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#1890ff" />
          </marker>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="2" stdDeviation="3" floodColor="#000000" floodOpacity="0.1"/>
          </filter>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
          
          {/* Render temporary arrow being created from connection point */}
          {creatingArrowFrom && tempArrowEnd && (
            <g>
              <path
                d={`M ${creatingArrowFrom.point.x} ${creatingArrowFrom.point.y} L ${tempArrowEnd.x} ${tempArrowEnd.y}`}
                stroke="#10b981"
                strokeWidth="2"
                strokeDasharray="4,4"
                fill="none"
                markerEnd="url(#arrow-end-selected)"
                style={{ pointerEvents: 'none' }}
              />
              {/* Hover indicator for snap target */}
              {hoveredElementId && tempArrowEnd && (() => {
                const nearest = findNearestElement(tempArrowEnd, true);
                if (nearest && nearest.id === hoveredElementId) {
                  return (
                    <circle
                      cx={nearest.point.x}
                      cy={nearest.point.y}
                      r="10"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2"
                      strokeDasharray="4,4"
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                }
                return null;
              })()}
            </g>
          )}

          {/* Render Elements */}
          {sortedElements.map(el => {
            const isSelected = selectedElementIds.includes(el.id);

            if (el.type === ToolType.ARROW) {
               let pathData = "";
               let fromPoint: Point = { x: el.x, y: el.y };
               let toPoint: Point = { x: el.endX || el.x, y: el.endY || el.y };
               let startDir: PortDirection | undefined = el.fromPort;
               let endDir: PortDirection | undefined = el.toPort;

               // Simple logic: Use smart anchors if both fromId and toId exist
               if (el.fromId && el.toId) {
                 const fromNode = nodeMap.get(el.fromId);
                 const toNode = nodeMap.get(el.toId);
                 
                 if (fromNode && toNode) {
                   const fromPorts = getPorts(fromNode as DiagramElement);
                   const toPorts = getPorts(toNode as DiagramElement);
                   const portIndexMap: Record<PortDirection, number> = { 
                    top: 0, right: 1, bottom: 2, left: 3,
                    'top-start': 4, 'top-end': 5,
                    'right-start': 6, 'right-end': 7,
                    'bottom-start': 8, 'bottom-end': 9,
                    'left-start': 10, 'left-end': 11,
                    'top-left': 12, 'top-right': 13, 'bottom-right': 14, 'bottom-left': 15
                   };
                   
                   // 使用记录的端口方向（吸附功能）
                   if (el.fromPort) {
                     fromPoint = fromPorts[portIndexMap[el.fromPort]];
                   } else {
                     // Fallback: use smart selection
                     const { fromPort } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
                     fromPoint = fromPort;
                     startDir = fromPort.id; // Capture detected direction
                   }
                   
                   if (el.toPort) {
                     toPoint = toPorts[portIndexMap[el.toPort]];
                   } else {
                     // Fallback: use smart selection
                     const { toPort } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
                     toPoint = toPort;
                     endDir = toPort.id; // Capture detected direction
                   }
                   
                  // Generate path based on line type
                  if (el.lineType === LineType.STRAIGHT) {
                    pathData = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
                  } else if (el.lineType === LineType.STEP) {
                    pathData = getRoundedStepPathWithOffset(
                      fromPoint.x, fromPoint.y, 
                      toPoint.x, toPoint.y, 
                      el.offsetX || 0, el.offsetY || 0,
                      false,
                      startDir, // Use detected direction if not explicit
                      endDir    // Use detected direction if not explicit
                    );
                  } else {
                    // CURVE
                    const dist = Math.sqrt(Math.pow(fromPoint.x - toPoint.x, 2) + Math.pow(fromPoint.y - toPoint.y, 2));
                    const controlDist = Math.min(dist * 0.5, 150);
                    const dx = toPoint.x - fromPoint.x;
                    const dy = toPoint.y - fromPoint.y;
                    const angle = Math.atan2(dy, dx);
                    const cp1x = fromPoint.x + Math.cos(angle) * controlDist;
                    const cp1y = fromPoint.y + Math.sin(angle) * controlDist;
                    const cp2x = toPoint.x - Math.cos(angle) * controlDist;
                    const cp2y = toPoint.y - Math.sin(angle) * controlDist;
                    pathData = `M ${fromPoint.x} ${fromPoint.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPoint.x} ${toPoint.y}`;
                  }
                 }
               } else if (el.fromId && !el.toId) {
                 // Connected from element but not to element
                 const fromNode = nodeMap.get(el.fromId);
                 if (fromNode) {
                   toPoint = { x: el.endX || el.x, y: el.endY || el.y };
                   
                   const fromNodeEl = fromNode as DiagramElement;
                   const fromPorts = getPorts(fromNodeEl);
                   const portIndexMap: Record<PortDirection, number> = { 
                    top: 0, right: 1, bottom: 2, left: 3,
                    'top-start': 4, 'top-end': 5,
                    'right-start': 6, 'right-end': 7,
                    'bottom-start': 8, 'bottom-end': 9,
                    'left-start': 10, 'left-end': 11,
                    'top-left': 12, 'top-right': 13, 'bottom-right': 14, 'bottom-left': 15
                   };
                   
                   // 使用记录的端口方向（吸附功能）
                   if (el.fromPort) {
                     fromPoint = fromPorts[portIndexMap[el.fromPort]];
                   } else {
                     // Fallback: 根据 toPoint 位置自动选择
                     const fromCenterX = fromNodeEl.x + (fromNodeEl.width || 0) / 2;
                     const fromCenterY = fromNodeEl.y + (fromNodeEl.height || 0) / 2;
                     const dx = toPoint.x - fromCenterX;
                     const dy = toPoint.y - fromCenterY;
                     const absDx = Math.abs(dx);
                     const absDy = Math.abs(dy);
                     
                     if (absDy > absDx) {
                       fromPoint = dy > 0 ? fromPorts[2] : fromPorts[0];
                     } else {
                       fromPoint = dx > 0 ? fromPorts[1] : fromPorts[3];
                     }
                   }
                   
                  // Generate path
                  if (el.lineType === LineType.STRAIGHT) {
                    pathData = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
                  } else if (el.lineType === LineType.STEP) {
                    pathData = getRoundedStepPathWithOffset(
                      fromPoint.x, fromPoint.y, 
                      toPoint.x, toPoint.y, 
                      el.offsetX || 0, el.offsetY || 0,
                      false,
                      el.fromPort
                    );
                  } else {
                    // CURVE
                    const dist = Math.sqrt(Math.pow(fromPoint.x - toPoint.x, 2) + Math.pow(fromPoint.y - toPoint.y, 2));
                    const controlDist = Math.min(dist * 0.5, 150);
                    const dx = toPoint.x - fromPoint.x;
                    const dy = toPoint.y - fromPoint.y;
                    const angle = Math.atan2(dy, dx);
                    const cp1x = fromPoint.x + Math.cos(angle) * controlDist;
                    const cp1y = fromPoint.y + Math.sin(angle) * controlDist;
                    const cp2x = toPoint.x - Math.cos(angle) * controlDist;
                    const cp2y = toPoint.y - Math.sin(angle) * controlDist;
                    pathData = `M ${fromPoint.x} ${fromPoint.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPoint.x} ${toPoint.y}`;
                  }
                 }
               }
               
               // Fallback if not connected or smart path failed (e.g. during manual drawing)
               if (!pathData) {
                   // Manual Arrow drawing fallback - respect lineType
                   const lineType = el.lineType || LineType.STRAIGHT;
                   if (lineType === LineType.STRAIGHT) {
                     pathData = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
                   } else if (lineType === LineType.STEP) {
                     pathData = getRoundedStepPath(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y);
                   } else {
                     // CURVE
                     const dist = Math.sqrt(Math.pow(fromPoint.x - toPoint.x, 2) + Math.pow(fromPoint.y - toPoint.y, 2));
                     const controlDist = Math.min(dist * 0.5, 150);
                     const dx = toPoint.x - fromPoint.x;
                     const dy = toPoint.y - fromPoint.y;
                     const angle = Math.atan2(dy, dx);
                     const cp1x = fromPoint.x + Math.cos(angle) * controlDist;
                     const cp1y = fromPoint.y + Math.sin(angle) * controlDist;
                     const cp2x = toPoint.x - Math.cos(angle) * controlDist;
                     const cp2y = toPoint.y - Math.sin(angle) * controlDist;
                     pathData = `M ${fromPoint.x} ${fromPoint.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPoint.x} ${toPoint.y}`;
                   }
               }
               
              // Apply offset if arrow is connected to elements and has manual offset
              // Note: For STEP and CURVE lines, offset is already applied in path generation above
              if ((el.fromId || el.toId) && (el.offsetX || el.offsetY) && el.lineType === LineType.STRAIGHT) {
                pathData = applyOffsetToPath(pathData, el.offsetX || 0, el.offsetY || 0, el.lineType || LineType.STRAIGHT);
                
                // Update endpoint positions after applying offset for straight lines
                // For straight lines, both endpoints move by the offset
                fromPoint = { x: fromPoint.x + (el.offsetX || 0), y: fromPoint.y + (el.offsetY || 0) };
                toPoint = { x: toPoint.x + (el.offsetX || 0), y: toPoint.y + (el.offsetY || 0) };
              }

               // Handle dragging connection point - show temporary line (respect lineType)
               const isDraggingConnection = isSelected && draggingConnectionPoint && tempConnectionPoint;
               if (isDraggingConnection) {
                 const lineType = el.lineType || LineType.STRAIGHT;
                 if (draggingConnectionPoint === 'from') {
                   fromPoint = tempConnectionPoint;
                   if (lineType === LineType.STRAIGHT) {
                     pathData = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
                   } else if (lineType === LineType.STEP) {
                     pathData = getRoundedStepPath(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, undefined, el.toPort);
                   } else {
                     // CURVE
                     const dist = Math.sqrt(Math.pow(fromPoint.x - toPoint.x, 2) + Math.pow(fromPoint.y - toPoint.y, 2));
                     const controlDist = Math.min(dist * 0.5, 150);
                     const dx = toPoint.x - fromPoint.x;
                     const dy = toPoint.y - fromPoint.y;
                     const angle = Math.atan2(dy, dx);
                     const cp1x = fromPoint.x + Math.cos(angle) * controlDist;
                     const cp1y = fromPoint.y + Math.sin(angle) * controlDist;
                     const cp2x = toPoint.x - Math.cos(angle) * controlDist;
                     const cp2y = toPoint.y - Math.sin(angle) * controlDist;
                     pathData = `M ${fromPoint.x} ${fromPoint.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPoint.x} ${toPoint.y}`;
                   }
                 } else {
                   toPoint = tempConnectionPoint;
                   if (lineType === LineType.STRAIGHT) {
                     pathData = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
                   } else if (lineType === LineType.STEP) {
                     pathData = getRoundedStepPath(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, el.fromPort, undefined);
                   } else {
                     // CURVE
                     const dist = Math.sqrt(Math.pow(fromPoint.x - toPoint.x, 2) + Math.pow(fromPoint.y - toPoint.y, 2));
                     const controlDist = Math.min(dist * 0.5, 150);
                     const dx = toPoint.x - fromPoint.x;
                     const dy = toPoint.y - fromPoint.y;
                     const angle = Math.atan2(dy, dx);
                     const cp1x = fromPoint.x + Math.cos(angle) * controlDist;
                     const cp1y = fromPoint.y + Math.sin(angle) * controlDist;
                     const cp2x = toPoint.x - Math.cos(angle) * controlDist;
                     const cp2y = toPoint.y - Math.sin(angle) * controlDist;
                     pathData = `M ${fromPoint.x} ${fromPoint.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPoint.x} ${toPoint.y}`;
                   }
                 }
               }

               const strokeDash = el.lineStyle === LineStyle.DASHED ? "8,8" : el.lineStyle === LineStyle.DOTTED ? "3,3" : "none";
               const tempStrokeDash = isDraggingConnection ? "4,4" : strokeDash;

               return (
                 <g 
                    key={el.id} 
                    style={{ pointerEvents: 'all', cursor: selectedTool === ToolType.SELECT ? 'pointer' : 'default' }}
                    onMouseDown={(e) => handleElementMouseDown(e, el.id)}
                 >
                    {/* Hit area (invisible wide stroke for easier selection) */}
                    <path 
                      d={pathData} 
                      stroke="transparent" 
                      strokeWidth="20" 
                      fill="none"
                      style={{ pointerEvents: draggingConnectionPoint ? 'none' : 'stroke' }}
                    />
                    {/* Actual Line */}
                    <path
                      d={pathData}
                      stroke={isDraggingConnection ? '#10b981' : (isSelected ? '#1890ff' : el.strokeColor)}
                      strokeWidth={isDraggingConnection ? el.strokeWidth + 1 : el.strokeWidth}
                      strokeDasharray={tempStrokeDash}
                      fill="none"
                      markerEnd={el.markerEnd && !isDraggingConnection ? (isSelected ? "url(#arrow-end-selected)" : "url(#arrow-end)") : undefined}
                      markerStart={el.markerStart && !isDraggingConnection ? "url(#arrow-start)" : undefined}
                      style={{ pointerEvents: 'none' }}
                    />
                    
                    {/* Connection Point Handles (only when selected and points are valid) */}
                    {isSelected && !draggingConnectionPoint && fromPoint && toPoint && 
                     !isNaN(fromPoint.x) && !isNaN(fromPoint.y) && !isNaN(toPoint.x) && !isNaN(toPoint.y) && (
                      <>
                        {/* From handle */}
                        <circle
                          cx={fromPoint.x}
                          cy={fromPoint.y}
                          r="8"
                          fill="#1890ff"
                          stroke="white"
                          strokeWidth="2.5"
                          style={{ cursor: 'grab', pointerEvents: 'all', filter: 'drop-shadow(0 1px 2px rgba(24, 144, 255, 0.3))' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDraggingConnectionPoint('from');
                            setTempConnectionPoint(fromPoint);
                            setIsDrawing(true);
                          }}
                        />
                        {/* To handle */}
                        <circle
                          cx={toPoint.x}
                          cy={toPoint.y}
                          r="8"
                          fill="#1890ff"
                          stroke="white"
                          strokeWidth="2.5"
                          style={{ cursor: 'grab', pointerEvents: 'all', filter: 'drop-shadow(0 1px 2px rgba(24, 144, 255, 0.3))' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDraggingConnectionPoint('to');
                            setTempConnectionPoint(toPoint);
                            setIsDrawing(true);
                          }}
                        />
                        
                        {/* Line segment control point for STEP lines - 显示所有段的控制点 */}
                        {el.lineType === LineType.STEP && (
                          <>
                            {(() => {
                              const dx = toPoint.x - fromPoint.x;
                              const dy = toPoint.y - fromPoint.y;
                              const absDx = Math.abs(dx);
                              const absDy = Math.abs(dy);
                              
                              // 如果线实际上是直线（absDx < 5 或 absDy < 5），不显示控制点
                              if (absDx < 5 || absDy < 5) {
                                return null;
                              }
                              
                              // 智能修正控制点位置（考虑吸附效果）
                              const snapThreshold = 10;
                              let isVerticalLayout = absDy > absDx;

                              // Sticky mode based on offset usage (用户意图优先) - 必须与 getRoundedStepPathWithOffset 逻辑一致
                              const midYOffset = el.offsetY || 0;
                              const midXOffset = el.offsetX || 0;
                              
                              // Derived logic to match getRoundedStepPathWithOffset
                              let finalMidXOffset = midXOffset;
                              let finalMidYOffset = midYOffset;
                              
                              // Removed local redeclaration to use calculated values from parent scope
                              // const startDir = el.fromPort; 
                              // const endDir = el.toPort;
                              
                              const startIsVert = startDir ? isVerticalPort(startDir) : null;
                              const endIsVert = endDir ? isVerticalPort(endDir) : null;
                              const startIsHoriz = startDir ? isHorizontalPort(startDir) : null;
                              const endIsHoriz = endDir ? isHorizontalPort(endDir) : null;

                              if (Math.abs(midYOffset) > 5 && Math.abs(midXOffset) < 5) {
                                isVerticalLayout = true;
                              } else if (Math.abs(midXOffset) > 5 && Math.abs(midYOffset) < 5) {
                                isVerticalLayout = false;
                              }
                              else if (startIsVert !== null || endIsVert !== null) {
                                 if (startIsVert && endIsVert) {
                                     isVerticalLayout = false; // HVH
                                     if (Math.abs(finalMidXOffset) < 1) finalMidXOffset = dx / 2;
                                 } else if (startIsHoriz && endIsHoriz) {
                                     isVerticalLayout = true; // VHV
                                     if (Math.abs(finalMidYOffset) < 1) finalMidYOffset = dy / 2;
                                 } else if (startIsVert && endIsHoriz) {
                                     isVerticalLayout = false; // HVH
                                     if (Math.abs(finalMidYOffset) < 1) {
                                         const isBottom = startDir?.includes('bottom');
                                         const isTop = startDir?.includes('top');
                                         let useLShape = false;
                                         if (isBottom && dy > 20) useLShape = true;
                                         if (isTop && dy < -20) useLShape = true;
                                         if (useLShape) finalMidYOffset = dy;
                                         else finalMidYOffset = isBottom ? 40 : -40;
                                     }
                                 } else if (startIsHoriz && endIsVert) {
                                     isVerticalLayout = true; // VHV
                                     if (Math.abs(finalMidXOffset) < 1) {
                                         const isRight = startDir?.includes('right');
                                         const isLeft = startDir?.includes('left');
                                         let useLShape = false;
                                         if (isRight && dx > 20) useLShape = true;
                                         if (isLeft && dx < -20) useLShape = true;
                                         if (useLShape) finalMidXOffset = dx;
                                         else finalMidXOffset = isRight ? 40 : -40;
                                     }
                                 }
                              }
                              
                              // 1. VHV 模式参数 (Vertical Layout)
                              // path: Start -> (v1_X, startY) -> (v1_X, midY) -> (endX, midY) -> End
                              let vhvMidY = (fromPoint.y + toPoint.y) / 2 + finalMidYOffset;
                              let vhvV1X = fromPoint.x + finalMidXOffset;
                              
                              // 模拟 VHV 吸附逻辑
                              if (Math.abs(vhvMidY - toPoint.y) < snapThreshold) vhvMidY = toPoint.y;
                              if (Math.abs(vhvMidY - fromPoint.y) < snapThreshold) vhvMidY = fromPoint.y;
                              
                              // 2. HVH 模式参数 (Horizontal Layout)
                              // path: Start -> (startX, h1_Y) -> (midX, h1_Y) -> (midX, endY) -> End
                              let hvhMidX = (fromPoint.x + toPoint.x) / 2 + finalMidXOffset;
                              let hvhH1Y = fromPoint.y + finalMidYOffset;
                              
                              // 模拟 HVH 吸附逻辑
                              if (Math.abs(hvhMidX - toPoint.x) < snapThreshold) hvhMidX = toPoint.x;
                              if (Math.abs(hvhMidX - fromPoint.x) < snapThreshold) hvhMidX = fromPoint.x;
                              
                              // 强制与路径生成逻辑一致
                              const isVerticalRender = isVerticalLayout;

                              // Base sizes for control points
                              const baseBarWidth = 24;
                              const baseBarHeight = 6;
                              const baseRx = 3;
                              const baseStrokeWidth = 1.5;

                              // Scaled sizes
                              const barWidth = baseBarWidth / scale;
                              const barHeight = baseBarHeight / scale;
                              const rx = baseRx / scale;
                              const strokeWidth = baseStrokeWidth / scale;
                              
                              // 只有当线段长度大于阈值时才显示控制点（模仿飞书的动态增减）
                              const minSegmentLength = 20;

                              return (
                                <>
                                  {/* VHV 模式：显示中间段控制点 */}
                                  {isVerticalRender && (
                                    <>
                                      {/* 中间竖线段 (v1_X, startY) -> (v1_X, midY) 的控制点 */}
                                      {Math.abs(vhvMidY - fromPoint.y) > minSegmentLength && (
                                        <rect
                                          x={vhvV1X - barHeight / 2}
                                          y={(fromPoint.y + vhvMidY) / 2 - barWidth / 2}
                                          width={barHeight}
                                          height={barWidth}
                                          fill="#1890ff"
                                          stroke="white"
                                          strokeWidth={strokeWidth}
                                          rx={rx}
                                          style={{ cursor: 'ew-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 3px rgba(24, 144, 255, 0.4))' }}
                                          onMouseDown={(e) => {
                                            e.stopPropagation();
                                            const pos = getMousePos(e);
                                            setSelectedElementIds([el.id]);
                                            setDragStart(pos);
                                            setDraggingStepSegment('vertical');
                                            setIsDrawing(true);
                                            setHasMoved(false);
                                            onHistorySave();
                                          }}
                                        />
                                      )}
                                      {/* 中间横线段 (v1_X, midY) -> (endX, midY) 的控制点 */}
                                      {Math.abs(toPoint.x - vhvV1X) > minSegmentLength && (
                                        <rect
                                          x={(vhvV1X + toPoint.x) / 2 - barWidth / 2}
                                          y={vhvMidY - barHeight / 2}
                                          width={barWidth}
                                          height={barHeight}
                                          fill="#1890ff"
                                          stroke="white"
                                          strokeWidth={strokeWidth}
                                          rx={rx}
                                          style={{ cursor: 'ns-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 3px rgba(24, 144, 255, 0.4))' }}
                                          onMouseDown={(e) => {
                                            e.stopPropagation();
                                            const pos = getMousePos(e);
                                            setSelectedElementIds([el.id]);
                                            setDragStart(pos);
                                            setDraggingStepSegment('horizontal');
                                            setIsDrawing(true);
                                            setHasMoved(false);
                                            onHistorySave();
                                          }}
                                        />
                                      )}
                                    </>
                                  )}
                                  
                                  {/* HVH 模式：显示中间段控制点 */}
                                  {!isVerticalRender && (
                                    <>
                                      {/* 中间横线段 (startX, h1_Y) -> (midX, h1_Y) 的控制点 */}
                                      {Math.abs(hvhMidX - fromPoint.x) > minSegmentLength && (
                                        <rect
                                          x={(fromPoint.x + hvhMidX) / 2 - barWidth / 2}
                                          y={hvhH1Y - barHeight / 2}
                                          width={barWidth}
                                          height={barHeight}
                                          fill="#1890ff"
                                          stroke="white"
                                          strokeWidth={strokeWidth}
                                          rx={rx}
                                          style={{ cursor: 'ns-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 3px rgba(24, 144, 255, 0.4))' }}
                                          onMouseDown={(e) => {
                                            e.stopPropagation();
                                            const pos = getMousePos(e);
                                            setSelectedElementIds([el.id]);
                                            setDragStart(pos);
                                            setDraggingStepSegment('horizontal');
                                            setIsDrawing(true);
                                            setHasMoved(false);
                                            onHistorySave();
                                          }}
                                        />
                                      )}
                                      {/* 中间竖线段 (midX, h1_Y) -> (midX, endY) 的控制点 */}
                                      {Math.abs(toPoint.y - hvhH1Y) > minSegmentLength && (
                                        <rect
                                          x={hvhMidX - barHeight / 2}
                                          y={(hvhH1Y + toPoint.y) / 2 - barWidth / 2}
                                          width={barHeight}
                                          height={barWidth}
                                          fill="#1890ff"
                                          stroke="white"
                                          strokeWidth={strokeWidth}
                                          rx={rx}
                                          style={{ cursor: 'ew-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 3px rgba(24, 144, 255, 0.4))' }}
                                          onMouseDown={(e) => {
                                            e.stopPropagation();
                                            const pos = getMousePos(e);
                                            setSelectedElementIds([el.id]);
                                            setDragStart(pos);
                                            setDraggingStepSegment('vertical');
                                            setIsDrawing(true);
                                            setHasMoved(false);
                                            onHistorySave();
                                          }}
                                        />
                                      )}
                                    </>
                                  )}
                                </>
                              );
                            })()}
                          </>
                        )}
                        
                        {/* Line segment control point for STRAIGHT lines - 飞书风格 */}
                        {el.lineType === LineType.STRAIGHT && (
                          <>
                            {(() => {
                              // Calculate midpoint - fromPoint/toPoint already include offset
                              const midX = (fromPoint.x + toPoint.x) / 2;
                              const midY = (fromPoint.y + toPoint.y) / 2;
                              
                              // Calculate line angle (in degrees)
                              const dx = toPoint.x - fromPoint.x;
                              const dy = toPoint.y - fromPoint.y;
                              const lineAngle = Math.atan2(dy, dx) * 180 / Math.PI;
                              
                              // Base sizes for control points
                              const baseBarWidth = 24;
                              const baseBarHeight = 6;
                              const baseRx = 3;
                              const baseStrokeWidth = 1.5;

                              // Scaled sizes
                              const barWidth = baseBarWidth / scale;
                              const barHeight = baseBarHeight / scale;
                              const rx = baseRx / scale;
                              const strokeWidth = baseStrokeWidth / scale;
                              
                              return (
                                <rect
                                  x={-barWidth / 2}
                                  y={-barHeight / 2}
                                  width={barWidth}
                                  height={barHeight}
                                  fill="#1890ff"
                                  stroke="white"
                                  strokeWidth={strokeWidth}
                                  rx={rx}
                                  transform={`translate(${midX}, ${midY}) rotate(${lineAngle})`}
                                  style={{ cursor: 'move', pointerEvents: 'all', filter: 'drop-shadow(0 1px 3px rgba(24, 144, 255, 0.4))' }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    const pos = getMousePos(e);
                                    setDragStart(pos);
                                    setIsDrawing(true);
                                    setHasMoved(false);
                                    onHistorySave();
                                  }}
                                />
                              );
                            })()}
                          </>
                        )}
                        
                        {/* Line segment control point for CURVE lines - 飞书风格 */}
                        {el.lineType === LineType.CURVE && (
                          <>
                            {(() => {
                              // Calculate midpoint - fromPoint/toPoint already include offset for curves
                              const midX = (fromPoint.x + toPoint.x) / 2;
                              const midY = (fromPoint.y + toPoint.y) / 2;
                              
                              const baseRadius = 8;
                              const baseStrokeWidth = 2;
                              
                              const r = baseRadius / scale;
                              const strokeWidth = baseStrokeWidth / scale;

                              return (
                                <circle
                                  cx={midX}
                                  cy={midY}
                                  r={r}
                                  fill="#1890ff"
                                  stroke="white"
                                  strokeWidth={strokeWidth}
                                  style={{ cursor: 'move', pointerEvents: 'all', filter: 'drop-shadow(0 1px 3px rgba(24, 144, 255, 0.4))' }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    const pos = getMousePos(e);
                                    setDragStart(pos);
                                    setIsDrawing(true);
                                    setHasMoved(false);
                                    onHistorySave();
                                  }}
                                />
                              );
                            })()}
                          </>
                        )}
                      </>
                    )}
                    
                    {/* Hover indicator for snap target */}
                    {draggingConnectionPoint && hoveredElementId && tempConnectionPoint && (() => {
                      const nearest = findNearestElement(tempConnectionPoint, true);
                      if (nearest && nearest.id === hoveredElementId) {
                        return (
                          <circle
                            cx={nearest.point.x}
                            cy={nearest.point.y}
                            r="10"
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="2"
                            strokeDasharray="4,4"
                            style={{ pointerEvents: 'none' }}
                          />
                        );
                      }
                      return null;
                    })()}
                    
                    {el.text && (
                       // 标签位置基于 labelPosition（0-1），默认 0.5（中点）
                       (() => {
                         const t = el.labelPosition ?? 0.5;
                         const labelPos = getPointOnLine(
                           fromPoint, 
                           toPoint, 
                           t, 
                           el.lineType, 
                           { x: el.offsetX || 0, y: el.offsetY || 0 }
                         );
                         const labelX = labelPos.x;
                         const labelY = labelPos.y;
                         const isDraggingThisLabel = draggingLabel === el.id;
                         
                         return (
                       <foreignObject 
                             x={labelX - 50} 
                             y={labelY - 12} 
                             width="100" 
                             height="24"
                             style={{ 
                               pointerEvents: 'all', 
                               cursor: 'grab',
                               overflow: 'visible'
                             }}
                             onMouseDown={(e) => {
                               e.stopPropagation();
                               setDraggingLabel(el.id);
                               setDragStart(getMousePos(e));
                               setIsDrawing(true);
                               setHasMoved(false);
                               onHistorySave();
                             }}
                           >
                             <div 
                               className={`bg-white/95 backdrop-blur-sm px-2 py-0.5 rounded text-xs text-center text-gray-600 border shadow-sm truncate select-none ${
                                 isDraggingThisLabel ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200'
                               }`}
                               style={{ cursor: isDraggingThisLabel ? 'grabbing' : 'grab' }}
                             >
                          {el.text}
                        </div>
                      </foreignObject>
                         );
                       })()
                    )}
                 </g>
               );
            }

            // ... (Render Rect/Circle/Text - unchanged logic primarily) ...
            return (
              <g 
                key={el.id} 
                style={{ pointerEvents: 'all', cursor: selectedTool === ToolType.SELECT ? (isSelected ? 'move' : 'pointer') : 'default' }}
                onMouseDown={(e) => handleElementMouseDown(e, el.id)}
              >
                {el.type === ToolType.RECTANGLE && (
                  <>
                    <rect
                      x={el.x}
                      y={el.y}
                      width={Math.max(10, el.width || 0)}
                      height={Math.max(10, el.height || 0)}
                      rx={8} 
                      ry={8}
                      fill={el.fillColor}
                      stroke={el.strokeColor}
                      strokeWidth={el.strokeWidth}
                      filter="url(#shadow)"
                    />
                    <foreignObject x={el.x} y={el.y} width={el.width} height={el.height} style={{pointerEvents:'none'}}>
                       <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center overflow-hidden">
                          {el.icon && (
                            <div className="mb-2 opacity-80">
                              <IconRenderer name={el.icon} color={el.strokeColor} size={24} />
                            </div>
                          )}
                          <div style={{
                            fontSize: el.fontSize, 
                            color: '#1e293b', 
                            fontWeight: 500, 
                            lineHeight: 1.2,
                            wordBreak: 'break-word'
                          }}>
                             {el.text}
                          </div>
                       </div>
                    </foreignObject>
                  </>
                )}

                {el.type === ToolType.CIRCLE && (
                  <>
                    <ellipse
                      cx={el.x + (el.width || 0) / 2}
                      cy={el.y + (el.height || 0) / 2}
                      rx={(el.width || 0) / 2}
                      ry={(el.height || 0) / 2}
                      fill={el.fillColor}
                      stroke={el.strokeColor}
                      strokeWidth={el.strokeWidth}
                      filter="url(#shadow)"
                    />
                     <foreignObject x={el.x} y={el.y} width={el.width} height={el.height} style={{pointerEvents:'none'}}>
                          <div className="w-full h-full flex flex-col items-center justify-center text-center overflow-hidden p-4">
                             {el.icon && <div className="mb-1"><IconRenderer name={el.icon} color={el.strokeColor} size={20} /></div>}
                             <span style={{fontSize: el.fontSize, fontWeight: 500}}>{el.text}</span>
                          </div>
                      </foreignObject>
                  </>
                )}

                {el.type === ToolType.TEXT && (
                  <foreignObject x={el.x} y={el.y} width={200} height={50} style={{pointerEvents:'none', overflow: 'visible'}}>
                      <div style={{fontSize: el.fontSize, color: el.strokeColor, whiteSpace: 'nowrap'}} className="font-medium">
                          {el.text}
                      </div>
                  </foreignObject>
                )}

                {el.type === ToolType.GROUP && (
                  <>
                    <rect
                      x={el.x}
                      y={el.y}
                      width={el.width || 0}
                      height={el.height || 0}
                      rx={8}
                      ry={8}
                      fill={el.fillColor || 'transparent'}
                      stroke={el.strokeColor || '#94a3b8'}
                      strokeWidth={el.strokeWidth || 2}
                      strokeDasharray={el.lineStyle === LineStyle.DASHED ? '8,4' : undefined}
                      filter="url(#shadow)"
                    />
                    {/* Group label at top */}
                    {el.text && (
                      <foreignObject 
                        x={el.x + 12} 
                        y={el.y - 10} 
                        width={Math.max(80, (el.width || 0) - 24)} 
                        height={20}
                        style={{pointerEvents:'none', overflow: 'visible'}}
                      >
                        <div className="bg-white px-2 py-0.5 rounded text-xs font-medium text-gray-600 border border-gray-300 inline-block shadow-sm">
                          {el.text}
                        </div>
                      </foreignObject>
                    )}
                  </>
                )}

                {isSelected && el.type !== ToolType.TEXT && el.type !== ToolType.ARROW && (
                  <>
                   {/* Background highlight (飞书风格) */}
                   <rect
                     x={el.x - 6}
                     y={el.y - 6}
                     width={(el.width || 0) + 12}
                     height={(el.height || 0) + 12}
                     fill="rgba(24, 144, 255, 0.08)"
                     stroke="none"
                     rx={12}
                     style={{pointerEvents: 'none'}}
                   />
                   {/* Border (飞书风格 - 柔和的蓝色) */}
                   <rect
                     x={el.x - 4}
                     y={el.y - 4}
                     width={(el.width || 0) + 8}
                     height={(el.height || 0) + 8}
                     fill="none"
                     stroke="#1890ff"
                     strokeWidth="2"
                     strokeDasharray="5,5"
                     rx={10}
                     style={{pointerEvents: 'none', filter: 'drop-shadow(0 2px 4px rgba(24, 144, 255, 0.2))'}}
                   />
                   {/* Resize Handles */}
                   {(el.type === ToolType.RECTANGLE || el.type === ToolType.CIRCLE) && (
                     <>
                       {/* Top-left */}
                       <circle
                         cx={el.x}
                         cy={el.y}
                         r="6"
                         fill="#1890ff"
                         stroke="white"
                         strokeWidth="2.5"
                         style={{ cursor: 'nwse-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 2px rgba(24, 144, 255, 0.3))' }}
                         onMouseDown={(e) => {
                           e.stopPropagation();
                           setResizingHandle('nw');
                           setResizeStartSize({ width: el.width || 0, height: el.height || 0, x: el.x, y: el.y });
                           const pos = getMousePos(e);
                           setDragStart(pos);
                           setIsDrawing(true);
                           onHistorySave();
                         }}
                       />
                       {/* Top-right */}
                       <circle
                         cx={el.x + (el.width || 0)}
                         cy={el.y}
                         r="6"
                         fill="#1890ff"
                         stroke="white"
                         strokeWidth="2.5"
                         style={{ cursor: 'nesw-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 2px rgba(24, 144, 255, 0.3))' }}
                         onMouseDown={(e) => {
                           e.stopPropagation();
                           setResizingHandle('ne');
                           setResizeStartSize({ width: el.width || 0, height: el.height || 0, x: el.x, y: el.y });
                           const pos = getMousePos(e);
                           setDragStart(pos);
                           setIsDrawing(true);
                           onHistorySave();
                         }}
                       />
                       {/* Bottom-left */}
                       <circle
                         cx={el.x}
                         cy={el.y + (el.height || 0)}
                         r="6"
                         fill="#1890ff"
                         stroke="white"
                         strokeWidth="2.5"
                         style={{ cursor: 'nesw-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 2px rgba(24, 144, 255, 0.3))' }}
                         onMouseDown={(e) => {
                           e.stopPropagation();
                           setResizingHandle('sw');
                           setResizeStartSize({ width: el.width || 0, height: el.height || 0, x: el.x, y: el.y });
                           const pos = getMousePos(e);
                           setDragStart(pos);
                           setIsDrawing(true);
                           onHistorySave();
                         }}
                       />
                       {/* Bottom-right */}
                       <circle
                         cx={el.x + (el.width || 0)}
                         cy={el.y + (el.height || 0)}
                         r="6"
                         fill="#1890ff"
                         stroke="white"
                         strokeWidth="2.5"
                         style={{ cursor: 'nwse-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 2px rgba(24, 144, 255, 0.3))' }}
                         onMouseDown={(e) => {
                           e.stopPropagation();
                           setResizingHandle('se');
                           setResizeStartSize({ width: el.width || 0, height: el.height || 0, x: el.x, y: el.y });
                           const pos = getMousePos(e);
                           setDragStart(pos);
                           setIsDrawing(true);
                           onHistorySave();
                         }}
                       />
                     </>
                   )}
                   
                   {/* Connection Points (all ports) */}
                   {el.type !== ToolType.ARROW && (
                     <>
                       {getPorts(el).map((port, idx) => (
                         <circle
                           key={idx}
                           cx={port.x}
                           cy={port.y}
                           r="6"
                           fill="#10b981"
                           stroke="white"
                           strokeWidth="2"
                           style={{ cursor: 'crosshair', pointerEvents: 'all' }}
                           onMouseDown={(e) => {
                             e.stopPropagation();
                             const pos = getMousePos(e);
                             setCreatingArrowFrom({ 
                               elementId: el.id, 
                               port: port.id,
                               point: { x: port.x, y: port.y }
                             });
                             setTempArrowEnd({ x: port.x, y: port.y });
                             setDragStart(pos);
                             setIsDrawing(true);
                             onHistorySave();
                           }}
                         />
                       ))}
                     </>
                   )}
                  </>
                )}
                {isSelected && el.type === ToolType.TEXT && (
                   <rect
                   x={el.x - 4}
                   y={el.y - 4}
                   width={el.text ? el.text.length * (el.fontSize||16) * 0.6 + 8 : 50}
                   height={(el.fontSize||16) + 8}
                   fill="none"
                   stroke="#3b82f6"
                   strokeWidth="1"
                   strokeDasharray="4"
                   style={{pointerEvents: 'none'}}
                 />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Zoom Controls */}
      <div className="absolute bottom-6 right-6 flex gap-2 bg-white p-1.5 rounded-lg shadow-md border border-gray-200">
        <button 
          onClick={handleZoomOut}
          className="p-2 hover:bg-gray-100 rounded text-gray-600"
          title="Zoom Out"
        >
          <ZoomOut size={20} />
        </button>
        <span className="flex items-center justify-center w-12 text-xs font-medium text-gray-500 select-none">
          {Math.round(scale * 100)}%
        </span>
        <button 
          onClick={handleZoomIn}
          className="p-2 hover:bg-gray-100 rounded text-gray-600"
          title="Zoom In"
        >
          <ZoomIn size={20} />
        </button>
         <div className="w-px bg-gray-200 my-1 mx-1"></div>
         <button 
          onClick={handleResetZoom}
          className="p-2 hover:bg-gray-100 rounded text-gray-600"
          title="Fit to Screen / Reset"
        >
          <Maximize size={20} />
        </button>
         <div className="w-px bg-gray-200 my-1 mx-1"></div>
         <button 
          onClick={() => setShowGrid(!showGrid)}
          className={`p-2 rounded text-gray-600 transition-colors ${showGrid ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100'}`}
          title={showGrid ? "隐藏网格" : "显示网格"}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2h4v4H2V2zm6 0h4v4H8V2zm6 0h4v4h-4V2zM2 8h4v4H2V8zm6 0h4v4H8V8zm6 0h4v4h-4V8zM2 14h4v4H2v-4zm6 0h4v4H8v-4zm6 0h4v4h-4v-4z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          </svg>
        </button>
      </div>
    </div>
  );
});