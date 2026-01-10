import React, { useState, useEffect, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Toolbar } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Canvas, CanvasRef } from './components/Canvas';
import { GeminiInput } from './components/GeminiInput';
import { DslEditorPanel } from './components/DslEditorPanel';
import { DiagramElement, ToolType, GenerationHistory, LineStyle } from './types';
import { FileImage, Trash2, CheckCircle2, AlertCircle, RotateCcw, RotateCw, Sparkles } from 'lucide-react';
import { autoLayout } from './services/layoutService';

const STORAGE_KEY = 'paperplot-elements-v1';
const HISTORY_STORAGE_KEY = 'paperplot-history-v1';

// Compress image to thumbnail for storage (reduces size significantly)
const compressImageForStorage = (imageBase64: string, maxWidth: number = 200, maxHeight: number = 150, quality: number = 0.7): Promise<string | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      // Calculate new dimensions
      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageBase64;
  });
};

const App: React.FC = () => {
  const [elements, setElements] = useState<DiagramElement[]>([]);
  const [selectedTool, setSelectedTool] = useState<ToolType>(ToolType.SELECT);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [clipboard, setClipboard] = useState<DiagramElement[]>([]);

  // History Stacks
  const [past, setPast] = useState<DiagramElement[][]>([]);
  const [future, setFuture] = useState<DiagramElement[][]>([]);
  
  // Generation History
  const [generationHistory, setGenerationHistory] = useState<GenerationHistory[]>([]);
  
  // Track if generation is in progress
  const isGeneratingRef = useRef(false);
  const canvasRef = useRef<CanvasRef>(null);

  // DSL Editor state
  const [dslEditorElementId, setDslEditorElementId] = useState<string | null>(null);

  // Beautify layout state
  const [isBeautifying, setIsBeautifying] = useState(false);

  // Load from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setElements(parsed);
        } else {
          console.warn("Saved diagram is not an array, clearing storage");
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {
        console.error("Failed to parse saved diagram", e);
      }
    }
    
    // Load generation history with size check and cleanup
    const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        // Limit to last 20 items and remove images if still too large
        const limited = Array.isArray(parsed) ? parsed.slice(0, 20) : [];
        
        // Try to set the limited history
        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(limited));
          setGenerationHistory(limited);
        } catch (e) {
          // If still too large, remove images
          console.warn('[App] History too large, removing images');
          const withoutImages = limited.map((item: GenerationHistory) => ({
            ...item,
            image: null
          }));
          try {
            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(withoutImages));
            setGenerationHistory(withoutImages);
          } catch (finalError) {
            // Last resort: clear history
            console.error('[App] Failed to save cleaned history, clearing:', finalError);
            localStorage.removeItem(HISTORY_STORAGE_KEY);
            setGenerationHistory([]);
          }
        }
      } catch (e) {
        console.error("Failed to parse saved history", e);
        // Clear corrupted history
        try {
          localStorage.removeItem(HISTORY_STORAGE_KEY);
        } catch (clearError) {
          console.error("Failed to clear corrupted history", clearError);
        }
      }
    }
    
    setIsLoaded(true);
  }, []);

  // Save to local storage whenever elements change
  useEffect(() => {
    if (isLoaded) {
      setSaveStatus('saving');
      const timer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(elements));
        setSaveStatus('saved');
      }, 500); // Debounce save slightly
      return () => clearTimeout(timer);
    }
  }, [elements, isLoaded]);

  // --- History Logic ---

  const saveToHistory = useCallback(() => {
    setPast(prev => [...prev, elements]);
    setFuture([]);
  }, [elements]);

  const handleUndo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, -1);
    
    setFuture(prev => [elements, ...prev]);
    setElements(previous);
    setPast(newPast);
  }, [elements, past]);

  const handleRedo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);

    setPast(prev => [...prev, elements]);
    setElements(next);
    setFuture(newFuture);
  }, [elements, future]);

  const deleteSelectedElements = useCallback(() => {
    if (selectedElementIds.length === 0) return;
    saveToHistory();
    setElements(prev => prev.filter(el => !selectedElementIds.includes(el.id)));
    setSelectedElementIds([]);
  }, [selectedElementIds, saveToHistory]);

  // Clean up invalid arrows (arrows that are too short) - called manually or on mount
  const cleanupInvalidArrows = useCallback(() => {
    const MIN_ARROW_DISTANCE = 20;
    let hasInvalidArrows = false;
    
    const cleanedElements = elements.filter(el => {
      if (el.type !== ToolType.ARROW) return true;
      
      // Check if arrow has both fromId and toId (smart connection)
      if (el.fromId && el.toId) {
        const fromNode = elements.find(e => e.id === el.fromId);
        const toNode = elements.find(e => e.id === el.toId);
        
        if (fromNode && toNode) {
          // Calculate distance between connected nodes
          const fromX = fromNode.x + (fromNode.width || 0) / 2;
          const fromY = fromNode.y + (fromNode.height || 0) / 2;
          const toX = toNode.x + (toNode.width || 0) / 2;
          const toY = toNode.y + (toNode.height || 0) / 2;
          
          const dx = toX - fromX;
          const dy = toY - fromY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < MIN_ARROW_DISTANCE) {
            hasInvalidArrows = true;
            return false; // Remove this arrow
          }
        }
        return true;
      }
      
      // Check if arrow has manual coordinates
      if (el.endX !== undefined && el.endY !== undefined) {
        const dx = el.endX - el.x;
        const dy = el.endY - el.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < MIN_ARROW_DISTANCE) {
          hasInvalidArrows = true;
          return false; // Remove this arrow
        }
      }
      
      return true;
    });
    
    if (hasInvalidArrows) {
      saveToHistory();
      setElements(cleanedElements);
      // If deleted arrow was selected, clear selection
      const remainingIds = new Set(cleanedElements.map(el => el.id));
      const newSelection = selectedElementIds.filter(id => remainingIds.has(id));
      if (newSelection.length !== selectedElementIds.length) {
        setSelectedElementIds(newSelection);
      }
    }
  }, [elements, selectedElementIds, saveToHistory]);

  // Auto-cleanup invalid arrows on mount (one-time cleanup)
  useEffect(() => {
    cleanupInvalidArrows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Copy/Paste functionality
  const handleCopy = useCallback(() => {
    if (selectedElementIds.length === 0) return;
    const selectedElements = elements.filter(el => selectedElementIds.includes(el.id));
    setClipboard(selectedElements);
  }, [elements, selectedElementIds]);

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) return;
    saveToHistory();
    
    // Create ID mapping for remapping connections
    const idMap = new Map<string, string>();
    clipboard.forEach(el => {
      idMap.set(el.id, `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
    });

    const offset = 20; // Offset pasted elements
    const newElements = clipboard.map(el => {
      const newId = idMap.get(el.id)!;
      
      return {
        ...el,
        id: newId,
        x: el.x + offset,
        y: el.y + offset,
        // Remap internal connections
        fromId: el.fromId && idMap.has(el.fromId) ? idMap.get(el.fromId) : undefined,
        toId: el.toId && idMap.has(el.toId) ? idMap.get(el.toId) : undefined,
        // Clear groupId if group is not in clipboard
        groupId: el.groupId && idMap.has(el.groupId) ? idMap.get(el.groupId) : undefined
      };
    });

    setElements(prev => [...prev, ...newElements]);
    setSelectedElementIds(newElements.map(e => e.id));
  }, [clipboard, saveToHistory]);

  // Create Group from selection
  const handleCreateGroup = useCallback(() => {
    if (selectedElementIds.length === 0) return;
    
    const selectedEls = elements.filter(el => selectedElementIds.includes(el.id));
    if (selectedEls.length === 0) return;

    saveToHistory();

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedEls.forEach(el => {
      let w = el.width || 0;
      let h = el.height || 0;
      
      // Estimate width/height for elements that might not have it set
      if (el.type === ToolType.TEXT) {
        // Use a reasonable default if not present. 
        // Ideally this should be measured, but for bounding box, an estimation is okay or use min size
        w = w || (el.text ? el.text.length * (el.fontSize || 16) * 0.6 + 20 : 100); 
        h = h || ((el.fontSize || 16) * 1.5 + 10);
      }
      
      const elMinX = el.x;
      const elMinY = el.y;
      const elMaxX = el.x + w;
      const elMaxY = el.y + h;
      
      minX = Math.min(minX, elMinX);
      minY = Math.min(minY, elMinY);
      maxX = Math.max(maxX, elMaxX);
      maxY = Math.max(maxY, elMaxY);
    });
    
    // Add padding
    const padding = 40;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const groupId = `group_${Date.now()}`;
    const groupElement: DiagramElement = {
      id: groupId,
      type: ToolType.GROUP,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      text: 'New Group',
      fillColor: 'rgba(148, 163, 184, 0.05)',
      strokeColor: '#94a3b8',
      strokeWidth: 2,
      lineStyle: LineStyle.DASHED
    };

    // Update children to reference group
    const updatedElements = elements.map(el => {
      if (selectedElementIds.includes(el.id)) {
        return { ...el, groupId };
      }
      return el;
    });

    setElements([...updatedElements, groupElement]);
    setSelectedElementIds([groupId]);
  }, [elements, selectedElementIds, saveToHistory]);

  // Select All
  const handleSelectAll = useCallback(() => {
    const allIds = elements.filter(el => el.type !== ToolType.ARROW).map(el => el.id);
    setSelectedElementIds(allIds);
  }, [elements]);

  // Beautify Layout - 一键美化布局
  const handleBeautifyLayout = useCallback(async () => {
    if (elements.length === 0) return;
    
    // 检查是否有节点（非箭头元素）
    const hasNodes = elements.some(el => el.type !== ToolType.ARROW);
    if (!hasNodes) return;

    setIsBeautifying(true);
    saveToHistory();

    try {
      const beautifiedElements = await autoLayout(elements);
      setElements(beautifiedElements);
      setSelectedElementIds([]);
      
      // 触发 Fit View
      setTimeout(() => {
        canvasRef.current?.fitView(beautifiedElements);
      }, 100);
    } catch (error) {
      console.error('[App] Beautify layout failed:', error);
    } finally {
      setIsBeautifying(false);
    }
  }, [elements, saveToHistory]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      
      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      
      // Copy
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }
      
      // Paste
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        e.preventDefault();
        handlePaste();
        return;
      }
      
      // Group
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        handleCreateGroup();
        return;
      }
      
      // Select All
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }
      
      // Delete selected elements (Backspace or Delete)
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedElementIds.length > 0) {
        e.preventDefault();
        deleteSelectedElements();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleCopy, handlePaste, handleCreateGroup, handleSelectAll, selectedElementIds, deleteSelectedElements]);


  const updateSelectedElement = (updates: Partial<DiagramElement>, saveHistory: boolean = true) => {
    // Update the primary selected element (last in selection)
    if (selectedElementIds.length === 0) return;
    
    const primaryId = selectedElementIds[selectedElementIds.length - 1];
    
    if (saveHistory) {
      saveToHistory();
    }

    setElements(prev => prev.map(el =>
      el.id === primaryId ? { ...el, ...updates } : el
    ));
  };


  const handleClearCanvas = () => {
    // If generating, clear immediately without confirmation
    if (isGeneratingRef.current) {
      flushSync(() => {
        setElements([]);
        setSelectedElementIds([]);
      });
      localStorage.removeItem(STORAGE_KEY);
      setConfirmClear(false);
      return;
    }
    
    // Normal clear with confirmation
    if (confirmClear) {
      saveToHistory();
      flushSync(() => {
        setElements([]);
        setSelectedElementIds([]);
      });
      localStorage.removeItem(STORAGE_KEY);
      setConfirmClear(false);
    } else {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3001);
    }
  };

  // Prepare SVG for export (returns cleaned SVG element)
  const prepareSVGForExport = (): SVGSVGElement | null => {
    const svgEl = document.getElementById('paperplot-canvas');
    if (!svgEl || !(svgEl instanceof SVGSVGElement)) {
      alert('Could not find canvas to export.');
      return null;
    }
    
    // Clone the node so we can modify it for export
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    
    // Get the content group (the <g> element with transform)
    const contentGroup = svgEl.querySelector('g[transform]');
    let viewBoxStr = "0 0 800 600"; // Default fallback
    let width = 800;
    let height = 600;
    
    if (contentGroup) {
        try {
            // Get bounding box - need to account for current transform
            // First, temporarily remove transform to get accurate bbox
            const originalTransform = contentGroup.getAttribute('transform') || '';
            contentGroup.setAttribute('transform', '');
            
            const bbox = (contentGroup as SVGGElement).getBBox();
            
            // Restore transform
            contentGroup.setAttribute('transform', originalTransform);
            
            if (bbox.width > 0 && bbox.height > 0) {
                const padding = 50;
                const minX = bbox.x - padding;
                const minY = bbox.y - padding;
                width = Math.max(bbox.width + padding * 2, 400);
                height = Math.max(bbox.height + padding * 2, 300);
                viewBoxStr = `${minX} ${minY} ${width} ${height}`;
            }
        } catch (e) {
            console.warn("Could not calculate BBox, using default:", e);
        }
    }

    // Apply attributes to the clone
    clone.setAttribute('viewBox', viewBoxStr);
    clone.setAttribute('width', width.toString());
    clone.setAttribute('height', height.toString());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    
    // Set background
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('width', '100%');
    bgRect.setAttribute('height', '100%');
    bgRect.setAttribute('fill', '#ffffff');
    clone.insertBefore(bgRect, clone.firstChild);
    
    clone.removeAttribute('class');
    clone.removeAttribute('id');
    clone.style.backgroundColor = '#ffffff';

    // Remove the pan/zoom transform from the content group in clone
    const cloneContentGroup = clone.querySelector('g[transform]');
    if (cloneContentGroup) {
        cloneContentGroup.setAttribute('transform', '');
    }

    // Remove all interactive elements (resize handles, connection points, etc.)
    clone.querySelectorAll('circle[style*="cursor"]').forEach(el => el.remove());
    clone.querySelectorAll('[onmousedown]').forEach(el => {
      el.removeAttribute('onmousedown');
      el.removeAttribute('onmousemove');
      el.removeAttribute('onmouseup');
    });

    // Ensure all elements are visible (remove pointer-events restrictions)
    clone.querySelectorAll('[style*="pointer-events"]').forEach(el => {
      const htmlEl = el as HTMLElement;
      htmlEl.style.pointerEvents = 'none';
    });

    // Convert foreignObject elements to native SVG to avoid tainted canvas
    clone.querySelectorAll('foreignObject').forEach(foreignObj => {
      try {
        const x = parseFloat(foreignObj.getAttribute('x') || '0');
        const y = parseFloat(foreignObj.getAttribute('y') || '0');
        const width = parseFloat(foreignObj.getAttribute('width') || '0');
        const height = parseFloat(foreignObj.getAttribute('height') || '0');
        
        // Extract text content from the foreignObject
        const textContent = foreignObj.textContent?.trim() || '';
        
        if (textContent && width > 50) { // Only convert if it's a substantial element (not arrow labels)
          // Create a group to hold icon and text
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          
          // Try to extract the actual SVG icon from lucide-react
          const iconSvg = foreignObj.querySelector('svg');
          let iconY = y + height / 3;
          let textY = y + height / 2;
          
          if (iconSvg) {
            // Clone the icon SVG and convert it to native SVG
            const iconGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            
            // Get icon properties
            const iconSize = parseFloat(iconSvg.getAttribute('width') || iconSvg.getAttribute('viewBox')?.split(' ')[2] || '24');
            const iconColor = iconSvg.getAttribute('stroke') || iconSvg.getAttribute('color') || '#94a3b8';
            
            // Position the icon at the center-top of the element
            const iconX = x + width / 2;
            iconGroup.setAttribute('transform', `translate(${iconX - iconSize / 2}, ${iconY - iconSize / 2})`);
            
            // Copy all child elements of the icon SVG
            Array.from(iconSvg.children).forEach(child => {
              const clonedChild = child.cloneNode(true) as SVGElement;
              // Ensure stroke color is set
              if (clonedChild.hasAttribute('stroke') || clonedChild.nodeName === 'path' || clonedChild.nodeName === 'line' || clonedChild.nodeName === 'circle' || clonedChild.nodeName === 'rect') {
                if (!clonedChild.getAttribute('stroke') || clonedChild.getAttribute('stroke') === 'currentColor') {
                  clonedChild.setAttribute('stroke', iconColor);
                }
                if (!clonedChild.getAttribute('fill') || clonedChild.getAttribute('fill') === 'currentColor') {
                  clonedChild.setAttribute('fill', 'none');
                }
              }
              iconGroup.appendChild(clonedChild);
            });
            
            group.appendChild(iconGroup);
            
            // Adjust text position below the icon
            textY = y + height / 2 + 15;
          }
          
          // Create a native SVG text element
          const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          textEl.setAttribute('x', (x + width / 2).toString());
          textEl.setAttribute('y', textY.toString());
          textEl.setAttribute('text-anchor', 'middle');
          textEl.setAttribute('dominant-baseline', 'middle');
          textEl.setAttribute('fill', '#1e293b');
          textEl.setAttribute('font-size', '16');
          textEl.setAttribute('font-weight', '500');
          
          // Handle multi-line text if needed
          const maxWidth = width - 20;
          const words = textContent.split(/\s+/);
          let line = '';
          let lineCount = 0;
          
          words.forEach((word, i) => {
            const testLine = line + (line ? ' ' : '') + word;
            // Simple approximation: ~8px per character
            if (testLine.length * 8 > maxWidth && line) {
              const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
              tspan.setAttribute('x', (x + width / 2).toString());
              tspan.setAttribute('dy', lineCount === 0 ? '0' : '1.2em');
              tspan.textContent = line;
              textEl.appendChild(tspan);
              line = word;
              lineCount++;
            } else {
              line = testLine;
            }
            
            // Last word
            if (i === words.length - 1) {
              const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
              tspan.setAttribute('x', (x + width / 2).toString());
              tspan.setAttribute('dy', lineCount === 0 ? '0' : '1.2em');
              tspan.textContent = line;
              textEl.appendChild(tspan);
            }
          });
          
          group.appendChild(textEl);
          
          // Replace foreignObject with group
          foreignObj.parentNode?.replaceChild(group, foreignObj);
        } else if (textContent) {
          // Small foreignObject (like arrow labels), convert to simple text
          const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          textEl.setAttribute('x', (x + width / 2).toString());
          textEl.setAttribute('y', (y + height / 2).toString());
          textEl.setAttribute('text-anchor', 'middle');
          textEl.setAttribute('dominant-baseline', 'middle');
          textEl.setAttribute('fill', '#6b7280');
          textEl.setAttribute('font-size', '12');
          textEl.textContent = textContent;
          foreignObj.parentNode?.replaceChild(textEl, foreignObj);
        } else {
          // Remove empty foreignObject
          foreignObj.remove();
        }
      } catch (e) {
        console.warn('Failed to convert foreignObject:', e);
        foreignObj.remove();
      }
    });

    return clone;
  };

  const handleExportSVG = () => {
    const clone = prepareSVGForExport();
    if (!clone) return;

    // Serialize and Download
    const svgData = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `paperplot_${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportPNG = async () => {
    const clone = prepareSVGForExport();
    if (!clone) return;

    try {
      // Get dimensions
      const width = parseInt(clone.getAttribute('width') || '800');
      const height = parseInt(clone.getAttribute('height') || '600');
      
      // Serialize SVG to string
      const svgData = new XMLSerializer().serializeToString(clone);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      // Create image from SVG
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = svgUrl;
      });

      // Create canvas and draw image
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        alert('Failed to create canvas context');
        return;
      }

      // Fill white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      
      // Draw SVG image
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to PNG and download
      canvas.toBlob((blob) => {
        if (!blob) {
          alert('Failed to generate PNG');
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `paperplot_${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        URL.revokeObjectURL(svgUrl);
      }, 'image/png');
    } catch (error) {
      console.error('Export PNG failed:', error);
      alert('导出 PNG 失败: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-white text-gray-900">
      {/* Header */}
      <header className="h-14 border-b border-gray-200 flex items-center justify-between px-6 bg-white z-30 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-blue-200 shadow-lg">
              A
            </div>
            <h1 className="font-bold text-xl text-gray-800 tracking-tight">Architext <span className="text-blue-600 font-normal">AI</span></h1>
          </div>
          
          <div className="h-6 w-px bg-gray-200 mx-2"></div>

          {/* History Controls */}
          <div className="flex items-center gap-1">
            <button 
              onClick={handleUndo} 
              disabled={past.length === 0}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <RotateCcw size={18} />
            </button>
            <button 
              onClick={handleRedo} 
              disabled={future.length === 0}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              title="Redo (Ctrl+Shift+Z)"
            >
              <RotateCw size={18} />
            </button>
          </div>

          <div className="h-6 w-px bg-gray-200"></div>

          {/* Beautify Layout Button */}
          <button
            onClick={handleBeautifyLayout}
            disabled={isBeautifying || elements.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-purple-600 hover:bg-purple-50 rounded-md disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="一键美化布局 - 使用 ELK 算法优化节点位置和连线"
          >
            {isBeautifying ? (
              <div className="w-4 h-4 rounded-full border-2 border-purple-500 border-t-transparent animate-spin"></div>
            ) : (
              <Sparkles size={16} />
            )}
            美化布局
          </button>

          {/* Autosave Indicator */}
          <div className="ml-4 flex items-center gap-1.5 px-3 py-1 bg-gray-50 rounded-full border border-gray-100">
            {saveStatus === 'saved' ? (
              <>
                <CheckCircle2 size={12} className="text-green-500" />
                <span className="text-xs text-gray-400 font-medium">Autosaved</span>
              </>
            ) : (
              <>
                <div className="w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                <span className="text-xs text-blue-500 font-medium">Saving...</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleClearCanvas}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
              confirmClear 
                ? 'bg-red-600 text-white hover:bg-red-700 shadow-red-200 shadow-md animate-pulse' 
                : 'text-red-600 hover:bg-red-50'
            }`}
            title={confirmClear ? "Click again to confirm" : "Clear Canvas"}
          >
            {confirmClear ? <AlertCircle size={16} /> : <Trash2 size={16} />}
            {confirmClear ? "Confirm Clear?" : "Clear"}
          </button>
          
          <div className="h-6 w-px bg-gray-200"></div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportSVG}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              title="导出 SVG 格式（矢量图，可缩放）"
            >
              <FileImage size={16} />
              Export SVG
            </button>
            <button
              onClick={handleExportPNG}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              title="导出 PNG 格式（位图，适合插入文档）"
            >
              <FileImage size={16} />
              Export PNG
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left: Toolbar */}
        <Toolbar selectedTool={selectedTool} setSelectedTool={setSelectedTool} />

        {/* Center: Canvas */}
        <Canvas
          ref={canvasRef}
          elements={elements}
          setElements={setElements}
          selectedTool={selectedTool}
          setSelectedTool={setSelectedTool}
          selectedElementIds={selectedElementIds}
          setSelectedElementIds={setSelectedElementIds}
          onHistorySave={saveToHistory}
        />

        {/* Left: Properties Panel (Overlay, only visible if element is selected) */}
        <PropertiesPanel
          element={selectedElementIds.length > 0 ? (elements.find(el => el.id === selectedElementIds[selectedElementIds.length - 1]) || null) : null}
          elements={elements}
          updateElement={updateSelectedElement}
          deleteElement={deleteSelectedElements}
          onHistorySave={saveToHistory}
          onClose={() => setSelectedElementIds([])}
          onCreateGroup={handleCreateGroup}
          onOpenDslEditor={(elementId) => setDslEditorElementId(elementId)}
        />

        {/* DSL Editor Panel (for Infographic elements) */}
        {dslEditorElementId && (() => {
          const element = elements.find(el => el.id === dslEditorElementId);
          if (!element || element.type !== ToolType.INFOGRAPHIC) return null;
          return (
            <DslEditorPanel
              dsl={element.dsl || ''}
              elementId={dslEditorElementId}
              onDslChange={(newDsl) => {
                saveToHistory();
                setElements(prev => prev.map(el => 
                  el.id === dslEditorElementId ? { ...el, dsl: newDsl } : el
                ));
              }}
              onClose={() => setDslEditorElementId(null)}
            />
          );
        })()}

        {/* Right: Gemini AI Input (Always visible) */}
        <GeminiInput 
          history={generationHistory}
          onGenerationStart={() => {
            // Clear canvas immediately when generation starts (before AI processing)
            isGeneratingRef.current = true;
            saveToHistory();
            // Use flushSync to ensure immediate DOM update
            flushSync(() => {
              setElements([]);
              setSelectedElementIds([]);
            });
          }}
          onGenerationEnd={() => {
            // Reset generation state when generation ends (success or failure)
            isGeneratingRef.current = false;
          }}
          onElementsGenerated={async (newElements, prompt, image) => {
            // Add new elements after generation completes
            setElements(newElements);
            setSelectedElementIds([]);
            
            // Trigger Fit View
            setTimeout(() => {
              canvasRef.current?.fitView(newElements);
            }, 100);
            
            // Save to generation history
            // Compress image to thumbnail to save storage space
            const compressedImage = image ? await compressImageForStorage(image) : null;
            
            const newHistoryItem: GenerationHistory = {
              id: `history_${Date.now()}`,
              prompt,
              image: compressedImage,
              timestamp: Date.now()
            };
            
            // Reduce history count to prevent storage quota issues (keep last 20 instead of 50)
            const updatedHistory = [newHistoryItem, ...generationHistory].slice(0, 20);
            setGenerationHistory(updatedHistory);
            
            // Save with error handling
            try {
              localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updatedHistory));
            } catch (error) {
              console.warn('[App] Failed to save history to localStorage:', error);
              // If storage fails, try to save without images
              const historyWithoutImages = updatedHistory.map(item => ({
                ...item,
                image: null
              }));
              try {
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyWithoutImages));
                setGenerationHistory(historyWithoutImages);
              } catch (e) {
                console.error('[App] Failed to save history even without images:', e);
                // Clear old history and try again with just the new item (without image)
                try {
                  const minimalHistory = [{ ...newHistoryItem, image: null }];
                  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(minimalHistory));
                  setGenerationHistory(minimalHistory);
                } catch (finalError) {
                  console.error('[App] Failed to save any history:', finalError);
                  // Last resort: clear localStorage history and don't save
                  try {
                    localStorage.removeItem(HISTORY_STORAGE_KEY);
                  } catch (clearError) {
                    console.error('[App] Failed to clear history:', clearError);
                  }
                }
              }
            }
          }}
        />
      </div>
    </div>
  );
};

export default App;