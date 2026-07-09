import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Chat markdown — flat typography without a prose plugin. */
export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className='my-1.5 leading-relaxed first:mt-0 last:mb-0'>
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul className='my-1.5 list-disc space-y-0.5 pl-5'>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className='my-1.5 list-decimal space-y-0.5 pl-5'>{children}</ol>
        ),
        li: ({ children }) => <li className='leading-relaxed'>{children}</li>,
        h1: ({ children }) => (
          <h1 className='mb-1.5 mt-3 text-[15px] font-semibold first:mt-0'>
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className='mb-1 mt-3 text-[14px] font-semibold first:mt-0'>
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className='mb-1 mt-2 text-[13px] font-semibold first:mt-0'>
            {children}
          </h3>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target='_blank'
            rel='noreferrer'
            className='underline underline-offset-2'
          >
            {children}
          </a>
        ),
        code: ({ className, children }) =>
          className ? (
            <code className='block overflow-x-auto rounded-xl p-2.5 font-mono text-[12px] inset'>
              {children}
            </code>
          ) : (
            <code className='rounded px-1 py-0.5 font-mono text-[12px] inset'>
              {children}
            </code>
          ),
        pre: ({ children }) => <pre className='my-2'>{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className='my-2 border-l-2 border-border pl-3 text-muted-fg'>
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className='my-2 overflow-x-auto'>
            <table className='w-full text-[12px]'>{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className='border-b border-border px-2 py-1 text-left font-medium'>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className='border-b border-border px-2 py-1 align-top'>
            {children}
          </td>
        ),
        hr: () => <hr className='my-3 border-border' />,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
