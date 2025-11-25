import { DiagramElement, ToolType, LineType, LineStyle } from "../types";

// Helper to create a unique ID
const generateId = () => `el_${Math.random().toString(36).substr(2, 9)}`;

// Layout constants
const COL_WIDTH = 280;
const ROW_HEIGHT = 160; 
const START_X = 60;
const START_Y = 60;

const COLORS = {
  input: { fill: "#eff6ff", stroke: "#3b82f6" }, // Blueish
  process: { fill: "#fdf2f8", stroke: "#db2777" }, // Pinkish
  output: { fill: "#f0fdf4", stroke: "#16a34a" }, // Greenish
  database: { fill: "#fffbeb", stroke: "#d97706" }, // Yellow/Orange
  default: { fill: "#ffffff", stroke: "#475569" }  // Slate
};

// 支持的模型类型
export enum ModelProvider {
  GEMINI = 'gemini',
  BAILIAN = 'bailian',      // 阿里云百炼
  GLM = 'glm',               // 智谱GLM
  MINIMAX = 'minimax',       // MiniMax
  OPENAI = 'openai'          // OpenAI
}

// 获取当前配置的模型提供商
const getModelProvider = (): ModelProvider => {
  const provider = import.meta.env.VITE_AI_PROVIDER || 'gemini';
  return provider.toLowerCase() as ModelProvider;
};

// 通用图表生成函数
export const generateDiagramFromPrompt = async (
  prompt: string, 
  imageBase64?: string | null
): Promise<DiagramElement[]> => {
  const provider = getModelProvider();
  
  switch (provider) {
    case ModelProvider.GEMINI:
      return generateWithGemini(prompt, imageBase64);
    case ModelProvider.BAILIAN:
      return generateWithBailian(prompt, imageBase64);
    case ModelProvider.GLM:
      return generateWithGLM(prompt, imageBase64);
    case ModelProvider.MINIMAX:
      return generateWithMiniMax(prompt, imageBase64);
    case ModelProvider.OPENAI:
      return generateWithOpenAI(prompt, imageBase64);
    default:
      throw new Error(`Unsupported model provider: ${provider}`);
  }
};

// Gemini 实现
async function generateWithGemini(prompt: string, imageBase64?: string | null): Promise<DiagramElement[]> {
  const { GoogleGenAI, Type } = await import("@google/genai");
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("Gemini API Key not found. Please set VITE_GEMINI_API_KEY in .env.local");
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
    
    Important:
    - Break down lists into individual nodes. Use specific Lucide icon names for each node.
    - If nodes belong to a logical group (like "工具集" containing multiple tools, or "执行代理" containing multiple agents), assign them the same groupId.
    - Groups represent subgraphs or logical containers (e.g., "工具集", "金融模型", "执行代理").
    - Nodes in the same group should have the same groupId string value.
    - Each group should have a meaningful label that describes the collection of nodes.`
  });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
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

  return parseResponse(response.text || "{}");
}

// 阿里云百炼实现
async function generateWithBailian(prompt: string, imageBase64?: string | null): Promise<DiagramElement[]> {
  const apiKey = import.meta.env.VITE_BAILIAN_API_KEY;
  const baseUrl = import.meta.env.VITE_BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
  const model = import.meta.env.VITE_BAILIAN_MODEL || 'qwen-plus';
  
  if (!apiKey) {
    throw new Error("Bailian API Key not found. Please set VITE_BAILIAN_API_KEY in .env.local");
  }

  const messages: any[] = [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Create a detailed scientific diagram structure for: "${prompt}". 
        You must return valid JSON format only with nodes and edges. 
        Each node should have: id, label, icon (Lucide icon name), category (input/process/output/database/default), row, col, groupId (optional - nodes with same groupId belong to same group/subgraph).
        Each edge should have: from, to, label.
        If nodes belong to a logical group (like "工具集" containing multiple tools), assign them the same groupId.
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

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: {
        messages
      },
      parameters: {
        result_format: 'message'
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Bailian API error: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.output?.choices?.[0]?.message?.content || '';
  
  // 尝试提取 JSON
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/);
  return parseResponse(jsonMatch ? jsonMatch[1] || jsonMatch[0] : content);
}

// GLM 实现
async function generateWithGLM(prompt: string, imageBase64?: string | null): Promise<DiagramElement[]> {
  const apiKey = import.meta.env.VITE_GLM_API_KEY;
  const baseUrl = import.meta.env.VITE_GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const model = import.meta.env.VITE_GLM_MODEL || 'glm-4';
  
  if (!apiKey) {
    throw new Error("GLM API Key not found. Please set VITE_GLM_API_KEY in .env.local");
  }

  const messages: any[] = [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Create a detailed scientific diagram structure for: "${prompt}". 
        You must return valid JSON format only with nodes and edges. 
        Each node should have: id, label, icon (Lucide icon name), category (input/process/output/database/default), row, col, groupId (optional - nodes with same groupId belong to same group/subgraph).
        Each edge should have: from, to, label.
        If nodes belong to a logical group (like "工具集" containing multiple tools), assign them the same groupId.
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

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    throw new Error(`GLM API error: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parseResponse(content);
}

