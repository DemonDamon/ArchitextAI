import React, { useRef, useState, useEffect, useMemo } from 'react';
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
interface Port { x: number; y: number; dir: PortDir }

const getPorts = (el: DiagramElement): Port[] => {
  const x = el.x;
  const y = el.y;
  const w = el.width || 0;
  const h = el.height || 0;
  return [
    { x: x + w / 2, y: y, dir: 'up' },          // Top
    { x: x + w, y: y + h / 2, dir: 'right' },   // Right
    { x: x + w / 2, y: y + h, dir: 'down' },    // Bottom
    { x: x, y: y + h / 2, dir: 'left' }         // Left
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
    return getRoundedStepPathWithOffset(startX, startY, endX, endY, offsetX, offsetY);
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
const getRoundedStepPathWithOffset = (startX: number, startY: number, endX: number, endY: number, midXOffset: number, midYOffset: number = 0): string => {
  const dx = endX - startX;
  const dy = endY - startY;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const radius = 10;
  
  // 如果X坐标几乎相同（垂直线），使用直线
  if (absDx < 5) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }
  
  // 如果Y坐标几乎相同（水平线），使用直线
  if (absDy < 5) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }
  
  // STEP 线始终保持折线形状，不再根据比例转换为直线
  // 如果用户想要直线，应该使用 STRAIGHT 类型
  
  // 判断主要方向：垂直布局还是水平布局
  const isVerticalLayout = absDy > absDx;
  
  if (isVerticalLayout) {
    // 垂直布局：先垂直-再水平-再垂直 (VHV 模式)
    const baseMidY = (startY + endY) / 2;
    const midY = baseMidY + midYOffset;
    
    const verticalDist1 = Math.abs(midY - startY);
    const verticalDist2 = Math.abs(endY - midY);
    const horizontalDist = Math.abs(endX - startX);
    
    const actualRadius = Math.min(radius, verticalDist1 * 0.45, verticalDist2 * 0.45, horizontalDist * 0.45);
    
    if (actualRadius < 3) {
      return `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;
    }
    
    const goingDown = dy > 0;
    const goingRight = dx > 0;
    
    // First corner: 垂直线转水平线
    const arc1StartY = goingDown ? midY - actualRadius : midY + actualRadius;
    const arc1EndX = goingRight ? startX + actualRadius : startX - actualRadius;
    
    // Second corner: 水平线转垂直线
    const arc2StartX = goingRight ? endX - actualRadius : endX + actualRadius;
    const arc2EndY = goingDown ? midY + actualRadius : midY - actualRadius;
    
    // 修正 sweep 方向以获得外凸圆角
    const sweep1 = (goingDown && goingRight) || (!goingDown && !goingRight) ? 1 : 0;
    const sweep2 = (goingDown && goingRight) || (!goingDown && !goingRight) ? 1 : 0;
    
    return `M ${startX} ${startY} L ${startX} ${arc1StartY} A ${actualRadius} ${actualRadius} 0 0 ${sweep1} ${arc1EndX} ${midY} L ${arc2StartX} ${midY} A ${actualRadius} ${actualRadius} 0 0 ${sweep2} ${endX} ${arc2EndY} L ${endX} ${endY}`;
  } else {
    // 水平布局：先水平-再垂直-再水平 (HVH 模式)
    const baseMidX = (startX + endX) / 2;
    const midX = baseMidX + midXOffset;
    
    const horizontalDist1 = Math.abs(midX - startX);
    const horizontalDist2 = Math.abs(endX - midX);
    const verticalDist = Math.abs(endY - startY);
    
    const actualRadius = Math.min(radius, horizontalDist1 * 0.45, horizontalDist2 * 0.45, verticalDist * 0.45);
    
    if (actualRadius < 3) {
      return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
    }
    
    const goingDown = dy > 0;
    const firstSegmentRight = midX > startX;
    const secondSegmentRight = endX > midX;
    
    // First corner: 水平线转垂直线
    const arc1StartX = firstSegmentRight ? midX - actualRadius : midX + actualRadius;
    const arc1EndY = goingDown ? startY + actualRadius : startY - actualRadius;
    
    // Second corner: 垂直线转水平线
    const arc2StartY = goingDown ? endY - actualRadius : endY + actualRadius;
    const arc2EndX = secondSegmentRight ? midX + actualRadius : midX - actualRadius;
    
    // 修正 sweep 方向以获得外凸圆角
    const sweep1 = (firstSegmentRight && goingDown) || (!firstSegmentRight && !goingDown) ? 0 : 1;
    const sweep2 = (secondSegmentRight && goingDown) || (!secondSegmentRight && !goingDown) ? 1 : 0;
    
    return `M ${startX} ${startY} L ${arc1StartX} ${startY} A ${actualRadius} ${actualRadius} 0 0 ${sweep1} ${midX} ${arc1EndY} L ${midX} ${arc2StartY} A ${actualRadius} ${actualRadius} 0 0 ${sweep2} ${arc2EndX} ${endY} L ${endX} ${endY}`;
  }
};

// Helper function to generate rounded step line path (飞书风格 - 外凸圆角)
const getRoundedStepPath = (startX: number, startY: number, endX: number, endY: number): string => {
  return getRoundedStepPathWithOffset(startX, startY, endX, endY, 0, 0);
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
  
  let fromPort: Port = fromPorts[2]; // default bottom
  let toPort: Port = toPorts[0];     // default top
  
  // Smart port selection based on relative position
  if (absDy > absDx) {
    // Vertical layout (top-down or bottom-up)
    if (dy > 0) {
      // from is above to: use bottom of from, top of to
      fromPort = fromPorts[2]; // bottom
      toPort = toPorts[0];     // top
    } else {
      // from is below to: use top of from, bottom of to
      fromPort = fromPorts[0]; // top
      toPort = toPorts[2];     // bottom
    }
  } else {
    // Horizontal layout (left-right or right-left)
    if (dx > 0) {
      // from is left of to: use right of from, left of to
      fromPort = fromPorts[1]; // right
      toPort = toPorts[3];     // left
    } else {
      // from is right of to: use left of from, right of to
      fromPort = fromPorts[3]; // left
      toPort = toPorts[1];     // right
    }
  }
  
  // Fallback: if the smart selection results in a very long path, 
  // use the closest port pair instead
  const smartDist = Math.sqrt(Math.pow(fromPort.x - toPort.x, 2) + Math.pow(fromPort.y - toPort.y, 2));
  let minDist = smartDist;
  let bestFromPort = fromPort;
  let bestToPort = toPort;
  
  // Check all port combinations, but prefer the smart selection
  for (const fp of fromPorts) {
    for (const tp of toPorts) {
      const dist = Math.sqrt(Math.pow(fp.x - tp.x, 2) + Math.pow(fp.y - tp.y, 2));
      // Only use closer port if it's significantly closer (20% threshold)
      if (dist < minDist * 0.8) {
        minDist = dist;
        bestFromPort = fp;
        bestToPort = tp;
      }
    }
  }
  
  return { fromPort: bestFromPort, toPort: bestToPort };
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
  selectedElementId: string | null;
  setSelectedElementId: (id: string | null) => void;
  onHistorySave: () => void;
  selectedGroupId?: string | null;
  setSelectedGroupId?: (id: string | null) => void;
}

export const Canvas: React.FC<CanvasProps> = ({
  elements,
  setElements,
  selectedTool,
  setSelectedTool,
  selectedElementId,
  setSelectedElementId,
  onHistorySave,
  selectedGroupId,
  setSelectedGroupId
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  
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

  // Check if point is inside a group
  const findGroupAtPoint = (pos: Point): string | null => {
    for (const group of groups) {
      if (pos.x >= group.x && pos.x <= group.x + group.width &&
          pos.y >= group.y && pos.y <= group.y + group.height) {
        return group.id;
      }
    }
    return null;
  };

  // Check if point is on group border (for selection)
  const findGroupBorderAtPoint = (pos: Point): { id: string; group: DiagramGroup } | null => {
    const borderThreshold = 10; // pixels
    for (const group of groups) {
      const { x, y, width, height } = group;
      // Check if near border (but not inside)
      const nearLeft = Math.abs(pos.x - x) < borderThreshold && pos.y >= y && pos.y <= y + height;
      const nearRight = Math.abs(pos.x - (x + width)) < borderThreshold && pos.y >= y && pos.y <= y + height;
      const nearTop = Math.abs(pos.y - y) < borderThreshold && pos.x >= x && pos.x <= x + width;
      const nearBottom = Math.abs(pos.y - (y + height)) < borderThreshold && pos.x >= x && pos.x <= x + width;
      
      if (nearLeft || nearRight || nearTop || nearBottom) {
        return { id: group.id, group };
      }
    }
    return null;
  };

  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    const pos = getMousePos(e); 
    const clientPos = { x: e.clientX, y: e.clientY }; 

    // Check if clicking on group border
    if (selectedTool === ToolType.SELECT) {
      const groupBorder = findGroupBorderAtPoint(pos);
      if (groupBorder) {
        e.stopPropagation();
        setSelectedElementId(null);
        if (setSelectedGroupId) {
          setSelectedGroupId(groupBorder.id);
        }
        setDraggingGroup(groupBorder.id);
        setGroupDragOffset({ x: pos.x - groupBorder.group.x, y: pos.y - groupBorder.group.y });
        setIsDrawing(true);
        return;
      }
    }

    // Middle click or Spacebar (handled by caller usually) or just Select tool on bg
    if (selectedTool === ToolType.SELECT || e.button === 1) {
       setSelectedElementId(null);
       if (setSelectedGroupId) {
         setSelectedGroupId(null);
       }
       setIsPanning(true);
       setLastMousePos(clientPos);
    } else {
       onHistorySave();
       setIsDrawing(true);
       setHasMoved(true);
       setDragStart(pos);
       const newId = `el_${Date.now()}`;
       setCurrentElementId(newId);

       // Check if creating element inside a group
       const groupIdAtPoint = findGroupAtPoint(pos);

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
         markerEnd: true,
         groupId: groupIdAtPoint || undefined  // Auto-assign to group if created inside
       };

       setElements(prev => [...prev, newElement]);
    }
  };

  // Check if point is near an element (for connection snapping)
  const findNearestElement = (pos: Point, useExactPosition: boolean = false): { id: string; point: Point; port?: PortDirection } | null => {
    let nearest: { id: string; point: Point; dist: number; port?: PortDirection } | null = null;
    const snapDistance = 50;
    const exactSnapDistance = 30; // Increased from 15 to 30 for easier edge detection
    const portDirections: PortDirection[] = ['top', 'right', 'bottom', 'left'];

    elements.forEach(el => {
      if (el.type === ToolType.ARROW || el.id === selectedElementId) return;
      
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
    if (element.type === ToolType.ARROW && elementId === selectedElementId) {
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
        // Calculate step line segments
        const midX = (fromPoint.x + toPoint.x) / 2;
        const midY1 = fromPoint.y;
        const midY2 = toPoint.y;
        
        // First horizontal segment: from (fromPoint.x, fromPoint.y) to (midX, fromPoint.y)
        const distToFirstHoriz = Math.abs(pos.y - fromPoint.y);
        const isOnFirstHoriz = pos.x >= Math.min(fromPoint.x, midX) && pos.x <= Math.max(fromPoint.x, midX) && distToFirstHoriz < 20;
        
        // Vertical segment: from (midX, fromPoint.y) to (midX, toPoint.y)
        const distToVert = Math.abs(pos.x - midX);
        const isOnVert = pos.y >= Math.min(fromPoint.y, toPoint.y) && pos.y <= Math.max(fromPoint.y, toPoint.y) && distToVert < 20;
        
        // Second horizontal segment: from (midX, toPoint.y) to (toPoint.x, toPoint.y)
        const distToSecondHoriz = Math.abs(pos.y - toPoint.y);
        const isOnSecondHoriz = pos.x >= Math.min(midX, toPoint.x) && pos.x <= Math.max(midX, toPoint.x) && distToSecondHoriz < 20;
        
        if (isOnFirstHoriz || isOnSecondHoriz) {
          setDraggingStepSegment('horizontal');
        } else if (isOnVert) {
          setDraggingStepSegment('vertical');
        } else {
          setDraggingStepSegment(null);
        }
      } else {
        setDraggingStepSegment(null);
      }
    }
    
    // Check if clicking on resize handle or connection point
    const isElementSelected = elementId === selectedElementId;
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
    setSelectedElementId(elementId);
    if (setSelectedGroupId) {
      setSelectedGroupId(null); // Clear group selection when selecting element
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
    if (draggingConnectionPoint && selectedElementId) {
      setTempConnectionPoint(pos);
      
      // Check for snapping to nearby elements - use exact positioning for better detection
      const nearest = findNearestElement(pos, true);
      setHoveredElementId(nearest?.id || null);
      
      return;
    }

    // Handle resize
    if (resizingHandle && resizeStartSize && selectedElementId) {
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

    // Handle group dragging
    if (draggingGroup && groupDragOffset) {
      const group = groups.find(g => g.id === draggingGroup);
      if (group) {
        // Save history on first move
        if (!hasMoved) {
          onHistorySave();
          setHasMoved(true);
        }
        
        const dx = pos.x - group.x - groupDragOffset.x;
        const dy = pos.y - group.y - groupDragOffset.y;
        
        // Move all elements in the group
        setElements(prev => prev.map(el => {
          if (el.groupId === draggingGroup && el.type !== ToolType.ARROW) {
            return { ...el, x: el.x + dx, y: el.y + dy };
          }
          return el;
        }));
        
        // Update drag offset for next move
        setGroupDragOffset({ x: pos.x - group.x, y: pos.y - group.y });
      }
      return;
    }

    if (!isDrawing || !dragStart) return;

    if (!hasMoved && (Math.abs(pos.x - dragStart.x) > 2 || Math.abs(pos.y - dragStart.y) > 2)) {
      if (selectedTool === ToolType.SELECT && selectedElementId) {
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
        
        if (arrowElement.fromId && arrowElement.toId) {
          const fromNode = nodeMap.get(arrowElement.fromId);
          const toNode = nodeMap.get(arrowElement.toId);
          if (fromNode && toNode) {
            const { fromPort, toPort } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
            fromPoint = fromPort;
            toPoint = toPort;
          }
        }
        
        // 计算鼠标位置在线上的投影位置（t 值，0-1）
        const lineVecX = toPoint.x - fromPoint.x;
        const lineVecY = toPoint.y - fromPoint.y;
        const lineLenSq = lineVecX * lineVecX + lineVecY * lineVecY;
        
        if (lineLenSq > 0) {
          const mouseDiffX = pos.x - fromPoint.x;
          const mouseDiffY = pos.y - fromPoint.y;
          let t = (mouseDiffX * lineVecX + mouseDiffY * lineVecY) / lineLenSq;
          // 限制 t 在 0.1 到 0.9 之间，不让标签太靠近端点
          t = Math.max(0.1, Math.min(0.9, t));
          
          setElements(prev => prev.map(el => 
            el.id === draggingLabel 
              ? { ...el, labelPosition: t }
              : el
          ));
        }
      }
      return;
    }

    if (selectedTool === ToolType.SELECT && selectedElementId && !resizingHandle && !draggingConnectionPoint) {
      // Check if dragging element into a group
      const groupIdAtPoint = findGroupAtPoint(pos);
      const currentElement = elements.find(el => el.id === selectedElementId);
      
      setElements(prev => prev.map(el => {
        if (el.id === selectedElementId) {
          const updates: Partial<DiagramElement> = {};
          
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
                // Use dragStart if available, otherwise initialize it
                const startPos = dragStart || pos;
                if (!dragStart) {
                  setDragStart(pos);
                }
                
                if (draggingStepSegment === 'horizontal') {
                  // Dragging horizontal segment: allow vertical movement
                  const deltaY = pos.y - startPos.y;
                  const currentOffsetY = el.offsetY || 0;
                  updates.offsetX = el.offsetX || 0; // Keep existing offsetX
                  updates.offsetY = currentOffsetY + deltaY;
                  setDragStart(pos);
                } else if (draggingStepSegment === 'vertical') {
                  // Dragging vertical segment: only allow horizontal movement
                  const deltaX = pos.x - startPos.x;
                  const currentOffsetX = el.offsetX || 0;
                  updates.offsetX = currentOffsetX + deltaX;
                  updates.offsetY = el.offsetY || 0; // Keep existing offsetY
                  setDragStart(pos);
                }
              } else if (dragOffset) {
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
                } else if (lineType === LineType.CURVE) {
                  // For curves: allow free movement
                  updates.offsetX = rawOffsetX;
                  updates.offsetY = rawOffsetY;
                } else {
                  updates.offsetX = rawOffsetX;
                  updates.offsetY = rawOffsetY;
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
            updates.x = pos.x - (dragOffset?.x || 0);
            updates.y = pos.y - (dragOffset?.y || 0);
            
            // Auto-assign to group if dragged into group area (only for non-arrow elements)
            if (groupIdAtPoint && el.type !== ToolType.ARROW) {
              updates.groupId = groupIdAtPoint;
            } else if (!groupIdAtPoint && currentElement?.groupId) {
              // If dragged out of group, check if still inside
              const stillInGroup = findGroupAtPoint({ 
                x: updates.x! + (el.width || 0) / 2, 
                y: updates.y! + (el.height || 0) / 2 
              });
              if (!stillInGroup) {
                updates.groupId = undefined;
              }
            }
          }
          
          return { ...el, ...updates };
        }
        return el;
      }));
      
      if (elements.find(e => e.id === selectedElementId)?.type === ToolType.ARROW) {
        setDragStart(pos);
      }
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
        setSelectedElementId(newArrow.id);
      }
      
      setCreatingArrowFrom(null);
      setTempArrowEnd(null);
      setHoveredElementId(null);
    }
    
    // Handle connection point drag end
    if (draggingConnectionPoint && selectedElementId && tempConnectionPoint) {
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
              const portDirs: PortDirection[] = ['top', 'right', 'bottom', 'left'];
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
                  ? { ...el, fromId: arrowElement.fromId, fromPort: portDirs[selectedPortIndex], x: undefined, y: undefined, offsetX: undefined, offsetY: undefined }
                  : el
              ));
            }
          } else if (nearest) {
            // Dragging to different element - use nearest port
            onHistorySave();
            setElements(prev => prev.map(el => 
              el.id === selectedElementId 
                ? { ...el, fromId: nearest.id, fromPort: nearest.port, x: undefined, y: undefined, offsetX: undefined, offsetY: undefined }
                : el
            ));
          } else {
            // Use manual coordinates - clear fromId and fromPort
            onHistorySave();
            setElements(prev => prev.map(el => 
              el.id === selectedElementId 
                ? { ...el, x: tempConnectionPoint!.x, y: tempConnectionPoint!.y, fromId: undefined, fromPort: undefined, offsetX: undefined, offsetY: undefined }
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
              const portDirs: PortDirection[] = ['top', 'right', 'bottom', 'left'];
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
                  ? { ...el, toId: arrowElement.toId, toPort: portDirs[selectedPortIndex], endX: undefined, endY: undefined, offsetX: undefined, offsetY: undefined }
                  : el
              ));
            }
          } else if (nearest) {
            // Dragging to different element - use nearest port
            onHistorySave();
            setElements(prev => prev.map(el => 
              el.id === selectedElementId 
                ? { ...el, toId: nearest.id, toPort: nearest.port, endX: undefined, endY: undefined, offsetX: undefined, offsetY: undefined }
                : el
            ));
          } else {
            // Use manual coordinates - clear toId and toPort
            onHistorySave();
            setElements(prev => prev.map(el => 
              el.id === selectedElementId 
                ? { ...el, endX: tempConnectionPoint!.x, endY: tempConnectionPoint!.y, toId: undefined, toPort: undefined, offsetX: undefined, offsetY: undefined }
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
      if(currentElementId) setSelectedElementId(currentElementId);
    }
  };

  const nodeMap = new Map(elements.map(el => [el.id, el]));
  
  // Calculate groups from elements
  const groups = useMemo(() => {
    const groupMap = new Map<string, DiagramGroup>();
    const groupElements = new Map<string, DiagramElement[]>();
    
    // Collect elements by groupId
    elements.forEach(el => {
      if (el.groupId && el.type !== ToolType.ARROW) {
        if (!groupElements.has(el.groupId)) {
          groupElements.set(el.groupId, []);
        }
        groupElements.get(el.groupId)!.push(el);
      }
    });
    
    // Calculate bounding box for each group
    groupElements.forEach((els, groupId) => {
      if (els.length === 0) return;
      
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let groupLabel = '';
      
      els.forEach(el => {
        const x = el.x;
        const y = el.y;
        const w = el.width || 0;
        const h = el.height || 0;
        
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
        
        // Use first element's text as group label if available
        if (!groupLabel && el.text) {
          groupLabel = el.text;
        }
      });
      
      // Add padding
      const padding = 30;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;
      
      groupMap.set(groupId, {
        id: groupId,
        label: groupLabel || `Group ${groupId.substring(0, 8)}`,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        strokeColor: '#94a3b8',
        fillColor: 'rgba(148, 163, 184, 0.05)',
        strokeWidth: 2,
        strokeDasharray: '8,4'
      });
    });
    
    return Array.from(groupMap.values());
  }, [elements]);
  
  // Sort: Groups first, then arrows last so they draw on top
  const sortedElements = [...elements].sort((a, b) => {
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
          {/* Render Groups First */}
          {groups.map(group => {
            const isSelected = selectedGroupId === group.id;
            return (
              <g key={`group-${group.id}`}>
                <rect
                  x={group.x}
                  y={group.y}
                  width={group.width}
                  height={group.height}
                  fill={group.fillColor}
                  stroke={isSelected ? '#1890ff' : group.strokeColor}
                  strokeWidth={isSelected ? group.strokeWidth! + 1 : group.strokeWidth}
                  strokeDasharray={group.strokeDasharray}
                  rx={8}
                  ry={8}
                  style={{ 
                    pointerEvents: selectedTool === ToolType.SELECT ? 'all' : 'none',
                    cursor: selectedTool === ToolType.SELECT ? 'move' : 'default'
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    if (selectedTool === ToolType.SELECT && setSelectedGroupId) {
                      setSelectedElementId(null);
                      setSelectedGroupId(group.id);
                      setDraggingGroup(group.id);
                      const pos = getMousePos(e);
                      setGroupDragOffset({ x: pos.x - group.x, y: pos.y - group.y });
                      setIsDrawing(true);
                      onHistorySave(); // Save history when starting to drag group
                    }
                  }}
                />
                <text
                  x={group.x + 12}
                  y={group.y + 20}
                  fontSize="12"
                  fontWeight="600"
                  fill={isSelected ? '#2563eb' : group.strokeColor}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {group.label}
                </text>
              </g>
            );
          })}
          
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
            const isSelected = el.id === selectedElementId;

            if (el.type === ToolType.ARROW) {
               let pathData = "";
               let fromPoint: Point = { x: el.x, y: el.y };
               let toPoint: Point = { x: el.endX || el.x, y: el.endY || el.y };

               // Simple logic: Use smart anchors if both fromId and toId exist
               if (el.fromId && el.toId) {
                 const fromNode = nodeMap.get(el.fromId);
                 const toNode = nodeMap.get(el.toId);
                 
                 if (fromNode && toNode) {
                   const fromPorts = getPorts(fromNode as DiagramElement);
                   const toPorts = getPorts(toNode as DiagramElement);
                   const portIndexMap: Record<PortDirection, number> = { top: 0, right: 1, bottom: 2, left: 3 };
                   
                   // 使用记录的端口方向（吸附功能）
                   if (el.fromPort) {
                     fromPoint = fromPorts[portIndexMap[el.fromPort]];
                   } else {
                     // Fallback: use smart selection
                     const { fromPort } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
                     fromPoint = fromPort;
                   }
                   
                   if (el.toPort) {
                     toPoint = toPorts[portIndexMap[el.toPort]];
                   } else {
                     // Fallback: use smart selection
                     const { toPort } = selectBestPorts(fromNode as DiagramElement, toNode as DiagramElement);
                     toPoint = toPort;
                   }
                   
                   // Generate path based on line type
                   if (el.lineType === LineType.STRAIGHT) {
                     pathData = `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
                   } else if (el.lineType === LineType.STEP) {
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
               } else if (el.fromId && !el.toId) {
                 // Connected from element but not to element
                 const fromNode = nodeMap.get(el.fromId);
                 if (fromNode) {
                   toPoint = { x: el.endX || el.x, y: el.endY || el.y };
                   
                   const fromNodeEl = fromNode as DiagramElement;
                   const fromPorts = getPorts(fromNodeEl);
                   const portIndexMap: Record<PortDirection, number> = { top: 0, right: 1, bottom: 2, left: 3 };
                   
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
               if ((el.fromId || el.toId) && (el.offsetX || el.offsetY)) {
                 pathData = applyOffsetToPath(pathData, el.offsetX || 0, el.offsetY || 0, el.lineType || LineType.STRAIGHT);
                 
                 // Update endpoint positions after applying offset for straight lines
                 if (el.lineType === LineType.STRAIGHT || !el.lineType) {
                   // For straight lines, both endpoints move by the offset
                   fromPoint = { x: fromPoint.x + (el.offsetX || 0), y: fromPoint.y + (el.offsetY || 0) };
                   toPoint = { x: toPoint.x + (el.offsetX || 0), y: toPoint.y + (el.offsetY || 0) };
                 }
                 // For STEP and CURVE lines, endpoints don't move (only control points do)
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
                 } else {
                   toPoint = tempConnectionPoint;
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
                        
                        {/* Line segment control point for STEP lines - 只显示一个中间控制点 */}
                        {el.lineType === LineType.STEP && (
                          <>
                            {/* Single control point at the middle of the step line */}
                            {(() => {
                              const dx = toPoint.x - fromPoint.x;
                              const dy = toPoint.y - fromPoint.y;
                              const absDx = Math.abs(dx);
                              const absDy = Math.abs(dy);
                              
                              // 如果线实际上是直线（absDx < 5 或 absDy < 5），不显示控制点
                              if (absDx < 5 || absDy < 5) {
                                return null;
                              }
                              
                              const isVerticalLayout = absDy > absDx;
                              
                              // 计算线的中点
                              const midX = (fromPoint.x + toPoint.x) / 2;
                              const midY = (fromPoint.y + toPoint.y) / 2;
                              
                              if (isVerticalLayout) {
                                // VHV 模式：控制点在水平段中间，横向小横杠
                                const actualMidY = midY + (el.offsetY || 0);
                                
                                return (
                                  <rect
                                    x={midX - 12}
                                    y={actualMidY - 3}
                                    width="24"
                                    height="6"
                                    fill="#1890ff"
                                    stroke="white"
                                    strokeWidth="1.5"
                                    rx="3"
                                    style={{ cursor: 'ns-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 3px rgba(24, 144, 255, 0.4))' }}
                                    onMouseDown={(e) => {
                                      e.stopPropagation();
                                      const pos = getMousePos(e);
                                      setSelectedElementId(el.id);
                                      setDragStart(pos);
                                      setDraggingStepSegment('horizontal');
                                      setIsDrawing(true);
                                      setHasMoved(false);
                                      onHistorySave();
                                    }}
                                  />
                                );
                              } else {
                                // HVH 模式：控制点在垂直段中间，竖向小横杠
                                const actualMidX = midX + (el.offsetX || 0);
                                
                                return (
                                  <rect
                                    x={actualMidX - 3}
                                    y={midY - 12}
                                    width="6"
                                    height="24"
                                    fill="#1890ff"
                                    stroke="white"
                                    strokeWidth="1.5"
                                    rx="3"
                                    style={{ cursor: 'ew-resize', pointerEvents: 'all', filter: 'drop-shadow(0 1px 3px rgba(24, 144, 255, 0.4))' }}
                                    onMouseDown={(e) => {
                                      e.stopPropagation();
                                      const pos = getMousePos(e);
                                      setSelectedElementId(el.id);
                                      setDragStart(pos);
                                      setDraggingStepSegment('vertical');
                                      setIsDrawing(true);
                                      setHasMoved(false);
                                      onHistorySave();
                                    }}
                                  />
                                );
                              }
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
                              
                              // 小横杠垂直于线条方向（旋转90度）
                              // 横杠本身是水平的 (24x6)，通过旋转使其垂直于线条
                              const barWidth = 24;
                              const barHeight = 6;
                              
                              return (
                                <rect
                                  x={-barWidth / 2}
                                  y={-barHeight / 2}
                                  width={barWidth}
                                  height={barHeight}
                                  fill="#1890ff"
                                  stroke="white"
                                  strokeWidth="1.5"
                                  rx="3"
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
                              
                              return (
                                <circle
                                  cx={midX}
                                  cy={midY}
                                  r="8"
                                  fill="#1890ff"
                                  stroke="white"
                                  strokeWidth="2"
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
                         const labelX = fromPoint.x + (toPoint.x - fromPoint.x) * t;
                         const labelY = fromPoint.y + (toPoint.y - fromPoint.y) * t;
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

                {isSelected && el.type !== ToolType.TEXT && (
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
                   
                   {/* Connection Points (midpoints of edges) */}
                   {el.type !== ToolType.ARROW && (
                     <>
                       {/* Top */}
                       <circle
                         cx={el.x + (el.width || 0) / 2}
                         cy={el.y}
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
                             port: 'top',
                             point: { x: el.x + (el.width || 0) / 2, y: el.y }
                           });
                           setTempArrowEnd({ x: el.x + (el.width || 0) / 2, y: el.y });
                           setDragStart(pos);
                           setIsDrawing(true);
                           onHistorySave();
                         }}
                       />
                       {/* Right */}
                       <circle
                         cx={el.x + (el.width || 0)}
                         cy={el.y + (el.height || 0) / 2}
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
                             port: 'right',
                             point: { x: el.x + (el.width || 0), y: el.y + (el.height || 0) / 2 }
                           });
                           setTempArrowEnd({ x: el.x + (el.width || 0), y: el.y + (el.height || 0) / 2 });
                           setDragStart(pos);
                           setIsDrawing(true);
                           onHistorySave();
                         }}
                       />
                       {/* Bottom */}
                       <circle
                         cx={el.x + (el.width || 0) / 2}
                         cy={el.y + (el.height || 0)}
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
                             port: 'bottom',
                             point: { x: el.x + (el.width || 0) / 2, y: el.y + (el.height || 0) }
                           });
                           setTempArrowEnd({ x: el.x + (el.width || 0) / 2, y: el.y + (el.height || 0) });
                           setDragStart(pos);
                           setIsDrawing(true);
                           onHistorySave();
                         }}
                       />
                       {/* Left */}
                       <circle
                         cx={el.x}
                         cy={el.y + (el.height || 0) / 2}
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
                             port: 'left',
                             point: { x: el.x, y: el.y + (el.height || 0) / 2 }
                           });
                           setTempArrowEnd({ x: el.x, y: el.y + (el.height || 0) / 2 });
                           setDragStart(pos);
                           setIsDrawing(true);
                           onHistorySave();
                         }}
                       />
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
};