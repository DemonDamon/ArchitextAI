# ArchitextAI: AI-Powered Diagramming

**A professional AI-powered diagramming tool that automatically generates flowcharts, architecture diagrams, and various infographics from text or image inputs. Ideal for presentations, academic papers, and technical documentation.**

---

*Author: Damon Li*
*Date: January 9, 2026*

## Key Features

- **AI-Powered Generation**: Instantly create diagrams from text descriptions or image uploads.
- **Auto Layout with ELK.js**: Professional layered layout algorithm for optimal node positioning and edge routing.
- **One-Click Beautify**: Automatically optimize diagram layout and connection paths with a single click.
- **Advanced Infographics**: Utilizes `@antv/infographic` to generate a wide variety of professional infographics, including:
  - Layered Architecture Diagrams (`hierarchy-structure`)
  - Flow Timelines (`sequence-color-snake-steps-horizontal-icon-line`)
  - Comparison Charts (`compare-binary`)
  - SWOT Analysis (`compare-swot`)
  - And many more.
- **Manual Drawing Toolkit**: Includes tools for creating and editing shapes (rectangles, circles), arrows, and text labels.
- **Smart Connections**: Arrows automatically snap to and connect with diagram nodes.
- **Element Grouping**: Group related elements together for better organization.
- **Persistent Workspace**: Your work is automatically saved to local storage.
- **History Control**: Full support for undo and redo actions.
- **High-Quality Export**: Export your diagrams as SVG or PNG files.
- **Multi-Provider AI Support**: Flexible integration with various AI models, including:
  - Gemini
  - OpenAI
  - Alibaba Cloud (Bailian/Qwen)
  - ZhipuAI (GLM)
  - MiniMax
  - DeepSeek

## Quick Start

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/DemonDamon/ArchitextAI.git
    cd ArchitextAI
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```

4.  Open your browser and navigate to `http://localhost:3001/` (or the port specified in your terminal).

5.  **(Optional)** Configure your AI provider by clicking the settings icon in the AI Generator panel, or create a `.env.local` file.

## Configuration

To enable AI features, you need to configure an AI provider. Create a `.env.local` file in the root of the project and add your API key.

### Example: Using Google Gemini

```.env.local
VITE_AI_PROVIDER=gemini
VITE_GEMINI_API_KEY=your_google_ai_api_key
```

### Supported AI Providers

You can configure any of the following providers by setting `VITE_AI_PROVIDER` and the corresponding API key variable.

| Provider | `VITE_AI_PROVIDER` value | API Key Variable | Models | Notes |
| :--- | :--- | :--- | :--- | :--- |
| Google Gemini | `gemini` | `VITE_GEMINI_API_KEY` | `gemini-2.0-flash`, etc. | Default provider. |
| OpenAI | `openai` | `VITE_OPENAI_API_KEY` | `gpt-4o`, `gpt-4.1-mini` | Supports custom `VITE_OPENAI_BASE_URL`. |
| Alibaba Qwen | `qwen` | `VITE_QWEN_API_KEY` | `qwen-plus`, etc. | Uses OpenAI-compatible API. |
| Zhipu GLM | `glm` | `VITE_GLM_API_KEY` | `glm-4`, etc. | Uses OpenAI-compatible API. |
| MiniMax | `minimax` | `VITE_MINIMAX_API_KEY` | `abab6.5-chat`, etc. | Uses OpenAI-compatible API. |
| DeepSeek | `deepseek` | `VITE_DEEPSEEK_API_KEY` | `deepseek-chat`, etc. | Uses OpenAI-compatible API. |

**Note:** All environment variables must be prefixed with `VITE_` as required by the Vite framework.

## Technology Stack

- **Frontend**: React 19, TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Infographics**: `@antv/infographic`
- **Auto Layout**: ELK.js (Eclipse Layout Kernel)

## Project Structure

```
ArchitextAI/
├── components/       # Core React components
│   ├── Canvas.tsx        # Main drawing canvas with smart connections
│   ├── Toolbar.tsx       # Drawing tools sidebar
│   ├── PropertiesPanel.tsx   # Element property editor
│   ├── GeminiInput.tsx       # AI generator panel
│   ├── InfographicRenderer.tsx   # Infographic rendering
│   └── DslEditorPanel.tsx    # DSL code editor
├── services/         # Service layer
│   ├── aiService.ts      # AI diagram generation (multi-provider)
│   ├── layoutService.ts  # ELK.js auto-layout engine
│   ├── infographicService.ts # Infographic DSL generation
│   └── configService.ts  # AI provider configuration
├── types.ts          # TypeScript type definitions
├── App.tsx           # Main application component
└── index.tsx         # Application entry point
```

## License

This project is licensed under the MIT License.
