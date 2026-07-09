import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize from 'rehype-sanitize';
import { useState } from 'react';

interface Props {
  content: string;
}

export default function MarkdownRenderer({ content }: Props) {
  if (!content) return null;

  return (
    <ReactMarkdown
      rehypePlugins={[rehypeHighlight, rehypeSanitize]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const isInline = !match && !String(children).includes('\n');
          if (isInline) {
            return <code className="inline-code" {...props}>{children}</code>;
          }
          return (
            <div className="code-block">
              <div className="code-block-header">
                <span className="code-block-lang">{match?.[1] || 'code'}</span>
              </div>
              <pre className="code-block-pre">
                <code className={className} {...props}>{children}</code>
              </pre>
            </div>
          );
        },
        a({ href, children, ...props }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="markdown-link" {...props}>
              {children}
            </a>
          );
        },
        p({ children, ...props }) {
          return <p className="markdown-paragraph" {...props}>{children}</p>;
        },
        ul({ children, ...props }) {
          return <ul className="markdown-list" {...props}>{children}</ul>;
        },
        ol({ children, ...props }) {
          return <ol className="markdown-list" {...props}>{children}</ol>;
        },
        li({ children, ...props }) {
          return <li className="markdown-list-item" {...props}>{children}</li>;
        },
        h1({ children, ...props }) {
          return <h1 className="markdown-h1" {...props}>{children}</h1>;
        },
        h2({ children, ...props }) {
          return <h2 className="markdown-h2" {...props}>{children}</h2>;
        },
        h3({ children, ...props }) {
          return <h3 className="markdown-h3" {...props}>{children}</h3>;
        },
        blockquote({ children, ...props }) {
          return <blockquote className="markdown-blockquote" {...props}>{children}</blockquote>;
        },
        table({ children, ...props }) {
          return (
            <div className="table-wrapper">
              <table className="markdown-table" {...props}>{children}</table>
            </div>
          );
        },
        strong({ children, ...props }) {
          return <strong className="markdown-strong" {...props}>{children}</strong>;
        },
        em({ children, ...props }) {
          return <em className="markdown-em" {...props}>{children}</em>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
