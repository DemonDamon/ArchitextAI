import { GoogleGenAI } from "@google/genai";
import { getAIConfig, PROVIDER_PRESETS } from './configService';
import { AIProviderConfig } from '../types';
import { buildChatCompletionsUrl } from './aiService';

const INFOGRAPHIC_SYSTEM_PROMPT = `You are an expert infographic designer. Convert user requests into a high-quality infographic using a specific indentation-based DSL.

CRITICAL RULES:
1. Output ONLY the DSL content. NO markdown code blocks, NO explanations, NO extra text.
2. First line MUST be exactly 'infographic <template-name>' (no quotes around template name).
3. Use exactly TWO spaces for indentation (not tabs).
4. If user provides mermaid/flowchart code, extract the key concepts and convert to this DSL format.

TEMPLATE SELECTION GUIDE:
- hierarchy-structure: Layered architecture diagrams (分层架构图), system layers with components
- sequence-color-snake-steps-horizontal-icon-line: Long process, snake layout (长流程，蛇形布局)
- sequence-ascending-stairs-3d-underline-text: Step progression, growth path (阶梯式进阶，成长路径)
- sequence-mountain-underline-text: Mountain shape, goal achievement (山峰形状，目标达成)
- sequence-cylinders-3d-simple: 3D cylinders, phases (3D圆柱，阶段性)
- sequence-roadmap-vertical-simple: Vertical roadmap, milestones (垂直路线图，里程碑)
- sequence-pyramid-simple: Pyramid structure, hierarchy (金字塔结构，层级递进)
- compare-binary-horizontal-underline-text-vs: Left-right comparison with VS (左右PK，显式 VS 标志)
- compare-swot: SWOT analysis (SWOT 分析专用)
- quadrant-quarter-simple-card: Four quadrant analysis (四象限分析)
- hierarchy-tree-tech-style-badge-card: Tech-style tree diagram (科技感树形图)
- hierarchy-mindmap: Mind map with branches (思维导图)
- list-grid-badge-card: Grid layout, feature list (网格布局，特性列表)
- list-column-simple-vertical-arrow: Vertical list with arrows (垂直列表)

TEMPLATE SELECTION RULES:
- If prompt contains "分层架构" or "layered architecture" or "system layers": use hierarchy-structure
- If prompt contains "SWOT": use compare-swot
- If prompt contains "vs" or "PK" or "对比": use compare-binary-horizontal-underline-text-vs
- If prompt contains "象限" or "矩阵" or "quadrant": use quadrant-quarter-simple-card
- If prompt contains "金字塔" or "pyramid": use sequence-pyramid-simple
- If prompt contains "路线图" or "Roadmap": use sequence-roadmap-vertical-simple
- For "流程/步骤/Timeline/process/steps": use sequence-color-snake-steps-horizontal-icon-line
- For "成长/阶梯/Level/growth": use sequence-ascending-stairs-3d-underline-text
- For "组织/架构/Tree/organization" (non-layered): use hierarchy-tree-tech-style-badge-card
- For "思维导图/mindmap": use hierarchy-mindmap
- Default: list-column-simple-vertical-arrow

TEMPLATE-SPECIFIC DSL STRUCTURES (Follow strictly):

1. hierarchy-structure (Layered Architecture - IMPORTANT):
   Use this for system architecture with horizontal layers, each layer containing multiple components.
   Each top-level item is a LAYER, and children are COMPONENTS within that layer.
   IMPORTANT: Each layer will get a DIFFERENT COLOR automatically. Keep layers at top level.
   
   infographic hierarchy-structure
   data
     title <Architecture Title>
     desc <Description>
     items
       - label <Layer 1 Name>
         children
           - label <Component 1>
           - label <Component 2>
           - label <Component 3>
       - label <Layer 2 Name>
         children
           - label <Module A>
             children
               - label <Sub-component 1>
               - label <Sub-component 2>
           - label <Module B>
             children
               - label <Sub-component 1>
               - label <Sub-component 2>
       - label <Layer 3 Name>
         children
           - label <Service 1>
           - label <Service 2>
   theme
     light
     palette antv

   EXAMPLE - Agentic RAG System Architecture:
   infographic hierarchy-structure
   data
     title Agentic RAG System Architecture
     desc Multi-layered architecture integrating agents, RAG pipeline, and tools
     items
       - label User Interface Layer
         children
           - label Web Application
           - label Chat Interface
           - label API Gateway
       - label Agent Orchestration Layer
         children
           - label Planning Agent
           - label Routing Agent
           - label Reflection Agent
       - label RAG Pipeline Layer
         children
           - label Query Understanding
           - label Retrieval Engine
           - label Reranking Module
       - label Knowledge Management Layer
         children
           - label Vector Database
           - label Document Store
           - label Knowledge Graph
       - label Infrastructure Layer
         children
           - label Embedding Service
           - label Caching Layer
           - label Monitoring
   theme
     light
     palette antv

2. compare-binary-horizontal-underline-text-vs (Two items ONLY):
   infographic compare-binary-horizontal-underline-text-vs
   data
     title <title>
     items
       - label <Option A>
         children
           - label <Point 1>
           - label <Point 2>
       - label <Option B>
         children
           - label <Point 1>
           - label <Point 2>

3. compare-swot (Four items ONLY):
   infographic compare-swot
   data
     title <title>
     items
       - label Strengths
         children
           - label <Point 1>
       - label Weaknesses
         children
           - label <Point 1>
       - label Opportunities
         children
           - label <Point 1>
       - label Threats
         children
           - label <Point 1>

4. quadrant-quarter-simple-card (Four items ONLY):
   infographic quadrant-quarter-simple-card
   data
     title <title>
     items
       - label <Quadrant 1>
         desc <Description>
       - label <Quadrant 2>
         desc <Description>
       - label <Quadrant 3>
         desc <Description>
       - label <Quadrant 4>
         desc <Description>

5. sequence-pyramid-simple (Bottom-up hierarchy):
   infographic sequence-pyramid-simple
   data
     title <title>
     items
       - label <Level 1 (Bottom)>
         desc <Detail>
       - label <Level 2>
         desc <Detail>
       - label <Level 3 (Top)>
         desc <Detail>

6. sequence-color-snake-steps-horizontal-icon-line:
   infographic sequence-color-snake-steps-horizontal-icon-line
   data
     title <title>
     items
       - label <Step 1>
         time <Time/Index>
         icon <mdi/icon-name>
       - label <Step 2>
         time <Time/Index>
         icon <mdi/icon-name>

7. sequence-ascending-stairs-3d-underline-text:
   infographic sequence-ascending-stairs-3d-underline-text
   data
     title <title>
     desc <description>
     items
       - label <Step 1>
         desc <Detail>
       - label <Step 2>
         desc <Detail>

8. hierarchy-tree-tech-style-compact-card:
   infographic hierarchy-tree-tech-style-compact-card
   data
     title <title>
     items
       - label <Root>
         children
           - label <Branch 1>
             children
               - label <Leaf 1>
               - label <Leaf 2>
           - label <Branch 2>

9. hierarchy-mindmap:
   infographic hierarchy-mindmap
   data
     title <title>
     items
       - label <Topic 1>
         children
           - label <Subtopic 1>
           - label <Subtopic 2>
       - label <Topic 2>
         children
           - label <Subtopic 1>
           - label <Subtopic 2>

10. list-column-simple-vertical-arrow:
    infographic list-column-simple-vertical-arrow
    data
      title <title>
      desc <description>
      items
        - label <Item 1>
          desc <Detail>
          icon <icon-name>
        - label <Item 2>
          desc <Detail>
          icon <icon-name>

CRITICAL INDENTATION RULES (strictly follow):
- 'data' = 0 spaces
- 'title', 'desc', 'items' under data = 2 spaces
- '- label' under items = 4 spaces (TWO levels of 2-space indent)
- 'desc', 'icon', 'children' under list item = 6 spaces (THREE levels)
- Nested '- label' under children = 8 spaces (FOUR levels)
- Further nested children = 10 spaces, and so on
- 'theme' = 0 spaces
- 'light', 'palette' under theme = 2 spaces

CORRECT EXAMPLES:

Example 1 - Layered Architecture (hierarchy-structure):
infographic hierarchy-structure
data
  title Microservices Architecture
  desc Three-tier architecture with gateway, services, and data layer
  items
    - label Gateway Layer
      children
        - label API Gateway
        - label Load Balancer
    - label Service Layer
      children
        - label User Service
        - label Order Service
        - label Payment Service
    - label Data Layer
      children
        - label MySQL
        - label Redis
        - label MongoDB
theme
  light
  palette antv

Example 2 - Horizontal flow:
infographic list-row-simple-horizontal-arrow
data
  title RAG Workflow
  items
    - label User Query
      desc Ask a question
      icon message-circle
    - label Search Knowledge Base
      desc Search relevant information
      icon search
    - label Generate Answer
      desc AI generates response
      icon sparkles

Example 3 - Mindmap (with children):
infographic hierarchy-mindmap
data
  title AI Technology Stack
  items
    - label Machine Learning
      children
        - label Supervised Learning
        - label Unsupervised Learning
    - label Deep Learning
      children
        - label Neural Networks
        - label CNN
`;