// MiniMax 实现
async function generateWithMiniMax(prompt: string, imageBase64?: string | null): Promise<DiagramElement[]> {
  const apiKey = import.meta.env.VITE_MINIMAX_API_KEY;
  const baseUrl = import.meta.env.VITE_MINIMAX_BASE_URL || 'https://api.minimax.chat/v1/text/chatcompletion_pro';
  const model = import.meta.env.VITE_MINIMAX_MODEL || 'abab6.5-chat';
  
  if (!apiKey) {
    throw new Error("MiniMax API Key not found. Please set VITE_MINIMAX_API_KEY in .env.local");
  }

  const messages: any[] = [{
    role: 'user',
    text: `Create a detailed scientific diagram structure for: "${prompt}". 
    Return JSON format with nodes and edges. 
    Each node should have: id, label, icon (Lucide icon name), category (input/process/output/database/default), row, col, groupId (optional - nodes with same groupId belong to same group/subgraph).
    Each edge should have: from, to, label.
    If nodes belong to a logical group (like "工具集" containing multiple tools), assign them the same groupId.`
  }];

  // MiniMax 图片处理需要单独处理
  if (imageBase64) {
    // MiniMax 可能需要不同的图片格式处理
    messages[0].images = [imageBase64];
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
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
  return parseResponse(content);
}

// OpenAI 实现
async function generateWithOpenAI(prompt: string, imageBase64?: string | null): Promise<DiagramElement[]> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  let baseUrl = import.meta.env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  const model = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o';
  
  if (!apiKey) {
    throw new Error("OpenAI API Key not found. Please set VITE_OPENAI_API_KEY in .env.local");
  }

  // 如果是自定义 Base URL（非 OpenAI 官方），且是开发环境，使用代理避免 CORS
  const isCustomUrl = baseUrl.includes('47.251.106.113') || baseUrl.includes('localhost') || baseUrl.startsWith('http://');
  const isDev = import.meta.env.DEV;
  
  if (isCustomUrl && isDev) {
    // 使用 Vite 代理路径
    baseUrl = '/api/openai';
    console.log(`[PaperPlot AI] 使用代理路径: ${baseUrl} (原始: ${import.meta.env.VITE_OPENAI_BASE_URL})`);
  }

  const messages: any[] = [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Create a detailed scientific diagram structure for: "${prompt}". 
        You must return valid JSON format only with nodes and edges. 
        Each node should have: id, label, icon (Lucide icon name), category (input/process/output/database/default), row, col, groupId (optional - nodes with same groupId belong to same group/subgraph).
        Each edge should have: from, to, label.
        If nodes belong to a logical group (like "工具集" containing multiple tools), assign them the same groupId.
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

  console.log(`[PaperPlot AI] 请求 OpenAI API: ${baseUrl}`);
  console.log(`[PaperPlot AI] 使用模型: ${model}`);
  
  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' }
      })
    });

    console.log(`[PaperPlot AI] 响应状态: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PaperPlot AI] API 错误响应:`, errorText);
      throw new Error(`OpenAI API error (${response.status}): ${response.statusText}. ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    console.log(`[PaperPlot AI] API 响应数据:`, data);
    const content = data.choices?.[0]?.message?.content || '';
    
    if (!content) {
      console.error(`[PaperPlot AI] 响应中没有 content 字段:`, data);
      throw new Error('API 响应中没有 content 字段');
    }
    
    return parseResponse(content);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error(`[PaperPlot AI] 网络请求失败:`, error);
      throw new Error(`网络请求失败: 无法连接到 ${baseUrl}。请检查：1) 服务器是否可访问 2) CORS 配置 3) 网络连接`);
    }
    throw error;
  }
}

// 解析响应为图表元素
function parseResponse(responseText: string): DiagramElement[] {
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

  const nodes = rawData.nodes || [];
  const edges = rawData.edges || [];

  const finalElements: DiagramElement[] = [];
  const nodeMap = new Map<string, DiagramElement>();

  // 1. Convert Nodes to DiagramElements
  nodes.forEach((node: any) => {
    const colorSet = COLORS[node.category as keyof typeof COLORS] || COLORS.default;
    
    const x = START_X + (node.col * COL_WIDTH) + (Math.random() * 10); 
    const y = START_Y + (node.row * ROW_HEIGHT) + (Math.random() * 10);

    const el: DiagramElement = {
      id: node.id || generateId(),
      type: ToolType.RECTANGLE,
      x: x,
      y: y,
      width: 200, 
      height: 100, 
      text: node.label,
      icon: node.icon,
      strokeColor: colorSet.stroke,
      fillColor: colorSet.fill,
      strokeWidth: 2,
      fontSize: 14,
      groupId: node.groupId  // 支持分组
    };
    
    finalElements.push(el);
    nodeMap.set(node.id, el);
  });

  // 2. Convert Edges
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
        lineType: LineType.STEP, // 默认使用 STEP 类型
        lineStyle: LineStyle.SOLID,
        markerEnd: true
      };
      finalElements.push(el);
    }
  });

  return finalElements;
}

