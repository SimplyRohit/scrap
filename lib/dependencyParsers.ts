import { Dependency, Ecosystem, ManifestParseResult } from "./types";

export function parseDependencyManifest(content: string, fileName: string = ""): ManifestParseResult {
  const trimmed = content.trim();
  
  // Try JSON first (package.json)
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const json = JSON.parse(trimmed);
      const deps: Dependency[] = [];

      const targetVersionMap: Record<string, string> = {
        "next": "14.2.5",
        "react": "18.3.1",
        "react-dom": "18.3.1",
        "tailwindcss": "4.0.0",
        "axios": "1.7.2",
        "pydantic": "2.8.2",
        "typescript": "5.5.3",
        "eslint": "9.7.0"
      };

      const allDeps = {
        ...json.dependencies,
        ...json.devDependencies,
        ...json.peerDependencies
      };

      for (const [name, versionRaw] of Object.entries(allDeps)) {
        if (typeof versionRaw !== "string") continue;
        const cleanVer = (versionRaw as string).replace(/[\^~>=<]/g, "").trim();
        const targetVer = targetVersionMap[name] || bumpVersion(cleanVer);
        
        let ecosystem: Ecosystem = 'nodejs';
        if (name.includes('langchain') || name.includes('langgraph')) ecosystem = 'langchain';
        else if (name.includes('llama-index')) ecosystem = 'llamaindex';
        else if (name.includes('torch') || name.includes('transformers')) ecosystem = 'aiml';

        deps.push({
          name,
          currentVersion: cleanVer || "1.0.0",
          targetVersion: targetVer,
          ecosystem,
          repoUrl: `https://github.com/search?q=${encodeURIComponent(name)}`,
          docsUrl: `https://npmjs.com/package/${name}`,
          changelogUrl: `https://github.com/search?q=${encodeURIComponent(name)}+changelog`
        });
      }

      return {
        ecosystem: "nodejs",
        fileName: fileName || "package.json",
        dependencies: deps,
        totalCount: deps.length
      };
    } catch {
      // Fall through to text line parser
    }
  }

  // Text line parser (requirements.txt, pyproject.toml, etc.)
  const lines = trimmed.split("\n");
  const deps: Dependency[] = [];
  let detectedEcosystem: Ecosystem = "python";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Parse package==version or package>=version or package
    const match = line.match(/^([a-zA-Z0-9_\-\/@]+)\s*(?:==|>=|~=|=)?\s*([0-9a-zA-Z\.\-]+)?/);
    if (match) {
      const name = match[1];
      const currentVersion = match[2] || "1.0.0";
      const targetVersion = getKnownTargetVersion(name, currentVersion);
      const eco = detectEcosystemForPackage(name);
      
      if (eco !== 'python') detectedEcosystem = eco;

      deps.push({
        name,
        currentVersion,
        targetVersion,
        ecosystem: eco,
        repoUrl: `https://github.com/search?q=${encodeURIComponent(name)}`,
        docsUrl: `https://pypi.org/project/${name}`,
        changelogUrl: `https://github.com/search?q=${encodeURIComponent(name)}+releases`
      });
    }
  }

  return {
    ecosystem: detectedEcosystem,
    fileName: fileName || "requirements.txt",
    dependencies: deps,
    totalCount: deps.length
  };
}

function detectEcosystemForPackage(name: string): Ecosystem {
  const lower = name.toLowerCase();
  if (lower.includes("langchain") || lower.includes("langgraph") || lower.includes("tiktoken")) return "langchain";
  if (lower.includes("llama-index") || lower.includes("chromadb") || lower.includes("pinecone") || lower.includes("qdrant")) return "llamaindex";
  if (lower.includes("transformers") || lower.includes("torch") || lower.includes("vllm") || lower.includes("diffusers") || lower.includes("datasets") || lower.includes("accelerate")) return "aiml";
  if (lower.includes("express") || lower.includes("react") || lower.includes("next") || lower.includes("vue")) return "nodejs";
  return "python";
}

function getKnownTargetVersion(name: string, currentVer: string): string {
  const knownTargets: Record<string, string> = {
    "pydantic": "2.8.2",
    "fastapi": "0.111.0",
    "sqlalchemy": "2.0.31",
    "uvicorn": "0.30.1",
    "requests": "2.32.3",
    "langchain": "0.2.11",
    "langchain-community": "0.2.10",
    "langchain-core": "0.2.23",
    "langgraph": "0.1.8",
    "openai": "1.37.0",
    "llama-index": "0.10.55",
    "llama-index-core": "0.10.55",
    "chromadb": "0.5.4",
    "pinecone-client": "4.1.1",
    "qdrant-client": "1.10.0",
    "transformers": "4.43.2",
    "torch": "2.3.1",
    "vllm": "0.5.3",
    "diffusers": "0.29.2",
    "accelerate": "0.33.0"
  };

  return knownTargets[name.toLowerCase()] || bumpVersion(currentVer);
}

function bumpVersion(ver: string): string {
  const parts = ver.split(".");
  if (parts.length >= 1 && !isNaN(Number(parts[0]))) {
    const major = Number(parts[0]) + 1;
    return `${major}.0.0`;
  }
  return "2.0.0";
}