/**
 * Clean markdown code blocks from AI response and fix indentation
 * Completely rewritten to properly handle hierarchy-structure nested children
 */
function cleanDslOutput(text: string): string {
  let cleanedText = text;
  
  // Remove markdown code blocks
  if (cleanedText.startsWith('```')) {
    const match = cleanedText.match(/```(?:\w+)?\n([\s\S]*?)(?:```)?$/);
    if (match) {
      cleanedText = match[1];
    } else {
      cleanedText = cleanedText.replace(/^```(?:\w+)?\n/, '');
    }
  }
  
  // Detect template type first
  const templateMatch = cleanedText.match(/^infographic\s+(\S+)/m);
  const templateName = templateMatch?.[1] || '';
  const isCompareTemplate = templateName.startsWith('compare-');
  const isHierarchyStructure = templateName === 'hierarchy-structure';
  const isWordcloudTemplate = templateName === 'chart-wordcloud';
  
  const lines = cleanedText.split('\n');
  const fixedLines: string[] = [];
  
  // Track state for proper indentation
  let inData = false;
  let inItems = false;
  let inTheme = false;
  let currentDepth = 0; // Track nesting depth based on original indentation
  
  // Stack to track the indentation levels of parent items
  const indentStack: number[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines
    if (!line.trim()) {
      continue;
    }
    
    const trimmed = line.trim();
    const originalIndent = line.match(/^( *)/)?.[1].length || 0;
    
    // Handle top-level keywords
    if (trimmed.startsWith('infographic ')) {
      fixedLines.push(trimmed);
      inData = false;
      inItems = false;
      inTheme = false;
      indentStack.length = 0;
      continue;
    }
    
    if (trimmed === 'data') {
      fixedLines.push('data');
      inData = true;
      inItems = false;
      inTheme = false;
      indentStack.length = 0;
      continue;
    }
    
    if (trimmed === 'theme') {
      fixedLines.push('theme');
      inData = false;
      inItems = false;
      inTheme = true;
      indentStack.length = 0;
      continue;
    }
    
    // Handle theme section
    if (inTheme) {
      if (trimmed === 'light' || trimmed === 'dark') {
        fixedLines.push('  ' + trimmed);
        continue;
      }
      if (trimmed.startsWith('palette')) {
        fixedLines.push('  ' + trimmed);
        continue;
      }
      if (trimmed.startsWith('- ')) {
        fixedLines.push('    ' + trimmed);
        continue;
      }
      continue;
    }
    
    // Handle data section
    if (inData) {
      if (trimmed.startsWith('title ') || trimmed.startsWith('desc ')) {
        if (!inItems) {
          fixedLines.push('  ' + trimmed);
          continue;
        }
      }
      
      if (trimmed === 'items') {
        fixedLines.push('  items');
        inItems = true;
        indentStack.length = 0;
        continue;
      }
      
      if (inItems) {
        // Pop stack until we find a parent with less indentation
        while (indentStack.length > 0 && originalIndent <= indentStack[indentStack.length - 1]) {
          indentStack.pop();
        }
        
        const depth = indentStack.length;
        
        if (trimmed === 'children') {
          // children keyword: 6 spaces + 4 spaces per depth level
          const indent = '      ' + '    '.repeat(depth);
          fixedLines.push(indent + 'children');
          // Push current indent to stack to track this level
          indentStack.push(originalIndent);
          continue;
        }
        
        if (trimmed.startsWith('- label') || trimmed.startsWith('- ')) {
          // List items: 4 spaces + 4 spaces per depth level
          const indent = '    ' + '    '.repeat(depth);
          fixedLines.push(indent + trimmed);
          // Push current indent to stack
          indentStack.push(originalIndent);
          continue;
        }
        
        if (trimmed.startsWith('desc ') || trimmed.startsWith('icon ') || 
            trimmed.startsWith('value ') || trimmed.startsWith('time ')) {
          // Properties: 6 spaces + 4 spaces per depth level (same level as parent item's children)
          const indent = '      ' + '    '.repeat(Math.max(0, depth - 1));
          fixedLines.push(indent + trimmed);
          continue;
        }
      }
    }
    
    // Remove 'icon' property for compare templates (not supported)
    if (isCompareTemplate && trimmed.startsWith('icon ')) {
      continue;
    }
    
    // Fallback: keep original line
    fixedLines.push(line);
  }
  
  let result = fixedLines.join('\n').trim();
  
  // Auto-add theme for hierarchy-structure template if not present
  // Use the official format: theme > light > palette antv
  if (isHierarchyStructure && !result.includes('theme')) {
    const themeDsl = `\ntheme\n  light\n  palette antv`;
    result += themeDsl;
  }
  
  console.log('[InfographicService] Cleaned DSL:');
  console.log(result);
  return result;
}

/**
 * Generate infographic DSL using Gemini
 */
async function* generateWithGemini(
  config: AIProviderConfig,
  prompt: string,
  imageBase64?: string | null
): AsyncGenerator<string> {
  const genAI = new GoogleGenAI({ apiKey: config.apiKey });
  const model = genAI.getGenerativeModel({ 
    model: config.model || "gemini-2.0-flash",
    systemInstruction: INFOGRAPHIC_SYSTEM_PROMPT,
  });

  const parts: any[] = [{ text: prompt }];
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

  const result = await model.generateContentStream(parts);
  let fullText = "";
  for await (const chunk of result.stream) {
    const chunkText = chunk.text();
    fullText += chunkText;
    yield cleanDslOutput(fullText);
  }
}

/**
 * Generate infographic DSL using OpenAI-compatible API (streaming)
 * Works for: OpenAI, Bailian (Qwen), GLM, DeepSeek, etc.
 */
async function* generateWithOpenAICompatible(
  config: AIProviderConfig,
  prompt: string,
  imageBase64?: string | null
): AsyncGenerator<string> {
  const baseUrl = buildChatCompletionsUrl(config.baseUrl);
  
  const messages: any[] = [
    { role: "system", content: INFOGRAPHIC_SYSTEM_PROMPT },
  ];

  // Build user message with optional image
  if (imageBase64) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageBase64 } }
      ]
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            yield cleanDslOutput(fullText);
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
}

/**
 * Main function to generate infographic DSL
 */
export async function* generateInfographicDsl(
  prompt: string,
  imageBase64?: string | null
): AsyncGenerator<string> {
  const config = getAIConfig();
  
  if (!config.apiKey) {
    throw new Error('API key not configured. Please set up your AI provider in settings.');
  }

  console.log('[InfographicService] Generating with provider:', config.provider);
  console.log('[InfographicService] Model:', config.model);
  console.log('[InfographicService] Prompt:', prompt.substring(0, 100) + '...');
  
  // Route to appropriate generator based on provider
  if (config.provider === 'gemini') {
    yield* generateWithGemini(config, prompt, imageBase64);
  } else {
    // All other providers use OpenAI-compatible API
    yield* generateWithOpenAICompatible(config, prompt, imageBase64);
  }
}

/**
 * Parse shortcut commands and convert to full prompts
 */
export function parseShortcutCommand(input: string): string {
  const trimmed = input.trim();
  
  // /flow command - process flow
  if (trimmed.startsWith('/flow ')) {
    const content = trimmed.slice(6);
    return `Create a process flow diagram for: ${content}. Use sequence-color-snake-steps-horizontal-icon-line template.`;
  }
  
  // /compare command - comparison
  if (trimmed.startsWith('/compare ')) {
    const content = trimmed.slice(9);
    return `Create a comparison diagram for: ${content}. Use compare-binary-horizontal-underline-text-vs template.`;
  }
  
  // /swot command - SWOT analysis
  if (trimmed.startsWith('/swot ')) {
    const content = trimmed.slice(6);
    return `Create a SWOT analysis for: ${content}. Use compare-swot template.`;
  }
  
  // /pyramid command - pyramid
  if (trimmed.startsWith('/pyramid ')) {
    const content = trimmed.slice(9);
    return `Create a pyramid diagram for: ${content}. Use sequence-pyramid-simple template.`;
  }
  
  // /roadmap command - roadmap
  if (trimmed.startsWith('/roadmap ')) {
    const content = trimmed.slice(9);
    return `Create a roadmap for: ${content}. Use sequence-roadmap-vertical-simple template.`;
  }
  
  // /mindmap command - mind map
  if (trimmed.startsWith('/mindmap ')) {
    const content = trimmed.slice(9);
    return `Create a mind map for: ${content}. Use hierarchy-mindmap template.`;
  }
  
  // /tree command - tree diagram
  if (trimmed.startsWith('/tree ')) {
    const content = trimmed.slice(6);
    return `Create a tree diagram for: ${content}. Use hierarchy-tree-tech-style-badge-card template.`;
  }
  
  // /list command - list
  if (trimmed.startsWith('/list ')) {
    const content = trimmed.slice(6);
    return `Create a list diagram for: ${content}. Use list-column-simple-vertical-arrow template.`;
  }
  
  // /quadrant command - quadrant analysis
  if (trimmed.startsWith('/quadrant ')) {
    const content = trimmed.slice(10);
    return `Create a quadrant analysis for: ${content}. Use quadrant-quarter-simple-card template.`;
  }
  
  // /layers command - layered architecture
  if (trimmed.startsWith('/layers ')) {
    const content = trimmed.slice(8);
    return `Create a layered architecture diagram for: ${content}. 
Use hierarchy-structure template. 
IMPORTANT: Each layer should be a top-level item with its components as children.
Each layer will get a different color automatically.
Add theme section at the end with 'light' and 'palette antv'.`;
  }
  
  // No shortcut matched, return original input
  return input;
}
