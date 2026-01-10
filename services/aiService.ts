import { DiagramElement, ToolType, LineType, LineStyle, AIProviderType } from "../types";
import { getAIConfig, PROVIDER_PRESETS } from "./configService";
import { layoutWithELK } from "./layoutService";

// Helper to create a unique ID
const generateId = () => `el_${Math.random().toString(36).substr(2, 9)}`;

// Layout constants (保留用于 fallback)
const COL_WIDTH = 280;
const ROW_HEIGHT = 160;
const START_X = 60;
const START_Y = 60;

// 导出颜色配置供 layoutService 使用
export const COLORS = {
  input: { fill: "#eff6ff", stroke: "#3b82f6" }, // Blueish
  process: { fill: "#fdf2f8", stroke: "#db2777" }, // Pinkish
  output: { fill: "#f0fdf4", stroke: "#16a34a" }, // Greenish
  database: { fill: "#fffbeb", stroke: "#d97706" }, // Yellow/Orange
  default: { fill: "#ffffff", stroke: "#475569" }  // Slate
};

// 支持的模型类型 (保留向后兼容)
export enum ModelProvider {
  GEMINI = 'gemini',
  BAILIAN = 'bailian',      // 阿里云百炼
  GLM = 'glm',               // 智谱GLM
  MINIMAX = 'minimax',       // MiniMax
  OPENAI = 'openai',         // OpenAI
  DEEPSEEK = 'deepseek',     // DeepSeek
  QWEN = 'qwen'              // 通义千问
}

// 通用图表生成函数
export const generateDiagramFromPrompt = async (
  prompt: string, 
  imageBase64?: string | null
): Promise<DiagramElement[]> => {
  const config = getAIConfig();
  
  if (!config) {
    throw new Error("No AI service configured. Please configure your API key in settings.");
  }

  const provider = config.provider;
  
  switch (provider) {
    case 'gemini':
      return generateWithGemini(prompt, imageBase64, config.apiKey, config.model);
    case 'minimax':
      return generateWithMiniMax(prompt, imageBase64, config.apiKey, config.baseUrl, config.model);
    case 'openai':
    case 'deepseek':
    case 'qwen':
    case 'bailian':
    case 'glm':
    default:
      return generateWithOpenAI(prompt, imageBase64, config.apiKey, config.baseUrl, config.model, provider);
  }
};

// Gemini 实现
async function generateWithGemini(
  prompt: string, 
  imageBase64?: string | null,
  apiKey?: string,
  model?: string
): Promise<DiagramElement[]> {
  const { GoogleGenAI, Type } = await import("@google/genai");
  
  if (!apiKey) {
    throw new Error("Gemini API Key not found. Please configure in settings.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const parts: any[] = [];
  
  if (imageBase64) {
    const match = imageBase64.match(/^data:(.*?);base64,(.*)$/);
    if (match) {
      parts.push({
        inlineData: {
          mimeType: match[1],
          data: match[2]
        }
      });
    }
  }

  parts.push({
    text: `Create a detailed scientific diagram structure for: "${prompt}". 
    If an image is provided, analyze the image to understand the structure, connections, node types, and groups/subgraphs, and recreate it as closely as possible using the available shapes.
    
    CRITICAL LAYOUT REQUIREMENTS:
    - Each node has a width of 200px and height of 100px.
    - Nodes must be spaced far enough apart to prevent overlap. Use row and col values that ensure:
      * Horizontal spacing: adjacent nodes in different columns should have col values that differ by at least 1 (preferably 2-3 for clarity).
      * Vertical spacing: adjacent nodes in different rows should have row values that differ by at least 1 (preferably 2 for clarity).
      * Avoid placing nodes too close together - leave room for arrows to connect cleanly from node edges.
    - Arrange nodes in a logical flow: top-to-bottom or left-to-right based on the process flow.
    - Ensure arrows can connect cleanly from one node's edge to another node's edge without crossing through nodes.
    
    IMPORTANT:
    - Break down lists into individual nodes. Use specific Lucide icon names for each node.
    - If nodes belong to a logical group (like "工具集" containing multiple tools, or "执行代理" containing multiple agents), assign them the same groupId.
    - Groups represent subgraphs or logical containers (e.g., "工具集", "金融模型", "执行代理").
    - Nodes in the same group should have the same groupId string value.
    - Each group should have a meaningful label that describes the collection of nodes.
    - When creating edges, ensure the from and to nodes are properly spaced to avoid visual clutter.`
  });

  const response = await ai.models.generateContent({
    model: model || "gemini-2.0-flash",
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          nodes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                label: { type: Type.STRING },
                icon: { type: Type.STRING, description: "Lucide icon name e.g. file-text, brain, server" },
                category: { type: Type.STRING, enum: ["input", "process", "output", "database", "default"] },
                row: { type: Type.INTEGER },
                col: { type: Type.INTEGER },
                groupId: { type: Type.STRING, description: "Optional: ID of the group/subgraph this node belongs to. Nodes with the same groupId will be visually grouped together." }
              },
              required: ["id", "label", "row", "col", "category", "icon"]
            }
          },
          edges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                from: { type: Type.STRING },
                to: { type: Type.STRING },
                label: { type: Type.STRING }
              },
              required: ["from", "to"]
            }
          }
        }
      }
    }
  });

  return await parseResponse(response.text || "{}");
}

