import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Loader2, Image as ImageIcon, X, Upload, History, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { generateDiagramFromPrompt } from '../services/aiService';
import { DiagramElement, GenerationHistory } from '../types';

interface GeminiInputProps {
  history?: GenerationHistory[];
  onGenerationStart?: () => void; // Callback when generation starts (to clear canvas)
  onGenerationEnd?: () => void; // Callback when generation ends (success or failure)
  onElementsGenerated: (elements: DiagramElement[], prompt: string, image: string | null) => void;
}

export const GeminiInput: React.FC<GeminiInputProps> = ({ 
  history = [], 
  onGenerationStart,
  onGenerationEnd,
  onElementsGenerated
}) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null); // Base64 string
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle Paste for Images on the container
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            setImage(event.target?.result as string);
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);
    
    // Clear canvas immediately when generation starts
    if (onGenerationStart) {
      onGenerationStart();
    }

    try {
      const newElements = await generateDiagramFromPrompt(prompt, image);
      onElementsGenerated(newElements, prompt, image);
      // Optional: Clear prompt after success
      // setPrompt('');
      // setImage(null);
    } catch (err) {
      console.error('[GeminiInput] 生成失败:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate diagram';
      setError(errorMessage);
    } finally {
      setLoading(false);
      // Reset generation state when generation ends (success or failure)
      if (onGenerationEnd) {
        onGenerationEnd();
      }
    }
  };

  return (
    <div 
      className="w-80 h-full bg-white border-l border-gray-200 flex flex-col shadow-xl z-20"
      onPaste={handlePaste}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        <div className="flex items-center gap-2 text-blue-600">
          <Sparkles size={20} />
          <h2 className="font-semibold text-sm uppercase tracking-wider">AI Generator</h2>
        </div>
      </div>

      {/* Main Content - Input Area (固定，不滚动) */}
      <div className="flex-shrink-0 p-4 flex flex-col gap-4 border-b border-gray-100">
        {/* Prompt Input */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-gray-500">PROMPT</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe a flow chart, mind map, or system architecture..."
            className="w-full h-28 p-3 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none bg-gray-50 focus:bg-white transition-colors"
          />
        </div>

        {/* Image Input */}
        <div className="flex flex-col gap-2">
           <div className="flex justify-between items-center">
             <label className="text-xs font-medium text-gray-500">REFERENCE IMAGE (OPTIONAL)</label>
             {image && (
               <button onClick={() => setImage(null)} className="text-xs text-red-500 hover:text-red-600">Clear</button>
             )}
           </div>
           
           {!image ? (
             <div 
               onClick={() => fileInputRef.current?.click()}
               className="border-2 border-dashed border-gray-200 rounded-lg p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors group"
             >
               <Upload size={20} className="text-gray-300 group-hover:text-blue-400 transition-colors" />
               <span className="text-xs text-gray-400 text-center">Click to upload or paste image</span>
             </div>
           ) : (
             <div className="relative rounded-lg overflow-hidden border border-gray-200 group">
               <img src={image} alt="Reference" className="w-full h-32 object-cover" />
               <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
             </div>
           )}
           <input
             type="file"
             ref={fileInputRef}
             onChange={handleFileChange}
             accept="image/*"
             className="hidden"
           />
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-xs rounded-md border border-red-100">
            {error}
          </div>
        )}

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium shadow-md shadow-blue-200 flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles size={18} />
              Generate Diagram
            </>
          )}
        </button>
      </div>

      {/* History Section - 独立滚动区域 */}
      <div className="flex-1 flex flex-col min-h-0 bg-gray-50">
        {/* History Header - 固定 */}
        <div 
          className="flex-shrink-0 p-3 border-b border-gray-200 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors"
          onClick={() => history.length > 0 && setHistoryExpanded(!historyExpanded)}
        >
          <div className="flex items-center gap-2">
            <History size={16} className="text-gray-500" />
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              History
            </span>
            {history.length > 0 && (
              <span className="bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5 min-w-[18px] flex items-center justify-center">
                {history.length}
              </span>
            )}
          </div>
          {history.length > 0 && (
            historyExpanded ? (
              <ChevronUp size={16} className="text-gray-400" />
            ) : (
              <ChevronDown size={16} className="text-gray-400" />
            )
          )}
        </div>

        {/* History List - 独立滚动 */}
        {historyExpanded && (
          <div className="flex-1 overflow-y-auto min-h-0">
            {history.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-xs">
                <History size={28} className="mx-auto mb-2 opacity-30" />
                <p className="font-medium">No history yet</p>
                <p className="mt-1 text-gray-300">Generate a diagram to see history here</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setPrompt(item.prompt);
                      setImage(item.image);
                    }}
                    className="p-3 bg-white hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {item.image ? (
                        <img 
                          src={item.image} 
                          alt="Reference" 
                          className="w-12 h-12 object-cover rounded-md border border-gray-200 flex-shrink-0 shadow-sm"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center flex-shrink-0">
                          <Sparkles size={16} className="text-gray-300" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 line-clamp-2 mb-1 leading-relaxed">
                          {item.prompt || '(No prompt)'}
                        </p>
                        <div className="flex items-center gap-1 text-[10px] text-gray-400">
                          <Clock size={9} />
                          <span>{new Date(item.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
