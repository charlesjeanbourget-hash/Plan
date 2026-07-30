import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };
type DivProps = React.HTMLAttributes<HTMLDivElement> & DataAttrs;

export function Dialog(props: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element;

export const DialogTrigger: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>;
export const DialogContent: React.ForwardRefExoticComponent<DivProps & React.RefAttributes<HTMLDivElement>>;
export function DialogHeader(props: DivProps): React.JSX.Element;
export function DialogFooter(props: DivProps): React.JSX.Element;
export const DialogTitle: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLHeadingElement> & React.RefAttributes<HTMLHeadingElement>>;
export const DialogDescription: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLParagraphElement> & React.RefAttributes<HTMLParagraphElement>>;
