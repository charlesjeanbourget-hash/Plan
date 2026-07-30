import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const Popover: React.FC<{ open?: boolean; onOpenChange?: (open: boolean) => void; children?: React.ReactNode }>;

export const PopoverTrigger: React.ForwardRefExoticComponent<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean } & DataAttrs & React.RefAttributes<HTMLButtonElement>
>;

export const PopoverContent: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'center' | 'end'; sideOffset?: number } & DataAttrs & React.RefAttributes<HTMLDivElement>
>;
