'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  useReducedMotion,
} from 'motion/react';
import * as m from 'motion/react-m';
import { codeToHtml } from 'shiki';
import { Button } from '@heroui/react';
import { composeSlotClassName } from '../../utils/compose';
import { Check, Copy } from '../icons';
import { codeBlockVariants } from './code-block.styles';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CodeBlockRootProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface CodeBlockHeaderProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
}

export interface CodeBlockCodeProps extends ComponentPropsWithRef<'div'> {
  code: string;
  darkTheme?: string;
  language?: string;
  theme?: string;
}

export interface CodeBlockCopyButtonProps {
  code: string;
  'aria-label'?: string;
  className?: string;
}

export type CodeBlockProps = CodeBlockRootProps;

// ── Context ──────────────────────────────────────────────────────────────────

interface CodeBlockContextValue {
  slots?: ReturnType<typeof codeBlockVariants>;
}

const CodeBlockContext = createContext<CodeBlockContextValue>({});

// ── Components ───────────────────────────────────────────────────────────────

export const CodeBlockRoot = ({
  children,
  className,
  ...props
}: CodeBlockRootProps) => {
  const slots = useMemo(() => codeBlockVariants(), []);

  return (
    <CodeBlockContext value={{ slots }}>
      <div
        className={composeSlotClassName(slots?.base, className)}
        data-slot="code-block"
        {...props}
      >
        {children}
      </div>
    </CodeBlockContext>
  );
};

export const CodeBlockHeader = ({
  children,
  className,
  ...props
}: CodeBlockHeaderProps) => {
  const { slots } = useContext(CodeBlockContext);

  return (
    <div
      className={composeSlotClassName(slots?.header, className)}
      data-slot="code-block-header"
      {...props}
    >
      {children}
    </div>
  );
};

interface HighlightedState {
  html: string;
  key: string;
}

export const CodeBlockCode = ({
  className,
  code,
  darkTheme,
  language = 'plaintext',
  theme,
  ...props
}: CodeBlockCodeProps) => {
  const { slots } = useContext(CodeBlockContext);
  const lightTheme = theme ?? 'github-light';
  const resolvedDarkTheme = darkTheme ?? (theme ? undefined : 'github-dark');
  const cacheKey = `${language}:${lightTheme}:${resolvedDarkTheme ?? 'none'}:${code}`;
  const [highlighted, setHighlighted] = useState<HighlightedState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      if (!code) {
        if (!cancelled)
          setHighlighted({ html: '<pre><code></code></pre>', key: cacheKey });
        return;
      }

      try {
        const html = resolvedDarkTheme
          ? await codeToHtml(code, {
              defaultColor: false,
              lang: language,
              themes: { dark: resolvedDarkTheme, light: lightTheme },
            })
          : await codeToHtml(code, { lang: language, theme: lightTheme });

        if (!cancelled) setHighlighted({ html, key: cacheKey });
      } catch {
        if (!cancelled) setHighlighted(null);
      }
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [resolvedDarkTheme, code, cacheKey, language, lightTheme]);

  const composedClassName = composeSlotClassName(slots?.code, className);

  if (highlighted?.key === cacheKey) {
    return (
      <div
        className={composedClassName}
        dangerouslySetInnerHTML={{ __html: highlighted.html }}
        data-slot="code-block-code"
        {...props}
      />
    );
  }

  return (
    <div className={composedClassName} data-slot="code-block-code" {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const CodeBlockCopyButton = ({
  'aria-label': ariaLabel = 'Copy code',
  className,
  code,
}: CodeBlockCopyButtonProps) => {
  const { slots } = useContext(CodeBlockContext);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    },
    []
  );

  const motionProps = prefersReducedMotion
    ? {
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        initial: { opacity: 0 },
        transition: { duration: 0.12 },
      }
    : {
        animate: { filter: 'blur(0px)', opacity: 1, scale: 1 },
        exit: { filter: 'blur(4px)', opacity: 0, scale: 0.25 },
        initial: { filter: 'blur(4px)', opacity: 0, scale: 0.25 },
        transition: { bounce: 0, duration: 0.3, type: 'spring' },
      };

  const IconComponent = copied ? Check : Copy;

  return (
    <Button
      isIconOnly
      aria-label={ariaLabel}
      className={composeSlotClassName(slots?.copyButton, className)}
      data-slot="code-block-copy-button"
      size="sm"
      variant="ghost"
      onPress={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            setCopied(false);
            timeoutRef.current = null;
          }, 2000);
        } catch {
          // clipboard write failed — silently ignore
        }
      }}
    >
      <LazyMotion features={domAnimation}>
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            className="flex size-3.5 items-center justify-center"
            data-slot="code-block-copy-button-icon-motion"
            key={copied ? 'check' : 'copy'}
            {...(motionProps as any)}
          >
            <IconComponent className="size-3.5" />
          </m.span>
        </AnimatePresence>
      </LazyMotion>
    </Button>
  );
};