// MiniMax 实现
async function generateWithMiniMax(
  prompt: string, 
  imageBase64: string | null | undefined,
  apiKey?: string,
  baseUrl?: string,
  model?: string
): Promise<DiagramElement[]> {
  const finalApiKey = apiKey || import.meta.env.VITE_MINIMAX_API_KEY;
  const finalBaseUrl = baseUrl || import.meta.env.VITE_MINIMAX_BASE_URL || 'https://api.minimax.chat/v1/text/chatcompletion_pro';
  const finalModel = model || import.meta.env.VITE_MINIMAX_MODEL || 'abab6.5-chat';
  
  if (!finalApiKey) {
    throw new Error("MiniMax API Key not found. Please configure in settings.");
  }

  const messages: any[] = [{
    role: 'user',
    text: `Create a detailed scientific diagram structure for: "${prompt}". 
    Return JSON format with nodes and edges. 
    
    CRITICAL LAYOUT REQUIREMENTS:
    - Each node has a width of 200px and height of 100px.
    - Nodes must be spaced far enough apart to prevent overlap. Use row and col values that ensure:
      * Horizontal spacing: adjacent nodes in different columns should have col values that differ by at least 1 (preferably 2-3 for clarity).
      * Vertical spacing: adjacent nodes in different rows should have row values that differ by at least 1 (preferably 2 for clarity).
      * Avoid placing nodes too close together - leave room for arrows to connect cleanly from node edges.
    - Arrange nodes in a logical flow: top-to-bottom or left-to-right based on the process flow.
    - Ensure arrows can connect cleanly from one node's edge to another node's edge without crossing through nodes.
    
    Each node should have: id, label, icon (Lucide icon name), category (input/process/output/database/default), row, col, groupId (optional - nodes with same groupId belong to same group/subgraph).
    Each edge should have: from, to, label.
    If nodes belong to a logical group (like "工具集" containing multiple tools), assign them the same groupId.
    When creating edges, ensure the from and to nodes are properly spaced to avoid visual clutter.`
  }];

  // MiniMax 图片处理需要单独处理
  if (imageBase64) {
    // MiniMax 可能需要不同的图片格式处理
    messages[0].images = [imageBase64];
  }

  const response = await fetch(finalBaseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${finalApiKey}`
    },
    body: JSON.stringify({
      model: finalModel,
      messages,
      stream: false,
      response_format: 'json'
    })
  });

  if (!response.ok) {
    throw new Error(`MiniMax API error: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return await parseResponse(content);
}

// OpenAI 实现
async function generateWithOpenAI(
  prompt: string, 
  imageBase64: string | null | undefined,
  apiKey?: string,
  baseUrl?: string,
  model?: string,
  provider: string = 'openai'
): Promise<DiagramElement[]> {
  const finalApiKey = apiKey || import.meta.env.VITE_OPENAI_API_KEY;
  let finalBaseUrl = baseUrl || import.meta.env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const finalModel = model || import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o';
  
  if (!finalApiKey) {
    throw new Error(`${provider.toUpperCase()} API Key not found. Please configure in settings.`);
  }

  // 如果是自定义 Base URL（非 OpenAI 官方），且是开发环境，使用代理避免 CORS
  const isCustomUrl = finalBaseUrl.includes('47.251.106.113') || finalBaseUrl.includes('localhost') || finalBaseUrl.startsWith('http://');
  const isDev = import.meta.env.DEV;
  
  if (isCustomUrl && isDev) {
    // 使用 Vite 代理路径
    finalBaseUrl = '/api/openai';
    console.log(`[PaperPlot AI] 使用代理路径: ${finalBaseUrl} (原始: ${baseUrl || import.meta.env.VITE_OPENAI_BASE_URL})`);
  }

  const fetchUrl = buildChatCompletionsUrl(finalBaseUrl);
  console.log(`[PaperPlot AI] Base URL (raw): "${baseUrl}", Final fetch URL: "${fetchUrl}"`);

  const messages: any[] = [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Create a detailed scientific diagram structure for: "${prompt}". 
        You must return valid JSON format only with nodes and edges. 
        
        CRITICAL LAYOUT REQUIREMENTS:
        - Each node has a width of 200px and height of 100px.
        - Nodes must be spaced far enough apart to prevent overlap. Use row and col values that ensure:
          * Horizontal spacing: adjacent nodes in different columns should have col values that differ by at least 1 (preferably 2-3 for clarity).
          * Vertical spacing: adjacent nodes in different rows should have row values that differ by at least 1 (preferably 2 for clarity).
          * Avoid placing nodes too close together - leave room for arrows to connect cleanly from node edges.
        - Arrange nodes in a logical flow: top-to-bottom or left-to-right based on the process flow.
        - Ensure arrows can connect cleanly from one node's edge to another node's edge without crossing through nodes.
        
        Each node should have: id, label, icon (Lucide icon name), category (input/process/output/database/default), row, col, groupId (optional - nodes with same groupId belong to same group/subgraph).
        Each edge should have: from, to, label.
        If nodes belong to a logical group (like "工具集" containing multiple tools), assign them the same groupId.
        When creating edges, ensure the from and to nodes are properly spaced to avoid visual clutter.
        Return the result as a JSON object.`
      }
    ]
  }];

  if (imageBase64) {
    const match = imageBase64.match(/^data:(.*?);base64,(.*)$/);
    if (match) {
      messages[0].content.push({
        type: 'image_url',
        image_url: {
          url: imageBase64
        }
      });
    }
  }

  console.log(`[PaperPlot AI] 请求 ${provider.toUpperCase()} API: ${fetchUrl}`);
  console.log(`[PaperPlot AI] 使用模型: ${finalModel}`);
  
  try {
    const response = await fetch(fetchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${finalApiKey}`
      },
      body: JSON.stringify({
        model: finalModel,
        messages,
        response_format: { type: 'json_object' }
      })
    });

    console.log(`[PaperPlot AI] 响应状态: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PaperPlot AI] API 错误响应:`, errorText);
      throw new Error(`${provider.toUpperCase()} API error (${response.status}): ${response.statusText}. ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    console.log(`[PaperPlot AI] API 响应数据:`, data);
    const content = data.choices?.[0]?.message?.content || '';
    
    if (!content) {
      console.error(`[PaperPlot AI] 响应中没有 content 字段:`, data);
      throw new Error('API 响应中没有 content 字段');
    }
    
    return await parseResponse(content);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error(`[PaperPlot AI] 网络请求失败:`, error);
      throw new Error(`网络请求失败: 无法连接到 ${fetchUrl}。请检查：1) 服务器是否可访问 2) CORS 配置 3) 网络连接`);
    }
    throw error;
  }
}

// 规范化 Base URL，确保最终为正确的 chat/completions 端点
export function buildChatCompletionsUrl(baseUrl?: string): string {
  // 默认使用官方地址
  let url = (baseUrl || 'https://api.openai.com/v1').trim();

  // 去掉尾部斜杠
  url = url.replace(/\/+$/, '');

  // 如果 URL 已经以 /chat/completions 结尾，直接返回（不要再加）
  if (url.endsWith('/chat/completions')) {
    return url;
  }

  // 如果 URL 包含 /chat/completions 但后面还有东西，截取到 /chat/completions
  const chatCompletionsIdx = url.indexOf('/chat/completions');
  if (chatCompletionsIdx !== -1) {
    return url.slice(0, chatCompletionsIdx + '/chat/completions'.length);
  }

  // 否则，添加 /chat/completions
  return `${url}/chat/completions`;
}

async function parseResponse(responseText: string): Promise<DiagramElement[]> {
  let rawData: any;
  try {
    rawData = JSON.parse(responseText);
  } catch (e) {
    // 尝试提取 JSON
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      rawData = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("Failed to parse AI response as JSON");
    }
  }

  const nodes = rawData.nodes || rawData.elements || [];
  const edges = rawData.edges || rawData.connections || [];

  if (nodes.length === 0 && edges.length === 0) {
    console.warn('[PaperPlot AI] No nodes or edges found in AI response:', rawData);
    const possibleElements = Object.values(rawData).find(v => Array.isArray(v) && v.length > 0);
    if (possibleElements) {
       console.log('[PaperPlot AI] Found alternative elements array, attempting to use it.');
    }
    return [];
  }

  // 使用 ELK.js 进行专业的分层布局
  try {
    console.log('[PaperPlot AI] Using ELK.js for layout optimization...');
    const layoutedElements = await layoutWithELK(nodes, edges, COLORS);
    console.log('[PaperPlot AI] ELK layout completed, elements:', layoutedElements.length);
    return layoutedElements;
  } catch (layoutError) {
    console.warn('[PaperPlot AI] ELK layout failed, falling back to simple grid layout:', layoutError);
    // Fallback 到简单的网格布局
    return fallbackGridLayout(nodes, edges);
  }
}

/**
 * 简单的网格布局作为 fallback
 */
function fallbackGridLayout(nodes: any[], edges: any[]): DiagramElement[] {
  const finalElements: DiagramElement[] = [];
  const nodeMap = new Map<string, DiagramElement>();

  // Pre-process to compact coordinates
  const uniqueRows = Array.from(new Set(nodes.map((n: any) => n.row))).sort((a: any, b: any) => a - b);
  const uniqueCols = Array.from(new Set(nodes.map((n: any) => n.col))).sort((a: any, b: any) => a - b);

  const rowMapping = new Map(uniqueRows.map((r, i) => [r, i]));
  const colMapping = new Map(uniqueCols.map((c, i) => [c, i]));

  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 100;
  const GAP_X = 60;
  const GAP_Y = 50;

  nodes.forEach((node: any) => {
    const colorSet = COLORS[node.category as keyof typeof COLORS] || COLORS.default;
    
    const r = rowMapping.get(node.row) ?? node.row;
    const c = colMapping.get(node.col) ?? node.col;

    const x = START_X + (c * (NODE_WIDTH + GAP_X)); 
    const y = START_Y + (r * (NODE_HEIGHT + GAP_Y));

    const el: DiagramElement = {
      id: node.id || generateId(),
      type: ToolType.RECTANGLE,
      x: x,
      y: y,
      width: NODE_WIDTH, 
      height: NODE_HEIGHT, 
      text: node.label,
      icon: node.icon,
      strokeColor: colorSet.stroke,
      fillColor: colorSet.fill,
      strokeWidth: 2,
      fontSize: 14,
      groupId: node.groupId
    };
    
    finalElements.push(el);
    nodeMap.set(node.id, el);
  });

  // Convert Edges
  edges.forEach((edge: any) => {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);

    if (fromNode && toNode) {
      const el: DiagramElement = {
        id: generateId(),
        type: ToolType.ARROW,
        x: fromNode.x,
        y: fromNode.y,
        endX: toNode.x,
        endY: toNode.y,
        fromId: fromNode.id,
        toId: toNode.id,
        strokeColor: "#94a3b8",
        fillColor: "transparent",
        strokeWidth: 2,
        text: edge.label || "",
        lineType: LineType.STEP,
        lineStyle: LineStyle.SOLID,
        markerEnd: true
      };
      finalElements.push(el);
    }
  });

  return finalElements;
}

