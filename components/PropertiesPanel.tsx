import React from 'react';
import { DiagramElement, ToolType, LineType, LineStyle } from '../types';
import { ArrowRight, Activity, CornerDownRight, Minus, MoreHorizontal, X } from 'lucide-react';

interface PropertiesPanelProps {
  element: DiagramElement | null;
  elements: DiagramElement[];  // 所有元素，用于选择连接目标
  updateElement: (updates: Partial<DiagramElement>, saveHistory?: boolean) => void;
  deleteElement: () => void;
  onHistorySave: () => void;
  onClose?: () => void;
  onCreateGroup?: () => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ element, elements, updateElement, deleteElement, onHistorySave, onClose, onCreateGroup }) => {
  
  // Helper to update with history trigger
  const handleChange = (updates: Partial<DiagramElement>) => {
    updateElement(updates, true);
  };

  // 获取可连接的元素（排除箭头和当前元素）
  const connectableElements = elements.filter(el => 
    el.type !== ToolType.ARROW && el.id !== element?.id
  );

  // 获取所有现有的分组ID和标签
  const existingGroups = React.useMemo(() => {
    const groupMap = new Map<string, string>();
    elements.forEach(el => {
      if (el.groupId && el.type !== ToolType.ARROW) {
        if (!groupMap.has(el.groupId)) {
          // 使用第一个元素的文本作为分组标签
          const firstElement = elements.find(e => e.groupId === el.groupId && e.type !== ToolType.ARROW);
          groupMap.set(el.groupId, firstElement?.text || `Group ${el.groupId.substring(0, 8)}`);
        }
      }
    });
    return Array.from(groupMap.entries()).map(([id, label]) => ({ id, label }));
  }, [elements]);

  // 创建新分组 (使用传入的 onCreateGroup 回调，如果可用)
  const handleCreateGroup = () => {
    if (onCreateGroup) {
      onCreateGroup();
    } else {
      // Fallback (legacy logic, only sets groupId on current element)
      const newGroupId = `group_${Date.now()}`;
      handleChange({ groupId: newGroupId });
    }
  };

  // If no element is selected, do not render anything (remove empty state)
  if (!element) {
    return null;
  }

  return (
    <div className="absolute left-16 top-0 w-72 bg-white border-r border-gray-200 p-5 flex flex-col gap-6 shadow-lg h-full overflow-y-auto z-20">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">Properties</h3>
        <div className="flex gap-2">
          {onClose && (
            <button 
              onClick={onClose} 
              className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100"
              title="关闭"
            >
              <X size={16} />
            </button>
          )}
          <button onClick={deleteElement} className="text-red-500 hover:text-red-600 text-sm font-medium bg-red-50 px-2 py-1 rounded">
            Delete
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Text Content */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">
            {element.type === ToolType.GROUP ? 'Group Label' : 'Label / Text'}
          </label>
          <textarea
            value={element.text || ''}
            onFocus={() => onHistorySave()} 
            onChange={(e) => updateElement({ text: e.target.value }, false)} 
            onBlur={() => onHistorySave()}
            className="border rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-y min-h-[60px]"
            placeholder={element.type === ToolType.GROUP ? 'Enter group name...' : 'Enter text...'}
          />
        </div>

        {/* Line Specific Properties */}
        {element.type === ToolType.ARROW && (
          <>
            {/* Connection Editor */}
            <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
              <label className="text-xs font-bold text-gray-700">连接设置</label>
              
              {/* From Connection */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">起点 (From)</label>
                <select
                  value={element.fromId || ''}
                  onChange={(e) => {
                    const newFromId = e.target.value || undefined;
                    const updates: Partial<DiagramElement> = { fromId: newFromId };
                    // 只有当 both fromId 和 toId 都存在时，才清除手动坐标
                    if (newFromId && element.toId) {
                      updates.endX = undefined;
                      updates.endY = undefined;
                    }
                    handleChange(updates);
                  }}
                  className="border rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">无连接（手动坐标）</option>
                  {connectableElements.map(el => (
                    <option key={el.id} value={el.id}>
                      {el.text || el.id.substring(0, 8)}
                    </option>
                  ))}
                </select>
                {element.fromId && (
                  <div className="text-xs text-gray-400 mt-1">
                    当前: {elements.find(e => e.id === element.fromId)?.text || element.fromId}
                  </div>
                )}
              </div>

              {/* To Connection */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">终点 (To)</label>
                <select
                  value={element.toId || ''}
                  onChange={(e) => {
                    const newToId = e.target.value || undefined;
                    const updates: Partial<DiagramElement> = { toId: newToId };
                    // 只有当 both fromId 和 toId 都存在时，才清除手动坐标
                    if (newToId && element.fromId) {
                      updates.endX = undefined;
                      updates.endY = undefined;
                    }
                    handleChange(updates);
                  }}
                  className="border rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">无连接（手动坐标）</option>
                  {connectableElements.map(el => (
                    <option key={el.id} value={el.id}>
                      {el.text || el.id.substring(0, 8)}
                    </option>
                  ))}
                </select>
                {element.toId && (
                  <div className="text-xs text-gray-400 mt-1">
                    当前: {elements.find(e => e.id === element.toId)?.text || element.toId}
                  </div>
                )}
              </div>

              {/* Manual Coordinates (only shown if not connected) */}
              {(!element.fromId || !element.toId) && (
                <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
                  <label className="text-xs font-medium text-gray-500">手动坐标（未连接时使用）</label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-400">终点 X</label>
                      <input
                        type="number"
                        value={Math.round(element.endX || element.x)}
                        onChange={(e) => handleChange({ endX: parseFloat(e.target.value) || 0 })}
                        className="w-full border rounded p-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400">终点 Y</label>
                      <input
                        type="number"
                        value={Math.round(element.endY || element.y)}
                        onChange={(e) => handleChange({ endY: parseFloat(e.target.value) || 0 })}
                        className="w-full border rounded p-1 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
              <label className="text-xs font-bold text-gray-700">Connection Style</label>
              
              {/* Line Type */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-md">
                <button
                  title="Straight"
                  onClick={() => handleChange({ lineType: LineType.STRAIGHT })}
                  className={`flex-1 p-1.5 flex justify-center rounded ${element.lineType === LineType.STRAIGHT ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
                >
                  <Minus size={16} className="rotate-[-45deg]" />
                </button>
                <button
                  title="Curved"
                  onClick={() => handleChange({ lineType: LineType.CURVE })}
                  className={`flex-1 p-1.5 flex justify-center rounded ${element.lineType === LineType.CURVE ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
                >
                  <Activity size={16} />
                </button>
                <button
                  title="Step"
                  onClick={() => handleChange({ lineType: LineType.STEP })}
                  className={`flex-1 p-1.5 flex justify-center rounded ${element.lineType === LineType.STEP ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:bg-gray-200'}`}
                >
                  <CornerDownRight size={16} />
                </button>
              </div>

              {/* Line Style (Solid/Dashed) */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleChange({ lineStyle: LineStyle.SOLID })}
                  className={`flex-1 px-2 py-1 text-xs border rounded ${element.lineStyle === LineStyle.SOLID ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                >
                  Solid
                </button>
                <button
                  onClick={() => handleChange({ lineStyle: LineStyle.DASHED })}
                  className={`flex-1 px-2 py-1 text-xs border rounded ${element.lineStyle === LineStyle.DASHED ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                >
                  Dashed
                </button>
              </div>

               {/* Markers */}
               <div className="flex justify-between items-center">
                  <label className="text-xs text-gray-500">Arrowheads</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleChange({ markerStart: !element.markerStart })}
                      className={`px-2 py-1 text-xs border rounded ${element.markerStart ? 'bg-blue-100 border-blue-300' : 'bg-gray-50'}`}
                    >
                      Start
                    </button>
                     <button 
                      onClick={() => handleChange({ markerEnd: !element.markerEnd })}
                      className={`px-2 py-1 text-xs border rounded ${element.markerEnd ? 'bg-blue-100 border-blue-300' : 'bg-gray-50'}`}
                    >
                      End
                    </button>
                  </div>
               </div>
            </div>
          </>
        )}

        <div className="border-t border-gray-100 pt-4"></div>

        {/* Colors */}
        <div className="flex gap-4">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-medium text-gray-500">Fill</label>
            <div className="flex items-center border rounded-md p-1">
                <input
                type="color"
                value={element.fillColor}
                onFocus={() => onHistorySave()}
                onChange={(e) => updateElement({ fillColor: e.target.value }, false)}
                className="w-8 h-8 cursor-pointer border-none bg-transparent"
                />
                <span className="text-xs ml-2 text-gray-600 uppercase">{element.fillColor}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs font-medium text-gray-500">Stroke</label>
             <div className="flex items-center border rounded-md p-1">
                <input
                type="color"
                value={element.strokeColor}
                onFocus={() => onHistorySave()}
                onChange={(e) => updateElement({ strokeColor: e.target.value }, false)}
                className="w-8 h-8 cursor-pointer border-none bg-transparent"
                />
                 <span className="text-xs ml-2 text-gray-600 uppercase">{element.strokeColor}</span>
            </div>
          </div>
        </div>

        {/* Stroke Width */}
        <div className="flex flex-col gap-1">
           <label className="text-xs font-medium text-gray-500">Stroke Width: {element.strokeWidth}px</label>
           <input
             type="range"
             min="1"
             max="10"
             value={element.strokeWidth}
             onMouseDown={() => onHistorySave()} 
             onChange={(e) => updateElement({ strokeWidth: parseInt(e.target.value) }, false)}
             className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
           />
        </div>

        {/* Font Size */}
        {(element.type !== ToolType.ARROW) && (
            <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Font Size: {element.fontSize}px</label>
            <input
                type="range"
                min="8"
                max="72"
                value={element.fontSize || 14}
                onMouseDown={() => onHistorySave()} 
                onChange={(e) => updateElement({ fontSize: parseInt(e.target.value) }, false)}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            </div>
        )}

        {/* Dimensions */}
        {(element.type === ToolType.RECTANGLE || element.type === ToolType.CIRCLE || element.type === ToolType.GROUP) && (
             <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-xs font-medium text-gray-500">Width</label>
                    <input
                        type="number"
                        value={Math.round(element.width || 0)}
                        onFocus={() => onHistorySave()}
                        onChange={(e) => updateElement({ width: parseInt(e.target.value) }, false)}
                        className="w-full border rounded p-1 text-sm"
                    />
                </div>
                 <div>
                    <label className="text-xs font-medium text-gray-500">Height</label>
                    <input
                        type="number"
                        value={Math.round(element.height || 0)}
                        onFocus={() => onHistorySave()}
                        onChange={(e) => updateElement({ height: parseInt(e.target.value) }, false)}
                        className="w-full border rounded p-1 text-sm"
                    />
                </div>
             </div>
        )}

        {/* Line Style for GROUP elements */}
        {element.type === ToolType.GROUP && (
          <div className="border-t border-gray-100 pt-4 flex flex-col gap-2">
            <label className="text-xs font-bold text-gray-700">Border Style</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleChange({ lineStyle: LineStyle.SOLID })}
                className={`flex-1 px-2 py-1 text-xs border rounded ${element.lineStyle === LineStyle.SOLID ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600'}`}
              >
                Solid
              </button>
              <button
                onClick={() => handleChange({ lineStyle: LineStyle.DASHED })}
                className={`flex-1 px-2 py-1 text-xs border rounded ${element.lineStyle === LineStyle.DASHED ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-600'}`}
              >
                Dashed
              </button>
            </div>
          </div>
        )}

        {/* Group Assignment (for non-arrow, non-group elements) */}
        {element.type !== ToolType.ARROW && element.type !== ToolType.GROUP && (
          <div className="border-t border-gray-100 pt-4 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-bold text-gray-700">分组</label>
              <button
                onClick={handleCreateGroup}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                新建分组
              </button>
            </div>
            <select
              value={element.groupId || ''}
              onChange={(e) => {
                const newGroupId = e.target.value || undefined;
                handleChange({ groupId: newGroupId });
              }}
              className="border rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">无分组</option>
              {existingGroups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
            {element.groupId && (
              <div className="flex items-center justify-between mt-1">
                <div className="text-xs text-gray-400">
                  当前分组: {existingGroups.find(g => g.id === element.groupId)?.label || element.groupId}
                </div>
                <button
                  onClick={() => handleChange({ groupId: undefined })}
                  className="text-xs text-red-500 hover:text-red-600 font-medium"
                  title="从分组中移除"
                >
                  移除
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};