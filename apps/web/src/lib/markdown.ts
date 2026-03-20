import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

export const renderMarkdown = async (source: string) => {
  const html = await marked.parse(source, {
    gfm: true,
    breaks: false,
  });

  return DOMPurify.sanitize(html);
};
