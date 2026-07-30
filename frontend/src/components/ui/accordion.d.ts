import * as React from 'react';

type DataAttrs = { [key: `data-${string}`]: string | undefined };

export const Accordion: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & {
    type: 'single' | 'multiple';
    collapsible?: boolean;
    value?: string | string[];
    defaultValue?: string | string[];
    onValueChange?: (value: string) => void;
  } & React.RefAttributes<HTMLDivElement>
>;

export const AccordionItem: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { value: string; disabled?: boolean } & React.RefAttributes<HTMLDivElement>
>;

export const AccordionTrigger: React.ForwardRefExoticComponent<
  React.ButtonHTMLAttributes<HTMLButtonElement> & DataAttrs & React.RefAttributes<HTMLButtonElement>
>;

export const AccordionContent: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;
