export const guessLanguage = (path: string) => {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) {
    return "";
  }

  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "css":
      return "css";
    case "html":
      return "html";
    case "sh":
      return "bash";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    default:
      return "";
  }
};

export const isMarkdown = (path: string) => {
  return path.toLowerCase().endsWith(".md");
};
