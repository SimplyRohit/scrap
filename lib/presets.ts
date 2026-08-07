import { Ecosystem } from "./types";

export interface PresetManifest {
  id: string;
  name: string;
  ecosystem: Ecosystem;
  badge: string;
  description: string;
  fileName: string;
  content: string;
}

export const PRESET_MANIFESTS: PresetManifest[] = [
  {
    id: "nodejs-web",
    name: "Node.js & Next.js Stack",
    ecosystem: "nodejs",
    badge: "Node.js",
    description: "Upgrade Next.js 13->14, React 17->18, and Tailwind CSS 3->4",
    fileName: "package.json",
    content: JSON.stringify({
      "name": "enterprise-web-app",
      "version": "1.2.0",
      "dependencies": {
        "next": "13.4.19",
        "react": "17.0.2",
        "react-dom": "17.0.2",
        "tailwindcss": "3.3.3",
        "axios": "0.27.2",
        "pydantic": "1.10.8"
      },
      "devDependencies": {
        "typescript": "4.9.5",
        "eslint": "8.42.0"
      }
    }, null, 2)
  },
  {
    id: "python-backend",
    name: "Python FastAPI & Pydantic Engine",
    ecosystem: "python",
    badge: "Python",
    description: "Major upgrade from Pydantic V1 -> V2, FastAPI 0.95 -> 0.110, and SQLAlchemy 1.4 -> 2.0",
    fileName: "requirements.txt",
    content: `# Enterprise Python API Service
pydantic==1.10.8
fastapi==0.95.2
sqlalchemy==1.4.48
uvicorn==0.22.0
requests==2.28.2
pytest==7.3.1
`
  },
  {
    id: "langchain-agent",
    name: "LangChain Agentic AI Stack",
    ecosystem: "langchain",
    badge: "LangChain AI",
    description: "Migrating legacy langchain 0.0.350 to split packages (langchain-core, langchain-community 0.2, langgraph)",
    fileName: "requirements.txt",
    content: `# LangChain Multi-Agent System
langchain==0.0.350
langchain-community==0.0.10
langgraph==0.0.10
openai==0.28.1
tiktoken==0.5.1
faiss-cpu==1.7.4
`
  },
  {
    id: "llamaindex-rag",
    name: "LlamaIndex & Vector DB RAG Pipeline",
    ecosystem: "llamaindex",
    badge: "LlamaIndex RAG",
    description: "Upgrading LlamaIndex v0.9 -> v0.10 split core modules & ChromaDB v0.4 -> v0.5",
    fileName: "requirements.txt",
    content: `# Enterprise RAG Knowledge Pipeline
llama-index==0.9.36
chromadb==0.4.22
pinecone-client==2.2.4
qdrant-client==1.7.0
sentence-transformers==2.2.2
`
  },
  {
    id: "aiml-transformers",
    name: "HuggingFace & AI/ML Inference Stack",
    ecosystem: "aiml",
    badge: "PyTorch & vLLM",
    description: "Upgrading Transformers 4.28 -> 4.42, PyTorch 2.0 -> 2.3, and vLLM 0.2 -> 0.5",
    fileName: "requirements.txt",
    content: `# AI/ML LLM Inference Cluster
transformers==4.28.1
torch==2.0.1
vllm==0.2.2
diffusers==0.16.1
accelerate==0.19.0
datasets==2.12.0
`
  }
];
